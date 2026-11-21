import type { Fmp4Sample } from './fmp4-fragment-parser';

export interface MediaTimestamp {
  readonly decodeTime: number;
  readonly compositionTimeOffset?: number;
  readonly duration?: number | null;
  readonly timescale: number;
}

export type AvSyncStatus = 'synced' | 'audio-ahead' | 'video-ahead';

export interface AvSyncMeasurement {
  /** Positive means audio presentation time is later than video. */
  readonly audioMinusVideoSeconds: number;
  readonly status: AvSyncStatus;
  readonly toleranceSeconds: number;
}

export type TimelineDiscontinuityKind = 'continuous' | 'gap' | 'overlap' | 'reset';

export interface TimelineDiscontinuity {
  readonly kind: TimelineDiscontinuityKind;
  /** Positive means a hole between the previous sample end and current sample start. */
  readonly deltaSeconds: number;
}

/** Adapt parsed fMP4 sample ticks into the shared A/V timing model. */
export function mediaTimestampFromSample(
  sample: Pick<Fmp4Sample, 'decodeTime' | 'compositionTimeOffset' | 'duration'>,
  timescale: number,
): MediaTimestamp {
  if (!Number.isFinite(timescale) || timescale <= 0) {
    throw new Error('Media timescale must be finite and positive.');
  }
  return {
    decodeTime: sample.decodeTime,
    compositionTimeOffset: sample.compositionTimeOffset,
    duration: sample.duration,
    timescale,
  };
}

/** Convert media-clock ticks to seconds without assuming a shared audio/video timescale. */
export function mediaTicksToSeconds(ticks: number, timescale: number): number {
  if (!Number.isFinite(ticks) || !Number.isFinite(timescale) || timescale <= 0) {
    throw new Error('Media timestamp and timescale must be finite; timescale must be positive.');
  }
  return ticks / timescale;
}

export function presentationTimeSeconds(timestamp: MediaTimestamp): number {
  const compositionOffset = timestamp.compositionTimeOffset ?? 0;
  return mediaTicksToSeconds(timestamp.decodeTime + compositionOffset, timestamp.timescale);
}

/**
 * Compare audio/video presentation clocks. This measures timestamp alignment;
 * it does not claim to correct output-device latency or browser scheduling.
 */
export function measureAvSync(
  video: MediaTimestamp,
  audio: MediaTimestamp,
  toleranceSeconds = 0.08,
): AvSyncMeasurement {
  if (!Number.isFinite(toleranceSeconds) || toleranceSeconds < 0) {
    throw new Error('A/V sync tolerance must be a finite non-negative number.');
  }
  const audioMinusVideoSeconds = presentationTimeSeconds(audio) - presentationTimeSeconds(video);
  const status: AvSyncStatus = Math.abs(audioMinusVideoSeconds) <= toleranceSeconds
    ? 'synced'
    : audioMinusVideoSeconds > 0 ? 'audio-ahead' : 'video-ahead';
  return { audioMinusVideoSeconds, status, toleranceSeconds };
}

/**
 * Detect a gap/overlap/reset in one track's decode timeline. The previous
 * sample duration is required; missing duration is treated as unknown.
 */
export function detectTimelineDiscontinuity(
  previous: MediaTimestamp,
  current: MediaTimestamp,
  toleranceSeconds = 0.05,
): TimelineDiscontinuity {
  if (previous.duration === null || previous.duration === undefined) {
    throw new Error('Previous sample duration is required for discontinuity detection.');
  }
  if (previous.timescale <= 0 || current.timescale <= 0) {
    throw new Error('Media timescales must be positive.');
  }
  if (!Number.isFinite(toleranceSeconds) || toleranceSeconds < 0) {
    throw new Error('Discontinuity tolerance must be a finite non-negative number.');
  }
  const previousEndSeconds = mediaTicksToSeconds(previous.decodeTime + previous.duration, previous.timescale);
  const currentStartSeconds = mediaTicksToSeconds(current.decodeTime, current.timescale);
  const deltaSeconds = currentStartSeconds - previousEndSeconds;
  if (currentStartSeconds < mediaTicksToSeconds(previous.decodeTime, previous.timescale) - toleranceSeconds) {
    return { kind: 'reset', deltaSeconds };
  }
  if (Math.abs(deltaSeconds) <= toleranceSeconds) return { kind: 'continuous', deltaSeconds };
  return { kind: deltaSeconds > 0 ? 'gap' : 'overlap', deltaSeconds };
}
