import type { HistoryEntry } from '@/lib/db';

/** Build a direct player URL for Continue Watching; never detour through the detail page. */
export function buildContinueWatchingUrl(item: Pick<HistoryEntry,
  'sourceKey' | 'sourceUrl' | 'vodId' | 'title' | 'episodeIndex' | 'playbackPosition'
>): string {
  const params = new URLSearchParams({
    source: item.sourceKey,
    id: item.vodId,
    title: item.title,
    index: String(Math.max(0, item.episodeIndex)),
  });
  if (item.sourceUrl) params.set('sourceUrl', item.sourceUrl);
  if (Number.isFinite(item.playbackPosition) && item.playbackPosition > 5) {
    params.set('position', String(Math.floor(item.playbackPosition)));
  }
  return '/ipad-edition/watch?' + params.toString();
}
