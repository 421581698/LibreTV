/** Pure scheduling policy for experimental PCM; does not control native playback. */
export interface PcmClockInput {
  ptsSamples: bigint;
  sampleRate: number;
  mediaTime: number;
  audioTime: number;
  playbackRate: number;
  queuedUntil: number;
}
export type PcmClockDecision = { action: 'schedule'; at: number } | { action: 'drop' | 'reset' | 'wait' };
export function planExperimentalPcm(input: PcmClockInput): PcmClockDecision {
  const { ptsSamples, sampleRate, mediaTime, audioTime, playbackRate, queuedUntil } = input;
  if (![sampleRate, mediaTime, audioTime, playbackRate, queuedUntil].every(Number.isFinite) ||
      sampleRate <= 0 || playbackRate <= 0 || mediaTime < 0 || audioTime < 0) return { action: 'reset' };
  const pts = Number(ptsSamples) / sampleRate;
  if (!Number.isSafeInteger(Number(ptsSamples))) return { action: 'reset' };
  const delta = (pts - mediaTime) / playbackRate;
  if (delta < -0.15) return { action: 'drop' };
  if (delta > 0.5) return { action: 'wait' };
  const at = Math.max(audioTime, audioTime + delta);
  if (queuedUntil > at + 0.08) return { action: 'reset' };
  return { action: 'schedule', at: Math.max(at, queuedUntil) };
}
