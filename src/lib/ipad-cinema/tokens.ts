/** Frozen V4.3.1 defaults. Ranges are acceptance tolerances, not runtime randomness. */
export const IPAD_CINEMA_TOKENS = {
  focusScale: 1.06,
  hoverBrightness: 1.03,
  pressedScale: 0.98,
  focusMs: 200,
  heroFadeMs: 500,
  heroCarouselMs: 600,
  heroParallax: 0.015,
  glassBlurPx: 24,
  lightBlurPx: 14,
  glassOpacity: 0.65,
} as const;

export const IPAD_CINEMA_TOKEN_LIMITS = {
  focusScale: [1.04, 1.07],
  hoverBrightness: [1.01, 1.04],
  pressedScale: [0.97, 0.99],
  focusMs: [180, 240],
  heroFadeMs: [450, 600],
  heroCarouselMs: [500, 700],
  heroParallax: [0.01, 0.02],
  glassBlurPx: [20, 28],
  lightBlurPx: [12, 16],
  glassOpacity: [0.55, 0.75],
} as const;

export function tokensWithinLimits(
  tokens: typeof IPAD_CINEMA_TOKENS = IPAD_CINEMA_TOKENS,
): boolean {
  return (Object.keys(IPAD_CINEMA_TOKEN_LIMITS) as Array<keyof typeof IPAD_CINEMA_TOKEN_LIMITS>).every(
    (key) => {
      const [min, max] = IPAD_CINEMA_TOKEN_LIMITS[key];
      const value = tokens[key];
      return value >= min && value <= max;
    },
  );
}
