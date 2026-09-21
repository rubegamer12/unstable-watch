const SHORTS_RE = /(?:^|[\s#])shorts?(?:$|[\s#])/i;
const UNSTABLE_RE = /unstable\s*(?:universe|smp)?/i;

export function parseIsoDuration(value = '') {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!match) return 0;
  return (Number(match[1] || 0) * 86400) + (Number(match[2] || 0) * 3600) + (Number(match[3] || 0) * 60) + Number(match[4] || 0);
}

export function isShortFormVideo(video = {}) {
  if (video.isShort === true) return true;
  const text = `${video.title || ''} ${video.description || ''}`;
  if (SHORTS_RE.test(text)) return true;
  // YouTube Shorts can be up to 3 minutes. Do not use the old 4-minute
  // cutoff because it can hide legitimate short story episodes/recaps.
  return Number.isFinite(video.durationSeconds) && video.durationSeconds > 0 && video.durationSeconds <= 180;
}

export function matchesUnstableMetadata(video = {}, arcVideoIds = new Set()) {
  if (!video?.id || isShortFormVideo(video)) return false;
  const text = `${video.title || ''} ${video.description || ''}`;
  return video.isUnstable === true || arcVideoIds.has(video.id) || UNSTABLE_RE.test(text);
}

export function isUnstableVideo(video = {}, arcVideoIds = new Set()) {
  return matchesUnstableMetadata(video, arcVideoIds);
}

/**
 * Build the watch library without ever letting imperfect YouTube metadata
 * erase the site. Uploads arrive newest-first.
 *
 * 1) Always remove Shorts/very short clips.
 * 2) If explicit Unstable/arc matches exist, keep the whole contiguous
 *    recent upload era down to the oldest known match. This catches episodes
 *    whose titles/descriptions omit the word "Unstable".
 * 3) If no metadata matches at all, fall back to the creator's long-form
 *    uploads rather than returning an empty array.
 */
export function filterUnstableVideos(videos = [], arcPlaylists = []) {
  const arcVideoIds = new Set(arcPlaylists.flatMap(playlist => playlist.videoIds || []));
  const longform = videos.filter(video => video?.id && !isShortFormVideo(video));
  if (!longform.length) return [];

  const matchedIndexes = [];
  longform.forEach((video, index) => {
    if (matchesUnstableMetadata(video, arcVideoIds)) matchedIndexes.push(index);
  });

  const selected = matchedIndexes.length
    ? longform.slice(0, Math.max(...matchedIndexes) + 1)
    : longform;

  return selected.map(video => ({
    ...video,
    isShort: false,
    // Everything selected here is part of the site's trusted protagonist
    // library. Keep whether metadata matched separately for debugging/UI.
    unstableMetadataMatch: matchesUnstableMetadata(video, arcVideoIds),
    isUnstable: true
  }));
}
