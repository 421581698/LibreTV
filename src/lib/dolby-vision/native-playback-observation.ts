/**
 * Observes the *mounted* HTMLVideoElement rather than codec declarations.
 *
 * A progressing media timeline plus non-zero video dimensions is useful when
 * testing Safari, but cannot identify the selected HLS rendition or prove
 * Dolby Vision RPU consumption, native HDR output, or bitstream passthrough.
 */
export interface NativePlaybackObservation {
  status: 'waiting' | 'progress-observed' | 'error';
  videoWidth: number;
  videoHeight: number;
  progressedSeconds: number;
  mediaErrorCode: number | null;
  baselineTime: number | null;
  lastTime: number | null;
}

export interface NativePlaybackSample {
  currentTime: number;
  videoWidth: number;
  videoHeight: number;
  readyState: number;
  paused: boolean;
  seeking: boolean;
  ended: boolean;
  mediaErrorCode: number | null;
}

export function emptyNativePlaybackObservation(): NativePlaybackObservation {
  return {
    status: 'waiting',
    videoWidth: 0,
    videoHeight: 0,
    progressedSeconds: 0,
    mediaErrorCode: null,
    baselineTime: null,
    lastTime: null,
  };
}

/** Pure state transition, with no success claims from play/loadedmetadata alone. */
export function advanceNativePlaybackObservation(
  previous: NativePlaybackObservation,
  event: 'reset' | 'sample' | 'error',
  sample?: NativePlaybackSample,
): NativePlaybackObservation {
  if (event === 'reset') return emptyNativePlaybackObservation();
  if (event === 'error') {
    return {
      ...emptyNativePlaybackObservation(),
      status: 'error',
      mediaErrorCode: sample?.mediaErrorCode ?? null,
    };
  }
  if (previous.status === 'error') return previous;
  if (!sample) return previous;
  if (sample.mediaErrorCode !== null) {
    return advanceNativePlaybackObservation(previous, 'error', sample);
  }
  if (!Number.isFinite(sample.currentTime) || sample.currentTime < 0 ||
      sample.readyState < 2 || sample.paused || sample.seeking || sample.ended ||
      sample.videoWidth <= 0 || sample.videoHeight <= 0 ||
      !Number.isFinite(sample.videoWidth) || !Number.isFinite(sample.videoHeight)) {
    // The previously observed progress must not appear live while paused,
    // stalled without decodable frames, or seeking to another location.
    if (previous.status === 'waiting' && previous.progressedSeconds === 0 &&
        previous.baselineTime === null) return previous;
    return emptyNativePlaybackObservation();
  }
  const time = sample.currentTime;
  // A backwards clock or a >5 second jump may be a seek without seeking events.
  // Never use such a jump as playback progression evidence.
  const jumped = previous.lastTime !== null &&
    (time < previous.lastTime || time - previous.lastTime > 5);
  const baselineTime = previous.baselineTime === null || jumped ? time : previous.baselineTime;
  const progressedSeconds = Math.max(0, time - baselineTime);
  // A stalled timeupdate event or duplicate sample cannot establish ongoing
  // playback, even when an earlier sample crossed the progress threshold.
  if (previous.lastTime === time) {
    if (previous.status === 'waiting') return previous;
    return { ...previous, status: 'waiting', baselineTime: time, progressedSeconds: 0 };
  }
  return {
    status: progressedSeconds >= 1 ? 'progress-observed' : 'waiting',
    videoWidth: sample.videoWidth,
    videoHeight: sample.videoHeight,
    progressedSeconds,
    mediaErrorCode: null,
    baselineTime,
    lastTime: time,
  };
}

function readNativeVideoSample(video: HTMLVideoElement): NativePlaybackSample {
  return {
    currentTime: video.currentTime,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    readyState: video.readyState,
    paused: video.paused,
    seeking: video.seeking,
    ended: video.ended,
    mediaErrorCode: video.error?.code ?? null,
  };
}

/** Rebinds when ArtPlayer replaces the video element and cleans up on unmount. */
export function observeNativeVideoPlayback(
  container: Element,
  onUpdate: (observation: NativePlaybackObservation) => void,
): () => void {
  let video: HTMLVideoElement | null = null;
  let observation = emptyNativePlaybackObservation();
  let closed = false;
  const publish = (next: NativePlaybackObservation) => {
    if (next === observation) return;
    observation = next;
    if (!closed) onUpdate(observation);
  };
  const reset = () => publish(advanceNativePlaybackObservation(observation, 'reset'));
  const sample = () => {
    if (!video) return;
    publish(advanceNativePlaybackObservation(observation, 'sample', readNativeVideoSample(video)));
  };
  const error = () => {
    publish(advanceNativePlaybackObservation(
      observation, 'error', video ? readNativeVideoSample(video) : undefined,
    ));
  };
  const detach = () => {
    if (!video) return;
    video.removeEventListener('timeupdate', sample);
    video.removeEventListener('playing', sample);
    video.removeEventListener('pause', reset);
    video.removeEventListener('waiting', reset);
    video.removeEventListener('stalled', reset);
    video.removeEventListener('loadedmetadata', sample);
    video.removeEventListener('loadstart', reset);
    video.removeEventListener('emptied', reset);
    video.removeEventListener('seeking', reset);
    video.removeEventListener('seeked', reset);
    video.removeEventListener('error', error);
    video = null;
  };
  const attach = () => {
    const next = container.querySelector('video');
    if (video === next) return;
    detach();
    reset();
    if (!next) return;
    video = next;
    video.addEventListener('timeupdate', sample);
    video.addEventListener('playing', sample);
    video.addEventListener('pause', reset);
    video.addEventListener('waiting', reset);
    video.addEventListener('stalled', reset);
    video.addEventListener('loadedmetadata', sample);
    video.addEventListener('loadstart', reset);
    video.addEventListener('emptied', reset);
    video.addEventListener('seeking', reset);
    video.addEventListener('seeked', reset);
    video.addEventListener('error', error);
    if (video.error) error();
    else sample();
  };
  const observer = new MutationObserver(attach);
  observer.observe(container, { childList: true, subtree: true });
  attach();
  return () => {
    closed = true;
    observer.disconnect();
    detach();
  };
}
