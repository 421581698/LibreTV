const SUBTITLE_STYLE_ID = 'libretv-native-subtitle-style';
const SUBTITLE_TARGET_CLASS = 'libretv-native-subtitle-target';

export function applyNativeSubtitleStyle(
  video: HTMLVideoElement,
  fontSizePercent: number,
  backgroundOpacityPercent: number,
): void {
  const fontSize = Number.isFinite(fontSizePercent) ? Math.max(60, Math.min(200, Math.round(fontSizePercent))) : 100;
  const opacity = Number.isFinite(backgroundOpacityPercent)
    ? Math.max(0, Math.min(90, Math.round(backgroundOpacityPercent)))
    : 35;
  let style = document.getElementById(SUBTITLE_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = SUBTITLE_STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = `.${SUBTITLE_TARGET_CLASS}::cue { color: #fff; font-size: ${fontSize}%; background-color: rgba(0, 0, 0, ${opacity / 100}); }`;
  video.classList.add(SUBTITLE_TARGET_CLASS);
}

export function clearNativeSubtitleStyle(video: HTMLVideoElement): void {
  video.classList.remove(SUBTITLE_TARGET_CLASS);
}
