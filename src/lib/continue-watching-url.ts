import type { HistoryEntry } from '@/lib/db';

/** Build a direct player URL for Continue Watching; never detour through the detail page. */
export function buildContinueWatchingUrl(item: Pick<HistoryEntry,
  'sourceKey' | 'sourceUrl' | 'vodId' | 'title' | 'episodeIndex' | 'playbackPosition' | 'year' | 'typeName'
>): string {
  const params = new URLSearchParams({
    source: item.sourceKey,
    id: item.vodId,
    title: item.title,
    index: String(Math.max(0, item.episodeIndex)),
  });
  if (item.sourceUrl) params.set('sourceUrl', item.sourceUrl);
  // History metadata is advisory: the player independently verifies detail identity.
  const year = item.year?.match(/(?:19|20)\d{2}/)?.[0];
  if (year) params.set('identityYear', year);
  if (item.typeName && /电视剧|電視劇|连续剧|連續劇|影集|剧集|劇集|短剧|短劇|tv|series/i.test(item.typeName)) {
    params.set('identityType', 'tv');
  } else if (item.typeName && /电影|電影|movie|film/i.test(item.typeName)) {
    params.set('identityType', 'movie');
  }
  if (Number.isFinite(item.playbackPosition) && item.playbackPosition > 5) {
    params.set('position', String(Math.floor(item.playbackPosition)));
  }
  return '/ipad-edition/watch?' + params.toString();
}
