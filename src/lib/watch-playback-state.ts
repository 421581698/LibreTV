export type WatchPlaybackSnapshot = {
  isPlaying: boolean;
  playbackRate: number | null;
};

/**
 * Observe the current video element, including asynchronous mount/replacement.
 * The observer is intentionally scoped to the player frame and is fully cleaned
 * up when the watch route changes or unmounts.
 */
export function bindWatchPlaybackState(
  frame: ParentNode,
  onChange: (snapshot: WatchPlaybackSnapshot) => void,
): () => void {
  let video: HTMLVideoElement | null = null;
  const sync = () => {
    const rate = video?.playbackRate;
    onChange({
      isPlaying: Boolean(video && !video.paused && !video.ended),
      playbackRate: typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : null,
    });
  };
  const detach = () => {
    if (!video) return;
    video.removeEventListener('play', sync);
    video.removeEventListener('playing', sync);
    video.removeEventListener('pause', sync);
    video.removeEventListener('ended', sync);
    video.removeEventListener('ratechange', sync);
    video = null;
    sync();
  };
  const attach = () => {
    const next = frame.querySelector('video');
    if (next === video) return;
    detach();
    if (!next) return;
    video = next;
    video.addEventListener('play', sync);
    video.addEventListener('playing', sync);
    video.addEventListener('pause', sync);
    video.addEventListener('ended', sync);
    video.addEventListener('ratechange', sync);
    sync();
  };
  const observer = new MutationObserver(attach);
  observer.observe(frame as Node, { childList: true, subtree: true });
  attach();
  return () => {
    observer.disconnect();
    detach();
  };
}

// A play() promise may settle after a later pause/replay on the SAME element.
// Element identity alone cannot reject such stale completions.
const playbackRequestVersions = new WeakMap<HTMLVideoElement, number>();

/**
 * Toggle a video and report the result only while it remains the active element.
 * Promise rejection is treated as a paused state; stale promises are ignored.
 */
export function toggleWatchPlayback(
  video: HTMLVideoElement,
  isCurrent: (candidate: HTMLVideoElement) => boolean,
  onChange: (isPlaying: boolean) => void,
): void {
  const requestVersion = (playbackRequestVersions.get(video) ?? 0) + 1;
  playbackRequestVersions.set(video, requestVersion);
  const isLatest = () => isCurrent(video) && playbackRequestVersions.get(video) === requestVersion;
  if (video.paused || video.ended) {
    try {
      void video.play().then(() => {
        if (isLatest()) onChange(!video.paused && !video.ended);
      }).catch(() => {
        // A rejected play request must never report success, even if another
        // native event briefly changed paused before the rejection settled.
        if (isLatest()) onChange(false);
      });
    } catch {
      if (isLatest()) onChange(false);
    }
    return;
  }
  video.pause();
  if (isLatest()) onChange(false);
}
