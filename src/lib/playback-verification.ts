export interface PlaybackProgressSample {
  paused: boolean;
  readyState: number;
  startTime: number;
  currentTime: number;
}

/** Require a decoded frame and measurable timeline progress, not merely a play event. */
export function hasSustainedPlaybackProgress(
  sample: PlaybackProgressSample,
  minimumProgressSeconds = 2,
): boolean {
  const progressed = sample.currentTime - sample.startTime;
  return (
    !sample.paused &&
    sample.readyState >= 2 &&
    Number.isFinite(sample.startTime) &&
    Number.isFinite(sample.currentTime) &&
    Number.isFinite(progressed) &&
    progressed >= minimumProgressSeconds
  );
}
