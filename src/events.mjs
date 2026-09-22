import { creators } from './config.mjs';

export const INACCESSIBLE_EXTERNAL_SOURCE = '1382502803058196612';
const values = collection => Array.isArray(collection) ? collection : [...(collection?.values?.() || [])];
const safeUrl = value => {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; }
};
export function detectEventCreators(text = '') {
  const names = creators.filter(c => new RegExp(`\\b(?:${c.name}|${c.handle})\\b`, 'i').test(text)).map(c => c.name);
  return names.length ? names : ['Unspecified'];
}
export function eventFromMessage(message, botId) {
  if (!message?.id || message.author?.id === botId || message.channelId === INACCESSIBLE_EXTERNAL_SOURCE) return null;
  const snapshots = values(message.messageSnapshots).map(s => s.message || s);
  const parts = [message, ...snapshots];
  const embeds = parts.flatMap(p => values(p.embeds));
  const title = embeds.find(e => e.title)?.title || '';
  const text = [...parts.map(p => p.content), ...embeds.flatMap(e => [e.title, e.description, ...values(e.fields).flatMap(f => [f.name, f.value])])].filter(Boolean).join('\n');
  const attachments = parts.flatMap(p => values(p.attachments));
  const image = safeUrl(attachments.find(a => a.contentType?.startsWith('image/') || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(a.url || ''))?.url || embeds.find(e => e.image?.url || e.thumbnail?.url)?.image?.url || embeds.find(e => e.thumbnail?.url)?.thumbnail?.url);
  if (!text.trim() && !image) return null;
  const createdAt = new Date(message.createdTimestamp || message.createdAt || 0);
  if (!Number.isFinite(createdAt.getTime()) || createdAt.getTime() <= 0) return null;
  return {
    id: message.id, guildId: message.guildId, sourceChannelId: message.channelId,
    author: message.author?.username || 'Unstable Events',
    content: text.slice(0, 8000) || 'Image announcement',
    title: String(title || text.split('\n')[0] || 'Image announcement').slice(0, 250),
    createdAt: createdAt.toISOString(), image,
    sourceUrl: safeUrl(message.url), jumpUrl: safeUrl(message.url),
    channelName: message.channel?.name || 'unstable-event-feed',
    targetCreators: detectEventCreators(text)
  };
}
export function newestLocalEvent(events, guildId, sourceChannelId) {
  return (events || []).filter(e => e.guildId === guildId && e.sourceChannelId === sourceChannelId && sourceChannelId && sourceChannelId !== INACCESSIBLE_EXTERNAL_SOURCE)
    .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
}
