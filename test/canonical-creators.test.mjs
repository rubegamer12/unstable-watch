import test from 'node:test';
import assert from 'node:assert/strict';
import { creators, config } from '../src/config.mjs';
import { parseYouTubeAtomFeed } from '../src/youtube-public-feed.mjs';
import { YouTubeService } from '../src/youtube.mjs';

const atom = (c, id = c.id) => `<feed><yt:channelId>${c.channelId.slice(2)}</yt:channelId><author><name>${c.name}</name><uri>https://www.youtube.com/channel/${c.channelId}</uri></author><entry><yt:videoId>${id}</yt:videoId><yt:channelId>${c.channelId}</yt:channelId><title>Unstable SMP episode</title><published>2026-09-22T00:00:00Z</published></entry></feed>`;
for (const creator of creators) {
  test(`${creator.name} feed keeps canonical ownership, including prefixless Atom header`, () => {
    const [video] = parseYouTubeAtomFeed(atom(creator), creator);
    assert.equal(video.creatorId, creator.id);
    assert.equal(video.creator, creator.name);
    assert.equal(video.channelId, creator.channelId);
  });
}
test('Parrot feed or author identity is rejected when Spoke is expected', () => {
  assert.throws(() => parseYouTubeAtomFeed(atom(creators[1]), creators[0]), /does not match/);
  assert.throws(() => parseYouTubeAtomFeed(atom(creators[0]).replace('<name>Spoke', '<name>Parrot'), creators[0]), /author/);
});
test('no-key polling skips handle pages, preserves a failed creator and keeps other creators', async () => {
  const previousFetch = globalThis.fetch;
  const key = config.youtubeApiKey;
  config.youtubeApiKey = '';
  const state = { latestVideos: {}, seenVideos: {}, arcPlaylists: {} };
  const store = {state, setLatestVideos: (id, videos) => state.latestVideos[id] = videos, setSeenVideo: (id, v) => state.seenVideos[id] = v, setArcPlaylists: (id, p) => state.arcPlaylists[id] = p};
  const cached = {...parseYouTubeAtomFeed(atom(creators[0], 'cached-spoke'), creators[0])[0], isUnstable:true};
  state.latestVideos.spoke = [cached];
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    const id = new URL(url).searchParams.get('channel_id');
    const creator = creators.find(c => c.channelId === id);
    assert.ok(creator, 'Only canonical feed endpoints should be requested');
    return new Response(atom(creator.id === 'spoke' ? creators[1] : creator));
  };
  try {
    const service = new YouTubeService(store);
    await service.poll({notify:false, full:true});
    assert.equal(service.mode, 'public-feed');
    assert.equal(urls.length,4);
    assert.deepEqual(state.latestVideos.spoke,[cached]);
    assert.equal(service.getFeed()[0].videos[0].id,'cached-spoke');
    for (const c of creators.slice(1)) assert.equal(state.latestVideos[c.id][0].creatorId,c.id);
    assert.ok(service.creatorErrors.has('spoke'));
  } finally { globalThis.fetch = previousFetch; config.youtubeApiKey = key; }
});
