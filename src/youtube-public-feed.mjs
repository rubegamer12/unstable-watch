const CHANNEL_ID_PATTERNS = [
  /\"channelId\":\"(UC[0-9A-Za-z_-]{20,})\"/,
  /\"externalId\":\"(UC[0-9A-Za-z_-]{20,})\"/,
  /<meta[^>]+itemprop=["']channelId["'][^>]+content=["'](UC[0-9A-Za-z_-]{20,})["']/i,
  /youtube\.com\/channel\/(UC[0-9A-Za-z_-]{20,})/i
];

function decodeEntity(entity) {
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"
  };
  if (entity[0] === '#') {
    const hex = entity[1]?.toLowerCase() === 'x';
    const raw = entity.slice(hex ? 2 : 1);
    const value = Number.parseInt(raw, hex ? 16 : 10);
    return Number.isFinite(value) ? String.fromCodePoint(value) : `&${entity};`;
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

export function extractChannelId(html = '') {
  for (const pattern of CHANNEL_ID_PATTERNS) {
    const match = pattern.exec(String(html));
    if (match?.[1]) return match[1];
  }
  return null;
}

export function parseYouTubeAtomFeed(xml = '', creator = {}) {
  const entries = String(xml).match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  return entries.map(entry => {
    const id = tagText(entry, 'yt:videoId');
    if (!id) return null;
    const title = tagText(entry, 'title') || 'Untitled upload';
    const description = tagText(entry, 'media:description');
    const publishedAt = tagText(entry, 'published') || new Date().toISOString();
    const thumbnail = attrValue(entry, 'media:thumbnail', 'url') || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    return {
      id,
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
