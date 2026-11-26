/**
 * The iPad Cinema player must keep its existing media element while a new CMS
 * episode/source is being checked against the exact trusted registry binding.
 * Ordinary watch pages retain the original loading-screen behavior.
 */
export interface CinemaPlaybackMedia {
  url: string;
  episodeKey: string;
  sourceKey: string;
  mediaType?: 'mp4';
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
