/**
 * The iPad Cinema player must keep its existing media element while a new CMS
 * episode/source is being checked against the exact trusted registry binding.
 * Ordinary watch pages retain the original loading-screen behavior.
 */
export interface CinemaPlaybackMedia {
  url: string;
  episodeKey: string;
  sourceKey: string;
  mediaType?: 'mp4' | 'hls';
  dolbyVisionAssetId?: string;
  dolbyVisionSourceKind: 'registry' | 'direct' | 'cms' | 'unknown';
  dolbyVisionSourceIdentity?: string;
}

export function selectCinemaPlaybackMedia({
  isCinema,
  cmsLookupPending,
  current,
  lastReady,
}: {
  isCinema: boolean;
  cmsLookupPending: boolean;
  current: CinemaPlaybackMedia;
  lastReady: CinemaPlaybackMedia | null;
}): {
  media: CinemaPlaybackMedia;
  holdingPrevious: boolean;
  showPlayer: boolean;
} {
  const holdingPrevious = isCinema && cmsLookupPending && lastReady !== null;
  return {
    media: holdingPrevious && lastReady ? lastReady : current,
    holdingPrevious,
    showPlayer: !cmsLookupPending || holdingPrevious,
  };
}

/**
 * A retained Cinema player may still emit events while the next CMS source is
 * being verified. Do not credit those events to the destination episode, even
 * when the provider reuses the same episode key for a different playback URL.
 */
export function isCinemaPlaybackEventCurrent({
  isCinema,
  cmsLookupPending,
  holdingPrevious,
  currentEpisodeKey,
  eventEpisodeKey,
}: {
  isCinema: boolean;
  cmsLookupPending: boolean;
  holdingPrevious: boolean;
  currentEpisodeKey: string;
  eventEpisodeKey?: string;
}): boolean {
  if (isCinema && (cmsLookupPending || holdingPrevious)) return false;
  return !eventEpisodeKey || eventEpisodeKey === currentEpisodeKey;
}

/** Keep the Cinema shell mounted through BOTH detail loading and CMS binding. */
export function isCinemaPlaybackTransitionPending({
  isCinema,
  cmsLookupPending,
  detailLoading,
  currentUrl,
}: {
  isCinema: boolean;
  cmsLookupPending: boolean;
  detailLoading: boolean;
  currentUrl: string;
}): boolean {
  return cmsLookupPending || (isCinema && detailLoading && !currentUrl);
}
