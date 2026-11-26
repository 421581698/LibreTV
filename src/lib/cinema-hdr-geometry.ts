/**
 * Video and GPU canvas must cover exactly the same visible pixels. A canvas
 * that stretches an object-fit:contain video would turn circles into ovals,
 * while ignoring object-fit:cover would show cropped-away source content.
 */
export interface CinemaRect { left: number; top: number; width: number; height: number; }
export interface CinemaCanvasGeometry extends CinemaRect {
  uvScaleX: number; uvScaleY: number; uvOffsetX: number; uvOffsetY: number;
}
export function cinemaCanvasGeometry(
  video: CinemaRect, host: CinemaRect,
  videoWidth: number, videoHeight: number,
  objectFit: string,
): CinemaCanvasGeometry {
  const left = video.left - host.left;
  const top = video.top - host.top;
  const fallback = { left, top, width: video.width, height: video.height,
    uvScaleX: 1, uvScaleY: 1, uvOffsetX: 0, uvOffsetY: 0 };
  if (video.width <= 0 || video.height <= 0 || videoWidth <= 0 || videoHeight <= 0 ||
      !Number.isFinite(videoWidth) || !Number.isFinite(videoHeight)) return fallback;
  const sourceAspect = videoWidth / videoHeight;
  const boxAspect = video.width / video.height;
  if (objectFit === 'contain' || objectFit === 'scale-down') {
    const scale = Math.min(video.width / videoWidth, video.height / videoHeight);
    if (objectFit === 'scale-down' && scale >= 1) {
      return { ...fallback, left: left + (video.width-videoWidth)/2,
        top: top + (video.height-videoHeight)/2, width: videoWidth, height: videoHeight };
    }
    const w = videoWidth * scale;
    const h = videoHeight * scale;
    return { ...fallback, left: left + (video.width - w)/2,
      top: top + (video.height - h)/2, width: w, height: h };
  }
  if (objectFit === 'cover') {
    if (sourceAspect > boxAspect) {
      const scaleX = boxAspect / sourceAspect;
      return { ...fallback, uvScaleX: scaleX, uvOffsetX: (1 - scaleX)/2 };
    }
    const scaleY = sourceAspect / boxAspect;
    return { ...fallback, uvScaleY: scaleY, uvOffsetY: (1-scaleY)/2 };
  }
  return fallback; // fill / unknown
}
