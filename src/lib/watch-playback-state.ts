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


/** Seek within the actual playable window, including sliding HLS windows. */
export function skipWatchPlayback(video: HTMLVideoElement, delta: number): boolean {
  if (!Number.isFinite(delta) || !Number.isFinite(video.currentTime)) return false;
  const target = video.currentTime + delta;
  if (!Number.isFinite(target)) return false;
  try {
    const ranges = video.seekable;
    if (!ranges.length) return false;
    let nearest = NaN;
    let distance = Infinity;
    for (let i = 0; i < ranges.length; i++) {
      const start = ranges.start(i);
      const end = ranges.end(i);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
      const candidate = Math.max(start, Math.min(end, target));
      const difference = Math.abs(candidate - target);
      if (difference < distance || (difference === distance && (delta > 0 ? candidate > nearest : candidate < nearest))) {
        nearest = candidate;
        distance = difference;
      }
    }
    if (!Number.isFinite(nearest)) return false;
    video.currentTime = nearest;
    return true;
  } catch {
    // A source can be replaced while its seekable ranges are being read.
    return false;
  }
}
