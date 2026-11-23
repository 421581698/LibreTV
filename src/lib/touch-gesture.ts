/**
 * Return true when a touch has moved far enough that it should be treated as
 * a swipe/seek gesture rather than a stationary long press.
 */
export function hasTouchGestureMoved(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  threshold = 12,
): boolean {
  return Math.hypot(currentX - startX, currentY - startY) > threshold;
}
