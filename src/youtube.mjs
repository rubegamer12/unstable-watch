import { config, creators } from './config.mjs';
import { getUnseenVideos } from './video-diff.mjs';
import { classifyArcTitle, looksLikeArcPlaylist } from './arcs.mjs';
import { filterUnstableVideos, parseIsoDuration } from './video-filter.mjs';
import { extractChannelId, parseYouTubeAtomFeed } from './youtube-public-feed.mjs';

const API = 'https://www.googleapis.com/youtube/v3';
const MAX_LIBRARY_RESULTS = 200;
const MAX_ARC_PLAYLISTS_PER_CREATOR = 40;
const PUBLIC_FEED = 'https://www.youtube.com/feeds/videos.xml';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36 UnstableWatch/4.1';

async function fetchText(url, label = 'YouTube') {
  const response = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      'accept-language': 'en-US,en;q=0.9',
      accept: 'text/html,application/atom+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`${label} ${response.status}`);
  return response.text();
}

async function youtube(path, params) {
  if (!config.youtubeApiKey) throw new Error('YOUTUBE_API_KEY is missing');
  const url = new URL(`${API}/${path}`);
  for (const [key, value] of Object.entries({ ...params, key: config.youtubeApiKey })) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    let detail = '';
    try {
      const payload = await response.json();
      detail = payload?.error?.message || JSON.stringify(payload);
    } catch {
      detail = await response.text();
    }
    throw new Error(`YouTube API ${response.status}: ${String(detail).slice(0, 240)}`);
  }
  return response.json();
}

function mapVideo(item, creator) {
  const snippet = item.snippet || {};
  const videoId = item.contentDetails?.videoId || snippet.resourceId?.videoId;
  return {
    id: videoId,
    channelId: snippet.videoOwnerChannelId || creator.channelId,
    creatorId: creator.id,
    creator: creator.name,
    title: snippet.title || 'Untitled upload',
    description: snippet.description || '',
    publishedAt: snippet.videoPublishedAt || snippet.publishedAt || new Date().toISOString(),
    thumbnail: snippet.thumbnails?.maxres?.url
      || snippet.thumbnails?.standard?.url
      || snippet.thumbnails?.high?.url
      || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : ''),
    watchUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null
  };
}

export class YouTubeService {
  constructor(store, { onUpload = async () => {} } = {}) {
    this.store = store;
    this.onUpload = onUpload;
    this.resolved = new Map();
    this.creatorErrors = new Map();
    this.timer = null;
    this.lastError = null;
    this.lastSuccessAt = null;
    this.polling = false;
  }

  get mode() {
    return config.youtubeApiKey ? 'youtube-api' : 'public-feed';
  }

  async resolveCreator(creator) {
    if (this.resolved.has(creator.id)) return this.resolved.get(creator.id);

    if (!config.youtubeApiKey) {
      const channelUrl = `https://www.youtube.com/@${creator.handle}`;
      const channelId = creator.channelId || extractChannelId(await fetchText(channelUrl, `YouTube handle @${creator.handle}`), creator.handle);
      if (!channelId) {
        throw new Error(`Could not resolve public channel ID for @${creator.handle}. Add an optional YOUTUBE_API_KEY for the full archive if YouTube blocks the public feed.`);
      }
      const resolved = {
        ...creator,
        channelId,
        channelTitle: creator.name,
        avatar: '',
        uploadsPlaylistId: null,
        channelUrl
      };
      if ([...this.resolved.values()].some(item => item.channelId === channelId && item.id !== creator.id)) throw new Error('Channel already belongs to a different creator');
      this.resolved.set(creator.id, resolved);
      return resolved;
    }

    const data = await youtube('channels', {
      part: 'snippet,contentDetails',
      forHandle: creator.handle
    });
    const channel = data.items?.[0];
    if (channel && creator.channelId && channel.id !== creator.channelId) throw new Error('YouTube channel identity mismatch');
    if (!channel) throw new Error(`Could not resolve YouTube handle @${creator.handle}`);
    const resolved = {
      ...creator,
      channelId: channel.id,
      channelTitle: channel.snippet?.title || creator.name,
      avatar: channel.snippet?.thumbnails?.high?.url || channel.snippet?.thumbnails?.default?.url || '',
      uploadsPlaylistId: channel.contentDetails?.relatedPlaylists?.uploads,
      channelUrl: `https://www.youtube.com/@${creator.handle}`
    };
    if (!resolved.uploadsPlaylistId) throw new Error(`No uploads playlist found for @${creator.handle}`);
    this.resolved.set(creator.id, resolved);
    return resolved;
  }

  async fetchCreatorVideos(creator, maxResults = MAX_LIBRARY_RESULTS) {
    const resolved = await this.resolveCreator(creator);

    if (!config.youtubeApiKey) {
      const feedUrl = new URL(PUBLIC_FEED);
      feedUrl.searchParams.set('channel_id', resolved.channelId);
      const xml = await fetchText(feedUrl, `${creator.name} public feed`);
      return parseYouTubeAtomFeed(xml, resolved).slice(0, maxResults);
    }

    const videos = [];
    let pageToken = null;

    while (videos.length < maxResults) {
      const params = {
        part: 'snippet,contentDetails',
        playlistId: resolved.uploadsPlaylistId,
        maxResults: Math.min(50, maxResults - videos.length)
      };
      if (pageToken) params.pageToken = pageToken;
      const data = await youtube('playlistItems', params);
      videos.push(...(data.items || []).map(item => mapVideo(item, resolved)).filter(v => v.id && v.channelId === resolved.channelId));
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }

    return videos;
  }

  async enrichVideoDetails(videos) {
    if (!videos.length || !config.youtubeApiKey) return videos;
    const details = new Map();
    for (let index = 0; index < videos.length; index += 50) {
      const ids = videos.slice(index, index + 50).map(video => video.id).filter(Boolean);
      if (!ids.length) continue;
      const data = await youtube('videos', { part: 'contentDetails,status', id: ids.join(',') });
      for (const item of data.items || []) {
        details.set(item.id, {
          durationSeconds: parseIsoDuration(item.contentDetails?.duration || ''),
          embeddable: item.status?.embeddable !== false,
          privacyStatus: item.status?.privacyStatus || 'public'
        });
      }
    }
    return videos.map(video => ({ ...video, ...(details.get(video.id) || {}) }));
  }

  async fetchPlaylistVideoIds(playlistId, maxResults = MAX_LIBRARY_RESULTS) {
    if (!config.youtubeApiKey) return [];
    const ids = [];
    let pageToken = null;
    while (ids.length < maxResults) {
      const params = {
        part: 'contentDetails',
        playlistId,
        maxResults: Math.min(50, maxResults - ids.length)
      };
      if (pageToken) params.pageToken = pageToken;
      const data = await youtube('playlistItems', params);
      ids.push(...(data.items || []).map(item => item.contentDetails?.videoId).filter(Boolean));
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
    return ids;
  }

  async fetchCreatorArcPlaylists(creator, videos) {
    if (!config.youtubeApiKey) return [];
    const resolved = await this.resolveCreator(creator);
    const playlists = [];
    let pageToken = null;
    while (playlists.length < 100) {
      const params = {
        part: 'snippet,contentDetails',
        channelId: resolved.channelId,
        maxResults: 50
      };
      if (pageToken) params.pageToken = pageToken;
      const data = await youtube('playlists', params);
      playlists.push(...(data.items || []));
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }

    const knownIds = new Set(videos.map(video => video.id));
    const candidates = playlists
      .filter(item => looksLikeArcPlaylist(item.snippet?.title, item.snippet?.description))
      .slice(0, MAX_ARC_PLAYLISTS_PER_CREATOR);
    const folders = [];

    for (const playlist of candidates) {
      try {
        const allIds = await this.fetchPlaylistVideoIds(playlist.id);
        const videoIds = allIds.filter(id => knownIds.has(id));
        if (!videoIds.length) continue;
        const arc = classifyArcTitle(playlist.snippet?.title || 'Unstable');
        folders.push({
          id: playlist.id,
          creatorId: creator.id,
          creator: creator.name,
          title: playlist.snippet?.title || `${arc.name} Arc`,
          arcKey: arc.key,
          arcName: arc.name,
          description: playlist.snippet?.description || '',
          thumbnail: playlist.snippet?.thumbnails?.high?.url || playlist.snippet?.thumbnails?.medium?.url || '',
          itemCount: playlist.contentDetails?.itemCount || videoIds.length,
          videoIds
        });
      } catch (error) {
        console.warn(`[youtube] ${creator.name} arc playlist skipped: ${error.message}`);
      }
    }

    return folders;
  }

  async notifyNewVideos(creator, videos) {
    if (!videos.length) return;
    const previousId = this.store.state.seenVideos[creator.id];
    const newest = videos[0];

    if (!previousId) {
      this.store.setSeenVideo(creator.id, newest.id);
      return;
    }

    const unseen = getUnseenVideos(videos, previousId);
    if (!unseen.length) return;
    this.store.setSeenVideo(creator.id, newest.id);

    for (const video of unseen) await this.onUpload(video);
  }

  async poll({ notify = true, full = false } = {}) {
    if (this.polling) return;
    this.polling = true;
    let anySuccess = false;
    try {
      for (const creator of creators) {
        try {
          const rawVideos = await this.fetchCreatorVideos(creator, full ? MAX_LIBRARY_RESULTS : 30);
          const enrichedVideos = await this.enrichVideoDetails(rawVideos);
          let arcPlaylists = this.store.state.arcPlaylists?.[creator.id] || [];

          if (full) {
            try {
              arcPlaylists = await this.fetchCreatorArcPlaylists(creator, enrichedVideos);
            } catch (error) {
              console.warn(`[youtube] ${creator.name} arc discovery: ${error.message}`);
            }
          }

          const videos = filterUnstableVideos(enrichedVideos, arcPlaylists);
          const allowedIds = new Set(videos.map(video => video.id));
          arcPlaylists = arcPlaylists
            .map(playlist => ({ ...playlist, videoIds: (playlist.videoIds || []).filter(id => allowedIds.has(id)) }))
            .filter(playlist => playlist.videoIds.length);

          if (full && config.youtubeApiKey) {
            this.store.setLatestVideos(creator.id, videos);
            this.store.setArcPlaylists(creator.id, arcPlaylists);
          } else if (videos.length) {
            const existing = (this.store.state.latestVideos[creator.id] || []).filter(video => video.isUnstable !== false && video.isShort !== true && video.channelId === this.resolved.get(creator.id)?.channelId);
            const incomingIds = new Set(videos.map(v => v.id));
            const merged = [...videos, ...existing.filter(v => !incomingIds.has(v.id))].slice(0, MAX_LIBRARY_RESULTS);
            this.store.setLatestVideos(creator.id, merged);
          }

          if (notify) await this.notifyNewVideos(creator, videos);
          else if (videos[0]) this.store.setSeenVideo(creator.id, videos[0].id);
          this.creatorErrors.delete(creator.id);
          anySuccess = true;
        } catch (error) {
          this.creatorErrors.set(creator.id, error.message);
          this.lastError = `${creator.name}: ${error.message}`;
          console.error('[youtube]', this.lastError);
        }
      }
      if (anySuccess) {
        this.lastSuccessAt = new Date().toISOString();
        this.lastError = this.creatorErrors.size ? [...this.creatorErrors.values()].join('; ') : null;
      }
    } finally {
      this.polling = false;
    }
  }

  async start() {
    await this.poll({ notify: false, full: true });
    this.timer = setInterval(() => this.poll({ notify: true, full: false }), config.pollIntervalMs);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  getFeed() {
    return creators.map(creator => {
      const resolved = this.resolved.get(creator.id) || creator;
      return {
        ...creator,
        channelId: resolved?.channelId || null,
        channelUrl: resolved?.channelUrl || `https://www.youtube.com/@${creator.handle}`,
        avatar: resolved?.avatar || '',
        syncError: this.creatorErrors.get(creator.id) || null,
        videos: (this.store.state.latestVideos[creator.id] || []).filter(video => resolved?.channelId && video.channelId === resolved.channelId && video.creatorId === creator.id),
        arcPlaylists: this.store.state.arcPlaylists?.[creator.id] || []
      };
    });
  }
}
