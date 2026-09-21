const state = {
  feed: null,
  config: null,
  videos: [],
  watchOrder: [],
  arcFolders: [],
  activeArc: null,
  activePlaylist: null,
  filteredVideos: [],
  libraryFilter: 'all',
  libraryVisible: 24,
  player: null,
  currentVideo: null,
  playerTicker: null,
  idleTimer: null,
  upNextTimer: null,
  playerReady: false,
  playerRates: [1, 1.25, 1.5, 1.75, 2],
  playerRateIndex: 0,
  playerOpenToken: 0,
  captionsEnabled: false,
  captionTrack: null,
  captionApiReady: false,
  deepLinkHandled: false,
  liveConnected: false,
  liveSource: null,
  liveConnectTimer: null,
  feedPollTimer: null,
  notificationPrefs: null
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const desktopBridge = window.unstableDesktop || null;

function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Math.max(0, Date.now() - d.getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
  });
}

function fmtTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

function shortTitle(title = '', max = 46) {
  return title.length > max ? `${title.slice(0, max - 1)}…` : title;
}

function creatorFor(id) {
  return state.feed?.creators.find(creator => creator.id === id);
}

function isUnstableLongform(video) {
  if (!video?.id) return false;
  if (video.isShort === true) return false;
  if (/(?:^|[\s#])shorts?(?:$|[\s#])/i.test(`${video.title || ''} ${video.description || ''}`)) return false;
  if (Number.isFinite(video.durationSeconds) && video.durationSeconds > 0 && video.durationSeconds <= 180) return false;
  // The server already decides which protagonist uploads belong in the
  // library. Do not repeat the strict metadata test in the browser: doing so
  // was the v3.3 bug that could turn a valid feed into an empty page.
  return true;
}

function toast(title, body, icon = 'U') {
  const node = document.createElement('div');
  node.className = 'toast';
  const iconNode = document.createElement('div');
  iconNode.className = 'toast-icon';
  iconNode.textContent = icon;
  const copy = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = title;
  const text = document.createElement('p');
  text.textContent = body;
  copy.append(strong, text);
  node.append(iconNode, copy);
  $('#toastStack').appendChild(node);
  setTimeout(() => node.remove(), 5200);
}

function getProgress() {
  try {
    return JSON.parse(localStorage.getItem('unstable-progress') || '{}');
  } catch {
    return {};
  }
}

function saveProgress(videoId, current, duration) {
  if (!videoId || !duration || current < 15) return;
  const all = getProgress();
  all[videoId] = { current, duration, updatedAt: Date.now() };
  const entries = Object.entries(all).sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0)).slice(0, 80);
  localStorage.setItem('unstable-progress', JSON.stringify(Object.fromEntries(entries)));
}

function getMyList() {
  try {
    return JSON.parse(localStorage.getItem('unstable-my-list') || '[]');
  } catch {
    return [];
  }
}

function isInMyList(videoId) {
  return getMyList().includes(videoId);
}

function toggleMyList(video) {
  if (!video) return;
  const list = new Set(getMyList());
  const adding = !list.has(video.id);
  adding ? list.add(video.id) : list.delete(video.id);
  localStorage.setItem('unstable-my-list', JSON.stringify([...list]));
  toast(adding ? 'Added to My list' : 'Removed from My list', video.title, adding ? '＋' : '−');
  updateListButtons();
  renderMyList();
}

function updateListButtons() {
  const heroVideo = state.videos[0];
  if (heroVideo) $('#heroMyList').textContent = isInMyList(heroVideo.id) ? '✓ In My list' : '＋ My list';
  if (state.currentVideo) $('#playerListBtn').textContent = isInMyList(state.currentVideo.id) ? '✓ My list' : '＋ My list';
}

function videoCard(video, { compact = false, context = null, order = null } = {}) {
  const creator = creatorFor(video.creatorId) || { name: video.creator, accent: '#8b5cff' };
  const progress = getProgress()[video.id];
  const card = document.createElement('article');
  card.className = `video-card${compact ? ' compact-card' : ''}`;
  card.style.setProperty('--card-accent', creator.accent || '#8b5cff');
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `Play ${video.title}`);
  if (order != null) card.dataset.order = String(order);

  const image = document.createElement('img');
  image.loading = 'lazy';
  image.alt = '';
  image.src = video.thumbnail;
  image.referrerPolicy = 'no-referrer';

  const overlay = document.createElement('div');
  overlay.className = 'card-overlay';
  const creatorLine = document.createElement('div');
  creatorLine.className = 'card-creator';
  const pip = document.createElement('span');
  pip.className = 'creator-pip';
  const creatorName = document.createElement('span');
  creatorName.textContent = creator.name;
  creatorLine.append(pip, creatorName);
  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = video.title;
  const date = document.createElement('div');
  date.className = 'card-date';
  date.textContent = fmtDate(video.publishedAt);
  overlay.append(creatorLine, title, date);

  const play = document.createElement('div');
  play.className = 'card-play';
  play.textContent = '▶';
  card.append(image, overlay, play);

  if (isInMyList(video.id)) {
    const badge = document.createElement('span');
    badge.className = 'card-badge';
    badge.textContent = 'My list';
    card.appendChild(badge);
  }

  if (progress?.duration > 0 && progress.current > 15) {
    const progressBar = document.createElement('div');
    progressBar.className = 'card-progress';
    const fill = document.createElement('span');
    fill.style.width = `${Math.min(100, Math.max(0, (progress.current / progress.duration) * 100))}%`;
    progressBar.appendChild(fill);
    card.appendChild(progressBar);
  }

  const open = () => openPlayer(video, context);
  card.addEventListener('click', open);
  card.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  });
  return card;
}

function renderStats() {
  $('#statVideos').textContent = state.videos.length.toLocaleString();
  $('#statCreators').textContent = state.feed?.creators.length || 0;
  $('#statEvents').textContent = (state.feed?.recentEvents || []).length;
  $('#statUpdated').textContent = state.liveConnected ? 'Live' : 'Syncing';
}

function renderLatest() {
  const rail = $('#latestRail');
  rail.classList.remove('skeleton-rail');
  rail.innerHTML = '';
  state.videos.slice(0, 18).forEach(video => rail.appendChild(videoCard(video)));
}

function renderCreators() {
  const grid = $('#creatorGrid');
  grid.innerHTML = '';
  state.feed.creators.forEach((creator, index) => {
    const card = document.createElement('article');
    card.className = 'creator-card';
    card.style.setProperty('--creator-accent', creator.accent);
    card.tabIndex = 0;
    card.setAttribute('role', 'button');

    const number = document.createElement('span');
    number.className = 'creator-number';
    number.textContent = String(index + 1).padStart(2, '0');

    let avatar;
    if (creator.avatar) {
      avatar = document.createElement('img');
      avatar.className = 'creator-avatar';
      avatar.src = creator.avatar;
      avatar.alt = creator.name;
      avatar.referrerPolicy = 'no-referrer';
    } else {
      avatar = document.createElement('div');
      avatar.className = 'creator-avatar creator-fallback';
      avatar.textContent = creator.name[0];
    }

    const name = document.createElement('h3');
    name.textContent = creator.name;
    const tagline = document.createElement('p');
    tagline.textContent = creator.tagline;
    const count = document.createElement('p');
    count.textContent = `${creator.videos?.length || 0} indexed uploads`;
    count.style.marginTop = '8px';
    const arrow = document.createElement('span');
    arrow.className = 'creator-arrow';
    arrow.textContent = '→';
    card.append(number, avatar, name, tagline, count, arrow);

    const choose = () => {
      setLibraryFilter(creator.id);
      $('#library').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    card.addEventListener('click', choose);
    card.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        choose();
      }
    });
    grid.appendChild(card);
  });
}

function allVideosContext() {
  return { id: 'all-order', title: 'All videos · oldest to newest', videos: state.watchOrder };
}

function renderStoryOrder() {
  const rail = $('#storyRail');
  rail.innerHTML = '';
  $('#storyOrderCount').textContent = state.watchOrder.length.toLocaleString();
  const context = allVideosContext();
  state.watchOrder.slice(0, 24).forEach((video, index) => {
    rail.appendChild(videoCard(video, { context, order: index + 1 }));
  });
  $('#playAllStart').disabled = !state.watchOrder.length;
}

const ARC_FALLBACK_RULES = [
  ['spoke-exploit', 'Spoke Exploit', /spoke\s*(?:'s)?\s*exploit|exploit\s*arc/i],
  ['zam', 'Zam', /\bzam\b/i], ['clownpierce', 'ClownPierce', /clown\s*pierce|clownpierce/i],
  ['prison', 'Prison', /\bprison\b/i], ['mafia', 'Mafia', /\bmafia\b/i], ['pirate', 'Pirate', /\bpirate\b/i],
  ['director', 'Director', /\bdirector\b/i], ['100-days', '100 Days', /100\s*days?|hundred\s*days?/i],
  ['power-vs-skill', 'Power vs Skill', /power\s*(?:vs\.?|versus)\s*skill/i], ['power', 'Power', /\bpower\b/i],
  ['toxic-players', 'Toxic Players', /toxic\s*(?:players?|team)/i], ['farlands', 'Farlands', /far\s*lands?|farlanda/i],
  ['betrayal', 'Betrayal', /betray(?:al|ed)|bertrayal/i], ['bat', 'B.A.T.', /\bb\.?\s*a\.?\s*t\.?\b|\bbat\s*arc/i],
  ['treasure', 'Treasure', /\btreasure\b/i], ['fake-identity', 'Fake Identity', /fake\s*identity/i],
  ['training', 'Training', /\btraining\b/i], ['election', 'Election', /\belection\b/i], ['great-sea', 'Great Sea', /great\s*sea/i],
  ['law', 'The Law', /\bthe\s*law\b|\blaw\s*arc/i], ['true-kings', 'True Kings', /true\s*kings?/i],
  ['kings', 'Kings', /\bkings?\b/i], ['blue-trims', 'Blue Trims', /blue\s*trims?|invisible\s*(?:guy|dude|player)/i],
  ['cindercrest', 'Cindercrest', /cinder\s*crest|cindercrest|cave\s*kingdom/i], ['kingdoms', 'Kingdoms', /\bkingdoms?\b/i],
  ['null', 'NULL', /\bnull\b/i], ['purgatory', 'Purgatory', /\bpurgatory\b/i], ['warriors', 'Warriors', /\bwarriors?\b/i],
  ['underworld', 'Underworld', /\bunderworld\b/i]
];

function buildArcFolders() {
  const byVideoId = new Map(state.videos.map(video => [video.id, video]));
  const folders = new Map();
  const addVideos = (key, name, videos, playlist = null) => {
    if (!videos.length) return;
    const folder = folders.get(key) || { key, name, videos: [], creators: new Set(), playlistTitles: new Set(), thumbnails: [] };
    const seen = new Set(folder.videos.map(video => video.id));
    videos.forEach(video => {
      if (!video || seen.has(video.id)) return;
      seen.add(video.id);
      folder.videos.push(video);
      folder.creators.add(video.creatorId);
      if (video.thumbnail && folder.thumbnails.length < 4) folder.thumbnails.push(video.thumbnail);
    });
    if (playlist?.title) folder.playlistTitles.add(playlist.title);
    folders.set(key, folder);
  };

  let playlistFolderCount = 0;
  for (const creator of state.feed?.creators || []) {
    for (const playlist of creator.arcPlaylists || []) {
      const videos = (playlist.videoIds || []).map(id => byVideoId.get(id)).filter(Boolean);
      if (!videos.length) continue;
      addVideos(playlist.arcKey || playlist.id, playlist.arcName || playlist.title || 'Unstable', videos, playlist);
      playlistFolderCount += 1;
    }
  }

  // Fallback for videos whose titles/descriptions explicitly name an arc. This also helps while playlist discovery is still syncing.
  for (const video of state.videos) {
    const text = `${video.title} ${video.description || ''}`;
    for (const [key, name, matcher] of ARC_FALLBACK_RULES) {
      if (matcher.test(text)) {
        addVideos(key, name, [video]);
        break;
      }
    }
  }

  state.arcFolders = [...folders.values()]
    .map(folder => ({
      ...folder,
      creators: [...folder.creators],
      playlistTitles: [...folder.playlistTitles],
      videos: folder.videos.sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt)),
      firstPublishedAt: folder.videos.reduce((first, video) => !first || new Date(video.publishedAt) < new Date(first) ? video.publishedAt : first, null)
    }))
    .filter(folder => folder.videos.length)
    .sort((a, b) => new Date(a.firstPublishedAt || 0) - new Date(b.firstPublishedAt || 0));

  return playlistFolderCount;
}

function renderArcFolders() {
  const root = $('#arcFolderGrid');
  root.innerHTML = '';
  const playlistCount = buildArcFolders();
  $('#arcSyncNote').textContent = playlistCount
    ? `${state.arcFolders.length} folders merged from creator arc playlists`
    : 'Creator arc playlists are still syncing · title-based folders shown for now';
  $('#arcEmpty').classList.toggle('hidden', state.arcFolders.length !== 0);

  state.arcFolders.forEach(folder => {
    const card = document.createElement('article');
    card.className = 'arc-folder';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Open ${folder.name} arc`);
    const art = document.createElement('div');
    art.className = 'arc-folder-art';
    const thumbs = folder.videos.slice(-4).map(video => video.thumbnail).filter(Boolean);
    (thumbs.length ? thumbs : folder.thumbnails).slice(0, 4).forEach(src => {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.src = src;
      art.appendChild(img);
    });
    const shade = document.createElement('div');
    shade.className = 'arc-folder-shade';
    const copy = document.createElement('div');
    copy.className = 'arc-folder-copy';
    const label = document.createElement('span');
    label.textContent = `▰ ARC FOLDER · ${folder.videos.length} VIDEOS`;
    const title = document.createElement('h3');
    title.textContent = folder.name;
    const meta = document.createElement('p');
    meta.textContent = `${folder.creators.length} perspective${folder.creators.length === 1 ? '' : 's'} · oldest to newest`;
    const dots = document.createElement('div');
    dots.className = 'arc-creator-dots';
    folder.creators.forEach(id => {
      const dot = document.createElement('i');
      dot.style.setProperty('--dot', creatorFor(id)?.accent || '#8b5cff');
      dots.appendChild(dot);
    });
    copy.append(label, title, meta, dots);
    card.append(art, shade, copy);
    const open = () => openArcFolder(folder);
    card.addEventListener('click', open);
    card.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
    });
    root.appendChild(card);
  });
}

function arcContext(folder) {
  return { id: `arc-${folder.key}`, title: `${folder.name} Arc`, videos: folder.videos };
}

function openArcFolder(folder) {
  if (!folder) return;
  state.activeArc = folder;
  $('#arcModalTitle').textContent = folder.name;
  $('#arcModalMeta').textContent = `${folder.videos.length} videos · ${folder.creators.map(id => creatorFor(id)?.name || id).join(' · ')} · oldest to newest`;
  const grid = $('#arcVideoGrid');
  grid.innerHTML = '';
  const context = arcContext(folder);
  folder.videos.forEach((video, index) => grid.appendChild(videoCard(video, { compact: true, context, order: index + 1 })));
  $('#arcOverlay').classList.add('open');
  $('#arcOverlay').setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeArcFolder() {
  state.activeArc = null;
  $('#arcOverlay').classList.remove('open');
  $('#arcOverlay').setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function renderFilterBar() {
  const root = $('#filterBar');
  root.innerHTML = '';
  const options = [{ id: 'all', name: 'All perspectives', accent: '#ffffff' }, ...state.feed.creators];
  options.forEach(option => {
    const button = document.createElement('button');
    button.className = `filter-chip${state.libraryFilter === option.id ? ' active' : ''}`;
    button.dataset.creator = option.id;
    button.textContent = option.name;
    button.addEventListener('click', () => setLibraryFilter(option.id));
    root.appendChild(button);
  });
}

function setLibraryFilter(creatorId) {
  state.libraryFilter = creatorId;
  state.libraryVisible = 24;
  renderFilterBar();
  renderLibrary();
}

function renderLibrary() {
  const source = state.libraryFilter === 'all' ? state.videos : state.videos.filter(video => video.creatorId === state.libraryFilter);
  state.filteredVideos = source;
  const visible = source.slice(0, state.libraryVisible);
  const grid = $('#libraryGrid');
  grid.innerHTML = '';
  visible.forEach(video => grid.appendChild(videoCard(video, { compact: true })));
  $('#libraryCount').textContent = `${source.length.toLocaleString()} video${source.length === 1 ? '' : 's'}`;
  $('#libraryEmpty').classList.toggle('hidden', source.length !== 0);
  $('#loadMore').classList.toggle('hidden', visible.length >= source.length || source.length === 0);
}

function renderEvents() {
  const root = $('#eventFeed');
  const events = state.feed.recentEvents || [];
  if (!events.length) {
    root.innerHTML = '<div class="empty-event">Waiting for events from Discord…</div>';
    return;
  }
  root.innerHTML = '';
  events.forEach(event => {
    const item = document.createElement(event.jumpUrl ? 'a' : 'div');
    item.className = 'event-item';
    if (event.jumpUrl) {
      item.href = event.jumpUrl;
      item.target = '_blank';
      item.rel = 'noopener noreferrer';
    }
    const meta = document.createElement('div');
    meta.className = 'event-meta';
    const author = document.createElement('strong');
    author.textContent = event.author || 'Unstable Events';
    const date = document.createElement('span');
    date.textContent = fmtDate(event.createdAt);
    meta.append(author, date);
    const content = document.createElement('p');
    content.textContent = event.content;
    item.append(meta, content);
    root.appendChild(item);
  });
}

function renderContinue() {
  const progress = getProgress();
  const items = state.videos
    .filter(video => progress[video.id]?.current > 15 && progress[video.id]?.current < progress[video.id]?.duration - 20)
    .sort((a, b) => (progress[b.id]?.updatedAt || 0) - (progress[a.id]?.updatedAt || 0));
  const section = $('#continueSection');
  const rail = $('#continueRail');
  rail.innerHTML = '';
  if (!items.length) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');
  items.slice(0, 12).forEach(video => rail.appendChild(videoCard(video)));
}

function renderMyList() {
  const ids = new Set(getMyList());
  const items = state.videos.filter(video => ids.has(video.id));
  const section = $('#myListSection');
  const rail = $('#myListRail');
  rail.innerHTML = '';
  if (!items.length) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');
  items.forEach(video => rail.appendChild(videoCard(video)));
}

function setHero(video) {
  if (!video) return;
  const creator = creatorFor(video.creatorId);
  $('#heroBackdrop').style.backgroundImage = `linear-gradient(90deg,rgba(7,7,11,.08),rgba(7,7,11,.08)),url("${video.thumbnail}")`;
  $('#heroTitle').textContent = '';
  $('#heroTitle').append(document.createTextNode(shortTitle(video.title, 42)), document.createElement('br'));
  const em = document.createElement('em');
  em.textContent = `${creator?.name || video.creator}.`;
  $('#heroTitle').appendChild(em);
  $('#heroDescription').textContent = video.description?.slice(0, 210) || `The newest Unstable perspective from ${creator?.name || video.creator}.`;
  const meta = $('#heroMeta');
  meta.innerHTML = '';
  [creator?.name || video.creator, fmtDate(video.publishedAt), 'Newest upload'].forEach((text, index) => {
    if (index) meta.appendChild(document.createElement('i'));
    const span = document.createElement('span');
    span.textContent = text;
    meta.appendChild(span);
  });
  $('#heroPlay').onclick = () => openPlayer(video);
  $('#heroMyList').onclick = () => toggleMyList(video);
  updateListButtons();
}

function renderFeed() {
  state.videos = state.feed.creators
    .flatMap(creator => creator.videos || [])
    .filter(video => isUnstableLongform(video))
    .filter((video, index, all) => all.findIndex(item => item.id === video.id) === index)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  state.watchOrder = [...state.videos].sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));
  if (state.activePlaylist?.id === 'all-order') state.activePlaylist = allVideosContext();
  renderStats();
  renderLatest();
  renderStoryOrder();
  renderCreators();
  renderArcFolders();
  renderFilterBar();
  renderLibrary();
  renderEvents();
  renderContinue();
  renderMyList();
  setHero(state.videos[0]);

  if (!state.deepLinkHandled) {
    state.deepLinkHandled = true;
    const queryId = new URLSearchParams(location.search).get('watch');
    const match = state.videos.find(video => video.id === queryId);
    if (match) setTimeout(() => openPlayer(match, allVideosContext()), 120);
  }
}

function normalizePlaylistContext(context, video = state.currentVideo) {
  const candidate = context?.videos?.length ? context : allVideosContext();
  if (!video || candidate.videos.some(item => item.id === video.id)) return candidate;
  return allVideosContext();
}

function playlistVideos() {
  return normalizePlaylistContext(state.activePlaylist, state.currentVideo).videos || [];
}

function getNextVideo(video = state.currentVideo) {
  if (!video) return null;
  const list = playlistVideos();
  const index = list.findIndex(item => item.id === video.id);
  return index >= 0 && index + 1 < list.length ? list[index + 1] : null;
}

function getPrevVideo(video = state.currentVideo) {
  if (!video) return null;
  const list = playlistVideos();
  const index = list.findIndex(item => item.id === video.id);
  return index > 0 ? list[index - 1] : null;
}

function ensureYouTubeReady() {
  return new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve();
    let settled = false;
    const old = window.onYouTubeIframeAPIReady;
    const timer = setTimeout(() => {
      if (!settled) reject(new Error('YouTube player API timed out'));
    }, 12_000);
    window.onYouTubeIframeAPIReady = () => {
      old?.();
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
  });
}

function resetPlayerMount() {
  try { state.player?.destroy?.(); } catch {}
  state.player = null;
  state.playerReady = false;
  const existing = $('#ytPlayer');
  existing?.remove();
  const mount = document.createElement('div');
  mount.id = 'ytPlayer';
  const screen = $('.player-screen');
  screen.insertBefore(mount, $('#playerError'));
}

function showPlayerError(code) {
  const messages = {
    5: ['Playback failed in the embedded player.', 'This can be a browser/HTML5 playback issue. Open the video on YouTube if retrying does not work.'],
    100: ['This video is unavailable.', 'It may have been removed, made private, or changed by the uploader.'],
    101: ['Embedding is disabled for this video.', 'The creator has chosen not to allow playback on third-party sites.'],
    150: ['Embedding is disabled for this video.', 'The creator has chosen not to allow playback on third-party sites.'],
    153: ['YouTube could not identify this embed.', 'If this continues, open the video on YouTube and check browser privacy/referrer settings.']
  };
  const [title, text] = messages[code] || ['YouTube returned a playback error.', 'Try opening the video directly on YouTube.'];
  $('#playerErrorTitle').textContent = title;
  $('#playerErrorText').textContent = text;
  $('#playerError').classList.remove('hidden');
}

function renderPlayerQueue() {
  const context = normalizePlaylistContext(state.activePlaylist, state.currentVideo);
  state.activePlaylist = context;
  const list = context.videos;
  const index = Math.max(0, list.findIndex(item => item.id === state.currentVideo?.id));
  const next = index >= 0 && index + 1 < list.length ? list[index + 1] : null;
  $('#playerPosition').textContent = list.length ? `${index + 1} / ${list.length}` : '—';
  $('#playerDockTitle').textContent = context.title;
  $('#playerNextTitle').textContent = next ? `Next: ${shortTitle(next.title, 58)}` : 'End of this collection';
  $('#prevBtn').disabled = index <= 0;
  $('#nextBtn').disabled = index < 0 || index >= list.length - 1;
}

function showPlayerChrome({ pin = false } = {}) {
  const modal = $('#playerModal');
  if (!modal?.classList.contains('open')) return;
  modal.classList.add('controls-visible');
  clearTimeout(state.idleTimer);
  if (pin || state.player?.getPlayerState?.() !== window.YT?.PlayerState?.PLAYING) return;
  state.idleTimer = setTimeout(() => modal.classList.remove('controls-visible'), 2600);
}

function updatePlayButton(playing) {
  $('#playPause').textContent = playing ? '❚❚' : '▶';
  $('#playPause').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  $('#playerModal').classList.toggle('is-paused', !playing);
  showPlayerChrome({ pin: !playing });
}

function togglePlay() {
  if (!state.playerReady) return;
  const playing = state.player.getPlayerState?.() === YT.PlayerState.PLAYING;
  playing ? state.player.pauseVideo() : state.player.playVideo();
}

function seekRelative(seconds) {
  if (!state.playerReady) return;
  const duration = state.player.getDuration?.() || 0;
  const current = state.player.getCurrentTime?.() || 0;
  state.player.seekTo(Math.max(0, Math.min(duration, current + seconds)), true);
}

function seekFromClientX(clientX) {
  if (!state.playerReady) return;
  const timeline = $('#timeline');
  const rect = timeline.getBoundingClientRect();
  if (!rect.width) return;
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  state.player.seekTo(ratio * (state.player.getDuration?.() || 0), true);
}

function updateCaptionButton() {
  const button = $('#ccBtn');
  button.textContent = 'CC';
  button.classList.toggle('is-off', !state.captionsEnabled);
  button.setAttribute('aria-pressed', state.captionsEnabled ? 'true' : 'false');
  button.title = state.captionApiReady
    ? `Captions ${state.captionsEnabled ? 'on' : 'off'} (C)`
    : 'Captions are not available for this video';
}

function setCaptionsEnabled(enabled, { quiet = false } = {}) {
  state.captionsEnabled = Boolean(enabled);
  if (!state.playerReady || !state.player) {
    updateCaptionButton();
    return false;
  }

  let changed = false;
  try {
    const modules = state.player.getOptions?.() || [];
    state.captionApiReady = modules.includes?.('captions') || typeof state.player.loadModule === 'function' || typeof state.player.unloadModule === 'function';

    if (!state.captionsEnabled) {
      try {
        const currentTrack = state.player.getOption?.('captions', 'track');
        if (currentTrack && typeof currentTrack === 'object' && Object.keys(currentTrack).length) state.captionTrack = currentTrack;
      } catch {}
      // YouTube does not document a caption on/off setter. These module hooks are
      // supported by the HTML5 player in practice; cc_load_policy=0 remains the fallback.
      state.player.unloadModule?.('captions');
      try { state.player.setOption?.('captions', 'track', {}); } catch {}
      changed = true;
    } else {
      state.player.loadModule?.('captions');
      const languageCode = (state.captionTrack?.languageCode || navigator.language || 'en').split('-')[0];
      try { state.player.setOption?.('captions', 'track', state.captionTrack || { languageCode }); } catch {}
      changed = true;
    }
  } catch (error) {
    console.warn('[player] Caption toggle:', error);
  }
  updateCaptionButton();
  if (!quiet && !changed) toast('Captions unavailable', 'YouTube did not expose caption controls for this video.', 'CC');
  return changed;
}

function toggleCaptions() {
  setCaptionsEnabled(!state.captionsEnabled);
}

function cycleSpeed() {
  if (!state.playerReady) return;
  const available = state.player.getAvailablePlaybackRates?.() || [1];
  const current = state.player.getPlaybackRate?.() || 1;
  const candidates = state.playerRates.filter(rate => available.includes(rate));
  if (!candidates.length) return;
  const index = Math.max(0, candidates.indexOf(current));
  const next = candidates[(index + 1) % candidates.length];
  state.player.setPlaybackRate(next);
  $('#speedBtn').textContent = `${next}×`;
}

function toggleMute() {
  if (!state.playerReady) return;
  state.player.isMuted?.() ? state.player.unMute?.() : state.player.mute?.();
  $('#volumeBtn').textContent = state.player.isMuted?.() ? '🔇' : '🔊';
}

async function toggleFullscreen() {
  const target = $('#playerMain');
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await target.requestFullscreen?.();
  } catch (error) {
    console.warn('[player] Fullscreen:', error);
  }
}

function startProgressSaver() {
  clearInterval(state.playerTicker);
  let saveTick = 0;
  state.playerTicker = setInterval(() => {
    if (!state.playerReady || !state.currentVideo) return;
    const current = state.player.getCurrentTime?.() || 0;
    const duration = state.player.getDuration?.() || 0;
    const loaded = state.player.getVideoLoadedFraction?.() || 0;
    const percent = duration ? Math.max(0, Math.min(100, current / duration * 100)) : 0;
    $('#timelineProgress').style.width = `${percent}%`;
    $('#timelineBuffer').style.width = `${Math.max(0, Math.min(100, loaded * 100))}%`;
    $('#timelineThumb').style.left = `${percent}%`;
    $('#timecode').textContent = `${fmtTime(current)} / ${fmtTime(duration)}`;
    $('#timeline').setAttribute('aria-valuenow', String(Math.round(percent)));
    saveTick += 1;
    if (saveTick % 5 === 0) saveProgress(state.currentVideo.id, current, duration);
  }, 1000);
}

async function openPlayer(video, context = null) {
  if (!video) return;
  const openToken = ++state.playerOpenToken;
  if (state.playerReady && state.currentVideo) {
    saveProgress(state.currentVideo.id, state.player.getCurrentTime?.() || 0, state.player.getDuration?.() || 0);
  }
  clearTimeout(state.upNextTimer);
  state.upNextTimer = null;
  state.currentVideo = video;
  state.activePlaylist = normalizePlaylistContext(context || state.activePlaylist, video);

  const modal = $('#playerModal');
  modal.classList.add('open', 'controls-visible', 'is-paused');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  document.body.classList.add('player-active');
  $('#playerTitle').textContent = video.title;
  $('#playerCreator').textContent = video.creator;
  $('#youtubeFallback').href = video.watchUrl;
  $('#playerErrorLink').href = video.watchUrl;
  $('#playerError').classList.add('hidden');
  updateListButtons();
  renderPlayerQueue();

  const url = new URL(location.href);
  url.searchParams.set('watch', video.id);
  history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);

  try {
    await ensureYouTubeReady();
    if (openToken !== state.playerOpenToken || state.currentVideo?.id !== video.id) return;
    resetPlayerMount();
    const progress = getProgress()[video.id];
    const origin = /^https?:$/.test(location.protocol) ? location.origin : undefined;
    state.player = new YT.Player('ytPlayer', {
      host: 'https://www.youtube-nocookie.com',
      videoId: video.id,
      playerVars: {
        autoplay: 1,
        controls: 0,
        rel: 0,
        playsinline: 1,
        disablekb: 1,
        fs: 0,
        cc_load_policy: 0,
        iv_load_policy: 3,
        start: Math.floor(progress?.current || 0),
        origin
      },
      events: {
        onReady: event => {
          if (openToken !== state.playerOpenToken || state.currentVideo?.id !== video.id) {
            event.target.destroy?.();
            return;
          }
          state.playerReady = true;
          state.captionApiReady = false;
          state.captionsEnabled = false;
          event.target.setVolume?.(Number($('#volumeRange').value));
          event.target.setPlaybackRate?.(1);
          $('#speedBtn').textContent = '1×';
          $('#volumeBtn').textContent = event.target.isMuted?.() ? '🔇' : '🔊';
          updateCaptionButton();
          // Start with captions off even when the viewer's YouTube preference normally enables them.
          setTimeout(() => setCaptionsEnabled(false, { quiet: true }), 250);
          event.target.playVideo();
          startProgressSaver();
        },
        onStateChange: event => {
          updatePlayButton(event.data === YT.PlayerState.PLAYING);
          if (event.data !== YT.PlayerState.ENDED) return;
          const upcoming = getNextVideo();
          if (!upcoming) return;
          clearTimeout(state.upNextTimer);
          state.upNextTimer = setTimeout(() => {
            if (state.currentVideo?.id === video.id) openPlayer(upcoming, state.activePlaylist);
          }, 1200);
        },
        onApiChange: () => {
          if (openToken !== state.playerOpenToken || state.currentVideo?.id !== video.id) return;
          const modules = state.player?.getOptions?.() || [];
          state.captionApiReady = modules.includes?.('captions') || typeof state.player?.unloadModule === 'function';
          if (!state.captionsEnabled) setCaptionsEnabled(false, { quiet: true });
          else updateCaptionButton();
        },
        onError: event => showPlayerError(event.data)
      }
    });
  } catch (error) {
    console.error(error);
    showPlayerError(0);
  }
}

function closePlayer() {
  state.playerOpenToken += 1;
  if (state.playerReady && state.currentVideo) {
    saveProgress(state.currentVideo.id, state.player.getCurrentTime?.() || 0, state.player.getDuration?.() || 0);
  }
  clearInterval(state.playerTicker);
  state.playerTicker = null;
  clearTimeout(state.upNextTimer);
  state.upNextTimer = null;
  clearTimeout(state.idleTimer);
  state.idleTimer = null;
  resetPlayerMount();
  state.captionsEnabled = false;
  state.captionApiReady = false;
  updateCaptionButton();
  state.currentVideo = null;
  $('#playerModal').classList.remove('open', 'controls-visible', 'is-paused');
  $('#playerModal').setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  document.body.classList.remove('player-active');
  const url = new URL(location.href);
  url.searchParams.delete('watch');
  history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  renderContinue();
  renderMyList();
  renderLibrary();
}

function closeSearch() {
  $('#searchOverlay').classList.remove('open');
  $('#searchOverlay').setAttribute('aria-hidden', 'true');
  $('#searchInput').blur();
}

function renderSearch() {
  const query = $('#searchInput').value.toLowerCase().trim();
  const root = $('#searchResults');
  root.innerHTML = '';
  const results = query
    ? state.videos.filter(video => `${video.title} ${video.creator}`.toLowerCase().includes(query)).slice(0, 24)
    : state.videos.slice(0, 12);
  results.forEach(video => root.appendChild(videoCard(video, { compact: true })));
}

function defaultNotificationPrefs() {
  return {
    uploads: true,
    events: true,
    creators: state.config?.creators?.map(creator => creator.id) || ['spoke', 'parrot', 'wemmbu', 'flame']
  };
}

function getNotificationPrefs() {
  if (state.notificationPrefs) return state.notificationPrefs;
  try {
    state.notificationPrefs = { ...defaultNotificationPrefs(), ...JSON.parse(localStorage.getItem('unstable-notification-prefs') || '{}') };
  } catch {
    state.notificationPrefs = defaultNotificationPrefs();
  }
  return state.notificationPrefs;
}

function renderNotificationPrefs() {
  const prefs = getNotificationPrefs();
  $('#prefUploads').checked = prefs.uploads !== false;
  $('#prefEvents').checked = prefs.events !== false;
  const root = $('#creatorPrefGrid');
  root.innerHTML = '';
  for (const creator of state.config?.creators || []) {
    const label = document.createElement('label');
    label.className = 'creator-pref';
    label.style.setProperty('--creator-accent', creator.accent);
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = creator.id;
    input.checked = prefs.creators?.includes(creator.id) !== false;
    const dot = document.createElement('i');
    const text = document.createElement('span');
    text.textContent = creator.name;
    label.append(input, dot, text);
    root.appendChild(label);
  }
  $('#creatorPrefGrid').classList.toggle('hidden', !$('#prefUploads').checked);
}

async function currentPushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const registration = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Service worker is not ready')), 8000))
  ]);
  return registration.pushManager.getSubscription();
}

async function openNotificationSettings() {
  renderNotificationPrefs();
  $('#notifyOverlay').classList.add('open');
  $('#notifyOverlay').setAttribute('aria-hidden', 'false');
  const subscription = await currentPushSubscription().catch(() => null);
  $('#disableNotifyPrefs').classList.toggle('hidden', !subscription);
  $('#notifyStatus').textContent = subscription
    ? 'Alerts are enabled on this browser. Save to update what you receive.'
    : 'Your browser will ask for permission when you enable alerts.';
}

function closeNotificationSettings() {
  $('#notifyOverlay').classList.remove('open');
  $('#notifyOverlay').setAttribute('aria-hidden', 'true');
}

async function saveNotificationPreferences() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    toast('Notifications unavailable', 'This browser does not support web push.', '!');
    return;
  }
  if (!window.isSecureContext) {
    toast('HTTPS required', 'Web push works on HTTPS sites (or localhost during development).', '!');
    return;
  }
  if (!state.config?.vapidPublicKey) {
    toast('Push is not ready', 'The server did not provide a push key.', '!');
    return;
  }

  const prefs = {
    uploads: $('#prefUploads').checked,
    events: $('#prefEvents').checked,
    creators: $$('#creatorPrefGrid input:checked').map(input => input.value)
  };
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    toast('Notifications blocked', 'Allow notifications in your browser settings to enable alerts.', '!');
    return;
  }

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(state.config.vapidPublicKey)
    });
  }

  const response = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subscription, prefs })
  });
  if (!response.ok) throw new Error('Could not save push subscription');
  state.notificationPrefs = prefs;
  localStorage.setItem('unstable-notification-prefs', JSON.stringify(prefs));
  $('#notifyBtn span:last-child').textContent = 'Alerts on';
  $('#disableNotifyPrefs').classList.remove('hidden');
  $('#notifyStatus').textContent = 'Saved. This device will only receive the alerts selected above.';
  toast('Notifications enabled', 'Your alert preferences were saved.', '✓');
}

async function disableNotifications() {
  const subscription = await currentPushSubscription();
  if (!subscription) return;
  await fetch('/api/push/unsubscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint })
  }).catch(() => {});
  await subscription.unsubscribe();
  $('#notifyBtn span:last-child').textContent = 'Notifications';
  $('#disableNotifyPrefs').classList.add('hidden');
  $('#notifyStatus').textContent = 'Alerts are disabled on this browser.';
  toast('Notifications disabled', 'This device will no longer receive Unstable alerts.', '✓');
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
}

function wireUI() {
  addEventListener('scroll', () => {
    $('#topbar').classList.toggle('scrolled', scrollY > 24);
    const max = document.documentElement.scrollHeight - innerHeight;
    $('#scrollProgress').style.width = `${max > 0 ? (scrollY / max) * 100 : 0}%`;
  }, { passive: true });

  $$('[data-rail]').forEach(button => {
    button.onclick = () => {
      const rail = $(`#${button.dataset.rail}`);
      rail.scrollBy({ left: Number(button.dataset.dir) * rail.clientWidth * 0.82, behavior: 'smooth' });
    };
  });

  $('#loadMore').onclick = () => {
    state.libraryVisible += 24;
    renderLibrary();
  };

  $('#notifyBtn').onclick = openNotificationSettings;
  $('#eventNotifyBtn').onclick = openNotificationSettings;
  $('#notifyClose').onclick = closeNotificationSettings;
  $('#notifyOverlay').addEventListener('click', event => {
    if (event.target === $('#notifyOverlay')) closeNotificationSettings();
  });
  $('#prefUploads').onchange = () => $('#creatorPrefGrid').classList.toggle('hidden', !$('#prefUploads').checked);
  $('#saveNotifyPrefs').onclick = () => saveNotificationPreferences().catch(error => {
    console.error(error);
    toast('Could not enable alerts', error.message, '!');
  });
  $('#disableNotifyPrefs').onclick = () => disableNotifications().catch(error => toast('Could not disable alerts', error.message, '!'));

  const openBot = () => state.config?.botInvite
    ? window.open(state.config.botInvite, '_blank', 'noopener,noreferrer')
    : toast('Bot invite unavailable', 'Set DISCORD_CLIENT_ID or start the bot so the invite can be generated.', '!');
  $('#addBot').onclick = openBot;
  $('#botCta').onclick = openBot;

  $('#searchBtn').onclick = () => {
    $('#searchOverlay').classList.add('open');
    $('#searchOverlay').setAttribute('aria-hidden', 'false');
    renderSearch();
    setTimeout(() => $('#searchInput').focus(), 80);
  };
  $('#searchClose').onclick = closeSearch;
  $('#searchInput').addEventListener('input', renderSearch);
  $('#searchOverlay').addEventListener('click', event => {
    if (event.target === $('#searchOverlay')) closeSearch();
  });

  $('#playAllStart').onclick = () => {
    const context = allVideosContext();
    if (context.videos[0]) openPlayer(context.videos[0], context);
  };
  $('#arcClose').onclick = closeArcFolder;
  $('#arcOverlay').addEventListener('click', event => {
    if (event.target === $('#arcOverlay')) closeArcFolder();
  });
  $('#playArcStart').onclick = () => {
    const folder = state.activeArc;
    if (!folder?.videos?.length) return;
    const context = arcContext(folder);
    closeArcFolder();
    openPlayer(folder.videos[0], context);
  };

  $('#playerBack').onclick = closePlayer;
  $('#playerListBtn').onclick = () => toggleMyList(state.currentVideo);
  $('#prevBtn').onclick = () => {
    const previous = getPrevVideo();
    if (previous) openPlayer(previous, state.activePlaylist);
  };
  $('#nextBtn').onclick = () => {
    const next = getNextVideo();
    if (next) openPlayer(next, state.activePlaylist);
  };
  $('#playPause').onclick = togglePlay;
  $('#rewindBtn').onclick = () => seekRelative(-10);
  $('#forwardBtn').onclick = () => seekRelative(10);
  $('#ccBtn').onclick = toggleCaptions;
  $('#speedBtn').onclick = cycleSpeed;
  $('#volumeBtn').onclick = toggleMute;
  $('#volumeRange').oninput = event => {
    if (!state.playerReady) return;
    const volume = Number(event.target.value);
    state.player.setVolume?.(volume);
    if (volume > 0 && state.player.isMuted?.()) state.player.unMute?.();
    $('#volumeBtn').textContent = volume === 0 || state.player.isMuted?.() ? '🔇' : '🔊';
  };
  $('#fullscreenBtn').onclick = toggleFullscreen;

  const playerModal = $('#playerModal');
  ['mousemove', 'pointerdown', 'touchstart'].forEach(type => playerModal.addEventListener(type, () => showPlayerChrome(), { passive: true }));
  $('#playerClickZone').addEventListener('click', () => {
    togglePlay();
    showPlayerChrome({ pin: state.player?.getPlayerState?.() !== window.YT?.PlayerState?.PLAYING });
  });

  const seekPointer = event => seekFromClientX(event.clientX);
  $('#timeline').addEventListener('pointerdown', event => {
    seekPointer(event);
    $('#timeline').setPointerCapture?.(event.pointerId);
  });
  $('#timeline').addEventListener('pointermove', event => {
    if (event.buttons === 1) seekPointer(event);
  });
  $('#timeline').addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); seekRelative(-5); }
    if (event.key === 'ArrowRight') { event.preventDefault(); seekRelative(5); }
  });

  addEventListener('keydown', event => {
    if ($('#desktopSettingsOverlay')?.classList.contains('open')) {
      if (event.key === 'Escape') closeDesktopSettings();
      return;
    }
    if ($('#notifyOverlay').classList.contains('open')) {
      if (event.key === 'Escape') closeNotificationSettings();
      return;
    }
    if ($('#arcOverlay').classList.contains('open')) {
      if (event.key === 'Escape') closeArcFolder();
      return;
    }
    if ($('#playerModal').classList.contains('open')) {
      showPlayerChrome();
      const key = event.key.toLowerCase();
      if (event.key === 'Escape') closePlayer();
      else if (event.code === 'Space' || key === 'k') { event.preventDefault(); togglePlay(); }
      else if (event.key === 'ArrowLeft' || key === 'j') { event.preventDefault(); seekRelative(-10); }
      else if (event.key === 'ArrowRight' || key === 'l') { event.preventDefault(); seekRelative(10); }
      else if (key === 'm') toggleMute();
      else if (key === 'c') toggleCaptions();
      else if (key === 'f') toggleFullscreen();
      else if (key === 'n') $('#nextBtn').click();
      else if (key === 'p') $('#prevBtn').click();
      return;
    }
    const searchShortcut = (event.key === '/' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k'));
    if (searchShortcut && !$('#searchOverlay').classList.contains('open') && document.activeElement?.tagName !== 'INPUT') {
      event.preventDefault();
      $('#searchBtn').click();
    } else if (event.key === 'Escape') {
      closeSearch();
    }
  });

}


function closeDesktopSettings() {
  const overlay = $('#desktopSettingsOverlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
}

function openDesktopSettings() {
  const overlay = $('#desktopSettingsOverlay');
  if (!overlay || !desktopBridge) return;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  setTimeout(() => $('#desktopDiscordToken')?.focus(), 80);
}

async function refreshDesktopRuntimeLabel() {
  if (!desktopBridge) return;
  const root = $('#desktopRuntime');
  if (!root) return;
  const health = await fetchJson('/api/health', {}, 4000).catch(() => null);
  root.classList.remove('ok', 'bad');
  if (!health) {
    root.classList.add('bad');
    root.querySelector('span').textContent = 'Local services reconnecting';
    return;
  }
  if (health.discordReady && health.youtubeReady) {
    root.classList.add('ok');
    root.querySelector('span').textContent = 'Bot online · YouTube feed ready';
  } else if (health.youtubeError || health.discordError) {
    root.classList.add('bad');
    root.querySelector('span').textContent = health.discordError || health.youtubeError || 'Service needs attention';
  } else {
    root.querySelector('span').textContent = `${health.discordReady ? 'Bot online' : 'Bot connecting'} · ${health.youtubeReady ? 'Feed ready' : 'Feed syncing'}`;
  }
}

async function initDesktopShell() {
  if (!desktopBridge) return;
  document.body.classList.add('desktop-app');
  $('#desktopTitlebar')?.classList.remove('hidden');
  $('#desktopKeyHint')?.classList.remove('hidden');

  const info = await desktopBridge.getState();
  const tokenState = $('#desktopTokenState');
  const clientState = $('#desktopClientState');
  const youtubeState = $('#desktopYoutubeState');
  if (tokenState) tokenState.textContent = info.configured?.discordToken ? 'Configured' : 'Not configured';
  if (clientState) clientState.textContent = info.configured?.discordClientId ? 'Configured' : 'Not configured';
  if (youtubeState) youtubeState.textContent = info.configured?.youtubeApiKey ? 'Full API enabled' : 'Public feed mode';
  if ($('#desktopEventChannel')) $('#desktopEventChannel').value = info.values?.eventSourceChannelId || '';
  if ($('#desktopDiscordInvite')) $('#desktopDiscordInvite').value = info.values?.discordInvite || '';
  if ($('#desktopPollSeconds')) $('#desktopPollSeconds').value = Math.max(60, Math.round((info.values?.pollIntervalMs || 120000) / 1000));
  if ($('#desktopMessageContent')) $('#desktopMessageContent').checked = Boolean(info.configured?.messageContentIntent);
  if ($('#desktopLaunchAtLogin')) $('#desktopLaunchAtLogin').checked = Boolean(info.launchAtLogin);
  if ($('#desktopDataPath')) $('#desktopDataPath').textContent = info.dataPath || '—';

  $('#windowMinimize').onclick = () => desktopBridge.windowAction('minimize');
  $('#windowMaximize').onclick = () => desktopBridge.windowAction('maximize');
  $('#windowClose').onclick = () => desktopBridge.windowAction('close');
  $('#desktopSettingsBtn').onclick = openDesktopSettings;
  $('#desktopSettingsClose').onclick = closeDesktopSettings;
  $('#desktopSettingsOverlay').addEventListener('click', event => {
    if (event.target === $('#desktopSettingsOverlay')) closeDesktopSettings();
  });
  $('#desktopOpenData').onclick = () => desktopBridge.openDataFolder();
  $('#desktopRestart').onclick = () => desktopBridge.relaunch();
  $('#desktopLaunchAtLogin').onchange = async event => {
    const enabled = await desktopBridge.setLaunchAtLogin(event.target.checked);
    event.target.checked = Boolean(enabled);
  };
  $('#desktopSaveSettings').onclick = async () => {
    const status = $('#desktopSettingsStatus');
    const button = $('#desktopSaveSettings');
    button.disabled = true;
    status.textContent = 'Saving local settings…';
    try {
      await desktopBridge.saveConfig({
        discordToken: $('#desktopDiscordToken').value.trim(),
        discordClientId: $('#desktopClientId').value.trim(),
        youtubeApiKey: $('#desktopYoutubeKey').value.trim(),
        eventSourceChannelId: $('#desktopEventChannel').value.trim(),
        discordInvite: $('#desktopDiscordInvite').value.trim(),
        messageContentIntent: $('#desktopMessageContent').checked,
        pollIntervalMs: Math.max(60, Number($('#desktopPollSeconds').value) || 120) * 1000
      });
      await desktopBridge.setLaunchAtLogin($('#desktopLaunchAtLogin').checked);
      status.textContent = 'Saved. Restarting Unstable Watch so the bot/feed use the new settings…';
      setTimeout(() => desktopBridge.relaunch(), 500);
    } catch (error) {
      console.error(error);
      status.textContent = `Could not save: ${error.message || error}`;
      button.disabled = false;
    }
  };

  refreshDesktopRuntimeLabel();
  setInterval(refreshDesktopRuntimeLabel, 30_000);
  if (!info.configured?.discordToken) {
    $('#desktopSettingsStatus').textContent = 'Watching works immediately. Add Discord settings only if you want to run your own notification bot from this PC.';
  }
}

function startFeedPollingFallback() {
  if (state.feedPollTimer) return;
  const refresh = () => loadFeed().catch(error => console.warn('[feed] background refresh failed', error));
  state.feedPollTimer = setInterval(refresh, 30_000);
}

function stopFeedPollingFallback() {
  if (!state.feedPollTimer) return;
  clearInterval(state.feedPollTimer);
  state.feedPollTimer = null;
}

function markLiveConnected() {
  clearTimeout(state.liveConnectTimer);
  state.liveConnectTimer = null;
  state.liveConnected = true;
  stopFeedPollingFallback();
  $('#systemDot').className = 'status-dot ok';
  $('#systemStatus').textContent = 'Live updates connected';
  renderStats();
}

function connectLive() {
  if (!('EventSource' in window)) {
    $('#systemDot').className = 'status-dot';
    $('#systemStatus').textContent = 'Library ready · background sync active';
    startFeedPollingFallback();
    return;
  }

  try { state.liveSource?.close?.(); } catch {}
  const eventSource = new EventSource('/api/live');
  state.liveSource = eventSource;

  clearTimeout(state.liveConnectTimer);
  state.liveConnectTimer = setTimeout(() => {
    if (state.liveConnected) return;
    $('#systemDot').className = 'status-dot';
    $('#systemStatus').textContent = 'Library ready · background sync active';
    startFeedPollingFallback();
  }, 5_000);

  eventSource.addEventListener('hello', markLiveConnected);
  eventSource.addEventListener('upload', async event => {
    markLiveConnected();
    const video = JSON.parse(event.data);
    toast(`${video.creator} uploaded`, video.title, '▶');
    await loadFeed().catch(() => {});
  });
  eventSource.addEventListener('event', async event => {
    markLiveConnected();
    const update = JSON.parse(event.data);
    toast('New Unstable event', update.content, '⚡');
    await loadFeed().catch(() => {});
  });
  eventSource.onerror = () => {
    state.liveConnected = false;
    $('#systemDot').className = 'status-dot';
    $('#systemStatus').textContent = 'Library ready · live updates retrying';
    startFeedPollingFallback();
    renderStats();
  };
  eventSource.onopen = markLiveConnected;
}

async function fetchJson(url, options = {}, timeout = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function loadFeed() {
  state.feed = await fetchJson('/api/feed');
  renderFeed();
  return state.feed;
}

async function updateNotificationButton() {
  const subscription = await currentPushSubscription().catch(() => null);
  if (subscription && Notification.permission === 'granted') $('#notifyBtn span:last-child').textContent = 'Alerts on';
}

async function refreshHealth() {
  const health = await fetchJson('/api/health').catch(() => null);
  if (!health) return;
  if (health.discordReady && health.youtubeReady) {
    $('#systemDot').className = 'status-dot ok';
    $('#systemStatus').textContent = health.discordSourceReady ? 'Discord bot + event relay online' : 'Website + bot online · event source unavailable';
  } else if (health.youtubeError) {
    $('#systemDot').className = 'status-dot bad';
    $('#systemStatus').textContent = 'YouTube feed needs attention';
  } else if (!health.discordReady) {
    $('#systemStatus').textContent = 'Website online · Discord bot connecting';
  }
}

async function init() {
  await initDesktopShell().catch(error => console.warn('[desktop]', error));
  wireUI();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(console.warn);

  try {
    const [config] = await Promise.all([fetchJson('/api/config'), loadFeed()]);
    state.config = config;
    $('#joinDiscord').href = config.discordInvite;
    $('#eventDiscord').href = config.discordInvite;
    renderNotificationPrefs();
    await updateNotificationButton();
    $('#systemDot').className = 'status-dot';
    $('#systemStatus').textContent = 'Library ready · connecting live updates';
    connectLive();
    await refreshHealth();

    if (!state.videos.length) {
      for (let attempt = 0; attempt < 12 && !state.videos.length; attempt += 1) {
        await sleep(2500);
        await loadFeed().catch(() => {});
      }
    }

    if (!state.config.botInvite) {
      const poll = setInterval(async () => {
        const configUpdate = await fetchJson('/api/config').catch(() => null);
        if (configUpdate?.botInvite) {
          state.config = configUpdate;
          clearInterval(poll);
        }
      }, 3000);
      setTimeout(() => clearInterval(poll), 60_000);
    }
  } catch (error) {
    console.error(error);
    $('#systemDot').className = 'status-dot bad';
    $('#systemStatus').textContent = 'Could not load site data';
    toast('Connection error', 'The library API could not be loaded. Check that the Node server is running.', '!');
  }
}

init();
