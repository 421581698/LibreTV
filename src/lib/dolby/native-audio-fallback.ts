/**
 * Capture a native Safari HLS decoding failure before replacing the media source.
 * Resume position and intent are transported to hls.js, not Dolby output evidence.
 */
export interface NativeAudioFallbackSnapshot {
  currentTime: number;
  playbackRate: number;
  shouldPlay: boolean;
}

export function captureNativeAudioFallback(
  video: Pick<HTMLVideoElement, 'currentTime' | 'playbackRate' | 'paused'>,
  hadStartedPlayback: boolean,
): NativeAudioFallbackSnapshot {
  return {
    currentTime: Number.isFinite(video.currentTime) && video.currentTime >= 0 ? video.currentTime : 0,
    playbackRate: Number.isFinite(video.playbackRate) && video.playbackRate >= 0.25 &&
      video.playbackRate <= 4 ? video.playbackRate : 1,
    // An error before initial autoplay must not strand the hls.js fallback paused.
    // A user pause after playback began must not be overridden by recovery.
    shouldPlay: !hadStartedPlayback || !video.paused,
  };
}

export function fallbackResumeTime(snapshot: NativeAudioFallbackSnapshot, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0 ||
      !Number.isFinite(snapshot.currentTime) || snapshot.currentTime <= 0 ||
      snapshot.currentTime >= duration - 1) return 0;
  return snapshot.currentTime;
}
