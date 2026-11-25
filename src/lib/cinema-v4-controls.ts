/** Interaction policy for the iPad-only Cinema V4 overlay.
 * Playback state remains owned by the actual HTMLVideoElement/ArtPlayer runtime.
 */
export type CinemaPanel = 'audio' | 'subtitles' | 'quality' | 'diagnostics';

const CINEMA_RATES = [1, 1.25, 1.5, 2, 0.75] as const;

export function nextCinemaPlaybackRate(current: number): number {
  const index = CINEMA_RATES.findIndex((rate) => rate === current);
  return CINEMA_RATES[index < 0 ? 0 : (index + 1) % CINEMA_RATES.length];
}

export function toggleCinemaPanel(current: CinemaPanel | null, requested: CinemaPanel): CinemaPanel | null {
  return current === requested ? null : requested;
}

export function shouldHoldCinemaControls(
  scrubbing: boolean,
  openPanel: boolean,
  mediaPaused: boolean,
  mediaEnded: boolean,
): boolean {
  return scrubbing || openPanel || mediaPaused || mediaEnded;
}
