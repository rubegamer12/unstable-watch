/**
 * Return unseen videos in chronological notification order (oldest unseen -> newest).
 * The API list is expected newest-first.
 */
export function getUnseenVideos(videos, previousId) {
  if (!Array.isArray(videos) || videos.length === 0 || !previousId) return [];
  if (videos[0]?.id === previousId) return [];
  const previousIndex = videos.findIndex(video => video.id === previousId);
  const unseenNewestFirst = previousIndex >= 0 ? videos.slice(0, previousIndex) : videos.slice(0, 1);
  return [...unseenNewestFirst].reverse();
}
