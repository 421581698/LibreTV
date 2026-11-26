/**
 * Select an existing hls.js audio rendition without touching the media element.
 *
 * This deliberately changes only hls.audioTrack: it does not pause playback,
 * seek, alter volume, or rebuild the HLS/ArtPlayer instance. The caller owns
 * UI state and instance-generation guards.
 */
export interface HlsAudioTrackController {
  readonly audioTracks: readonly unknown[];
  audioTrack: number;
}

export function selectHlsAudioTrack(
  hls: HlsAudioTrackController,
  trackIndex: number,
): boolean {
  if (!Number.isInteger(trackIndex) || trackIndex < 0 || trackIndex >= hls.audioTracks.length) {
    return false;
  }
  try {
    hls.audioTrack = trackIndex;
    return hls.audioTrack === trackIndex;
  } catch {
    // A disposed HLS instance or unsupported track must not crash the player UI.
    return false;
  }
}
