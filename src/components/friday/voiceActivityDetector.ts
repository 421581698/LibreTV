export type VoiceActivityEvent =
  | { type: "speechstart"; at: number }
  | { type: "speechend"; at: number };

export type VoiceActivityDetectorOptions = {
  /** RMS threshold required to begin a speech candidate. */
  startThreshold?: number;
  /** Lower RMS threshold used to remain in speech (hysteresis). */
  stopThreshold?: number;
  /** Minimum continuous speech duration before emitting speechstart. */
  minSpeechMs?: number;
  /** Continuous quiet duration required before emitting speechend. */
  silenceMs?: number;
};

export type VoiceActivityDetector = {
  pushLevel(level: number, at: number): VoiceActivityEvent[];
  flush(at: number): VoiceActivityEvent[];
  reset(): void;
  isSpeechActive(): boolean;
};

/**
 * Deterministic energy-based VAD core.
 *
 * Audio capture and frame scheduling are deliberately injected by the caller:
 * this module never requests microphone permission or owns a MediaStream. That
 * keeps capture permission, iOS Safari constraints, and ASR ownership in the
 * voice-session adapter rather than hiding them inside the signal processor.
 */
export function createVoiceActivityDetector(
  options: VoiceActivityDetectorOptions = {},
): VoiceActivityDetector {
  const startThreshold = options.startThreshold ?? 0.018;
  const stopThreshold = options.stopThreshold ?? 0.011;
  const minSpeechMs = options.minSpeechMs ?? 120;
  const silenceMs = options.silenceMs ?? 650;

  if (!Number.isFinite(startThreshold) || startThreshold <= 0) {
    throw new RangeError("startThreshold must be a positive finite number");
  }
  if (!Number.isFinite(stopThreshold) || stopThreshold < 0 || stopThreshold >= startThreshold) {
    throw new RangeError("stopThreshold must be finite, non-negative, and below startThreshold");
  }
  if (!Number.isFinite(minSpeechMs) || minSpeechMs < 0) {
    throw new RangeError("minSpeechMs must be a non-negative finite number");
  }
  if (!Number.isFinite(silenceMs) || silenceMs <= 0) {
    throw new RangeError("silenceMs must be a positive finite number");
  }

  let active = false;
  let speechCandidateAt: number | null = null;
  let silenceCandidateAt: number | null = null;
  let lastTimestamp = Number.NEGATIVE_INFINITY;

  const normalizeTimestamp = (at: number) => {
    if (!Number.isFinite(at)) throw new RangeError("VAD timestamps must be finite");
    lastTimestamp = Math.max(lastTimestamp, at);
    return lastTimestamp;
  };

  return {
    pushLevel(level, at) {
      if (!Number.isFinite(level) || level < 0) {
        throw new RangeError("Audio level must be a non-negative finite number");
      }
      const timestamp = normalizeTimestamp(at);

      if (!active) {
        if (level < startThreshold) {
          speechCandidateAt = null;
          return [];
        }
        if (speechCandidateAt === null) speechCandidateAt = timestamp;
        if (timestamp - speechCandidateAt < minSpeechMs) return [];

        active = true;
        speechCandidateAt = null;
        silenceCandidateAt = null;
        return [{ type: "speechstart", at: timestamp }];
      }

      if (level > stopThreshold) {
        silenceCandidateAt = null;
        return [];
      }
      if (silenceCandidateAt === null) silenceCandidateAt = timestamp;
      if (timestamp - silenceCandidateAt < silenceMs) return [];

      active = false;
      silenceCandidateAt = null;
      speechCandidateAt = null;
      return [{ type: "speechend", at: timestamp }];
    },

    flush(at) {
      const timestamp = normalizeTimestamp(at);
      if (!active) {
        speechCandidateAt = null;
        silenceCandidateAt = null;
        return [];
      }
      active = false;
      speechCandidateAt = null;
      silenceCandidateAt = null;
      return [{ type: "speechend", at: timestamp }];
    },

    reset() {
      active = false;
      speechCandidateAt = null;
      silenceCandidateAt = null;
      lastTimestamp = Number.NEGATIVE_INFINITY;
    },

    isSpeechActive() {
      return active;
    },
  };
}
