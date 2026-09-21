import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
const DEFAULT_CREATORS = ['spoke', 'parrot', 'wemmbu', 'flame'];

const defaultPushPrefs = () => ({
  uploads: true,
  events: true,
  creators: [...DEFAULT_CREATORS]
});

const defaultState = () => ({
  version: 3,
  guilds: {},
  pushSubscriptions: [],
  latestVideos: {},
  seenVideos: {},
  arcPlaylists: {},
  recentEvents: []
});

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function normalizePushEntry(entry) {
  if (!entry) return null;
  // v1 stored raw PushSubscription JSON directly.
  if (entry.endpoint && entry.keys) {
    return { subscription: entry, prefs: defaultPushPrefs() };
  }
  if (entry.subscription?.endpoint && entry.subscription?.keys) {
    return {
      subscription: entry.subscription,
      prefs: {
        ...defaultPushPrefs(),
        ...(entry.prefs || {}),
        creators: Array.isArray(entry.prefs?.creators) ? [...new Set(entry.prefs.creators)] : [...DEFAULT_CREATORS]
      }
    };
  }
  return null;
}

export class Store {
  constructor() {
    ensureDir();
    const loaded = readJson(STATE_FILE, {});
    this.state = { ...defaultState(), ...loaded };
    this.state.pushSubscriptions = (this.state.pushSubscriptions || []).map(normalizePushEntry).filter(Boolean);
    this.state.version = 3;
    if (!this.state.arcPlaylists || typeof this.state.arcPlaylists !== 'object') this.state.arcPlaylists = {};
    this.saveTimer = null;
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 150);
    this.saveTimer.unref?.();
  }

  save() {
    ensureDir();
    const tmp = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, STATE_FILE);
  }

  getGuild(guildId) {
    if (!this.state.guilds[guildId]) {
      this.state.guilds[guildId] = {
        uploadChannelId: null,
        eventChannelId: null,
        uploadsEnabled: true,
        eventsEnabled: true,
        enabledCreators: [...DEFAULT_CREATORS],
        mentionRoleId: null
      };
      this.scheduleSave();
    }
    const current = this.state.guilds[guildId];
    if (!Array.isArray(current.enabledCreators)) current.enabledCreators = [...DEFAULT_CREATORS];
    if (!Object.hasOwn(current, 'mentionRoleId')) current.mentionRoleId = null;
    return current;
  }

  patchGuild(guildId, patch) {
    const current = this.getGuild(guildId);
    this.state.guilds[guildId] = { ...current, ...patch };
    this.scheduleSave();
    return this.state.guilds[guildId];
  }

  upsertPushSubscription(subscription, prefs = null) {
    const endpoint = subscription?.endpoint;
    if (!endpoint) return null;
    const existing = this.state.pushSubscriptions.find(entry => entry.subscription?.endpoint === endpoint);
    const normalizedPrefs = prefs ? {
      ...defaultPushPrefs(),
      ...prefs,
      creators: Array.isArray(prefs.creators) ? [...new Set(prefs.creators)] : [...DEFAULT_CREATORS]
    } : existing?.prefs || defaultPushPrefs();
    const entry = { subscription, prefs: normalizedPrefs };
    this.state.pushSubscriptions = this.state.pushSubscriptions.filter(item => item.subscription?.endpoint !== endpoint);
    this.state.pushSubscriptions.push(entry);
    this.scheduleSave();
    return entry;
  }

  getPushEntry(endpoint) {
    return this.state.pushSubscriptions.find(entry => entry.subscription?.endpoint === endpoint) || null;
  }

  patchPushPreferences(endpoint, patch) {
    const entry = this.getPushEntry(endpoint);
    if (!entry) return null;
    entry.prefs = {
      ...defaultPushPrefs(),
      ...(entry.prefs || {}),
      ...patch,
      creators: Array.isArray(patch.creators)
        ? [...new Set(patch.creators)]
        : Array.isArray(entry.prefs?.creators) ? entry.prefs.creators : [...DEFAULT_CREATORS]
    };
    this.scheduleSave();
    return entry.prefs;
  }

  removePushSubscription(endpoint) {
    this.state.pushSubscriptions = this.state.pushSubscriptions.filter(entry => entry.subscription?.endpoint !== endpoint);
    this.scheduleSave();
  }

  setLatestVideos(creatorId, videos) {
    this.state.latestVideos[creatorId] = videos;
    this.scheduleSave();
  }

  setSeenVideo(creatorId, videoId) {
    this.state.seenVideos[creatorId] = videoId;
    this.scheduleSave();
  }

  setArcPlaylists(creatorId, playlists) {
    this.state.arcPlaylists[creatorId] = Array.isArray(playlists) ? playlists : [];
    this.scheduleSave();
  }

  addEvent(event) {
    if (this.state.recentEvents.some(existing => existing.id === event.id)) return false;
    this.state.recentEvents.unshift(event);
    this.state.recentEvents = this.state.recentEvents.slice(0, 50);
    this.scheduleSave();
    return true;
  }
}

export function loadVapidFile() {
  ensureDir();
  return readJson(VAPID_FILE, null);
}

export function saveVapidFile(keys) {
  ensureDir();
  fs.writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2));
}
