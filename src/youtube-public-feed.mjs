// Only page-owner metadata can identify a channel. Generic channelId fields
// may belong to recommended videos from another creator.
function channelMetadata(html) {
  const match = /"channelMetadataRenderer"\s*:\s*\{/.exec(html);
  if (!match) return null;
  const start = match.index + match[0].lastIndexOf('{');
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

function decodeEntity(entity) {
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"
  };
  if (entity[0] === '#') {
    const hex = entity[1]?.toLowerCase() === 'x';
    const raw = entity.slice(hex ? 2 : 1);
    const value = Number.parseInt(raw, hex ? 16 : 10);
    return Number.isFinite(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : `&${entity};`;
  }
  return named[entity] ?? `&${entity};`;
}

export function decodeXml(value = '') {
  return String(value)
    .replace(/^<!\[CDATA\[|\]\]>$/g, '')
    .replace(/&(#x?[0-9A-Fa-f]+|amp|lt|gt|quot|apos);/g, (_match, entity) => decodeEntity(entity));
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tagText(xml, tag) {
  const escaped = escapeRegex(tag);
  const match = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i').exec(xml);
  return match ? decodeXml(match[1].trim()) : '';
}

function attrValue(xml, tag, attr) {
  const escapedTag = escapeRegex(tag);
  const escapedAttr = escapeRegex(attr);
  const match = new RegExp(`<${escapedTag}\\b[^>]*\\b${escapedAttr}=["']([^"']+)["'][^>]*>`, 'i').exec(xml);
  return match ? decodeXml(match[1]) : '';
}

export function extractChannelId(html = '', expectedHandle = '') {
  const text = String(html);
  const metadata = channelMetadata(text);
  if (metadata) {
    if (expectedHandle && metadata.vanityChannelUrl) {
      try {
        const actual = new URL(metadata.vanityChannelUrl).pathname.replace(/^\/@/, '').replace(/\/$/, '');
        if (actual.toLowerCase() !== expectedHandle.replace(/^@/, '').toLowerCase()) return null;
      } catch { return null; }
    }
    return /^UC[0-9A-Za-z_-]{22}$/.test(metadata.externalId || '') ? metadata.externalId : null;
  }
  for (const tag of text.match(/<meta\b[^>]*>/gi) || []) {
    if (!/\bitemprop=["']channelId["']/i.test(tag)) continue;
    const id = /\bcontent=["'](UC[0-9A-Za-z_-]{22})["']/i.exec(tag)?.[1];
    if (id) return id;
  }
  // Last resort only: ambiguous pages must not select the first recommendation.
  const ids = [...new Set([...text.matchAll(/"channelId"\s*:\s*"(UC[0-9A-Za-z_-]{22})"/g)].map(match => match[1]))];
  return !expectedHandle && ids.length === 1 ? ids[0] : null;
}

export function normalizeChannelId(value = '') {
  if (/^UC[\w-]{22}$/.test(value)) return value;
  // YouTube's Atom feed header currently omits the UC prefix.
  return /^[\w-]{22}$/.test(value) ? `UC${value}` : null;
}

export function parseYouTubeAtomFeed(xml = '', creator = {}) {
  const header = String(xml).split(/<entry\b/i)[0];
  const feedChannelId = normalizeChannelId(tagText(header, 'yt:channelId'));
  if (creator.channelId && feedChannelId !== creator.channelId) throw new Error('Public feed channel does not match the requested creator');
  const author = tagText(header, 'author');
  const authorId = /\/channel\/(UC[\w-]{22})/.exec(tagText(author, 'uri'))?.[1];
  if (authorId && authorId !== feedChannelId) throw new Error('Public feed author identity mismatch');
  const authorName = tagText(author, 'name');
  if (creator.name && authorName && authorName.toLowerCase() !== creator.name.toLowerCase()) throw new Error('Public feed author does not match the requested creator');
  const entries = String(xml).match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  return entries.map(entry => {
    const id = tagText(entry, 'yt:videoId');
    if (!id) return null;
    const channelId = normalizeChannelId(tagText(entry, 'yt:channelId'));
    if (creator.channelId && channelId !== creator.channelId) return null;
    const title = tagText(entry, 'title') || 'Untitled upload';
    const description = tagText(entry, 'media:description');
    const publishedAt = tagText(entry, 'published') || new Date().toISOString();
    const thumbnail = attrValue(entry, 'media:thumbnail', 'url') || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    return {
      id,
      channelId: channelId || feedChannelId || null,
      creatorId: creator.id,
      creator: creator.name,
      title,
      description,
      publishedAt,
      thumbnail,
      watchUrl: `https://www.youtube.com/watch?v=${id}`,
      embeddable: true,
      privacyStatus: 'public',
      source: 'public-feed'
    };
  }).filter(Boolean);
}
