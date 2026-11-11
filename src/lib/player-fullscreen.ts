export type NativeFullscreenVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
};

/**
 * Prefer iOS native video fullscreen, but fall back when WebKit never emits
 * webkitbeginfullscreen. The returned disposer is safe after either path.
 */
export function requestNativeFullscreenWithFallback(
  video: NativeFullscreenVideo,
  fallback: () => void,
  timeoutMs = 1200,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let settled = false;

  const cleanup = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    video.removeEventListener('webkitbeginfullscreen', onBegin);
  };
  const onBegin = () => {
    settled = true;
    cleanup();
  };
  const useFallback = () => {
    if (settled) return;
    settled = true;
    cleanup();
    if (!video.webkitDisplayingFullscreen) fallback();
  };

  video.addEventListener('webkitbeginfullscreen', onBegin, { once: true });
  try {
    if (typeof video.webkitEnterFullscreen !== 'function') {
      useFallback();
    } else {
      video.webkitEnterFullscreen();
      if (!settled) timer = setTimeout(useFallback, timeoutMs);
    }
  } catch {
    useFallback();
  }

  return () => {
    settled = true;
    cleanup();
  };
}
