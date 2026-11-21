import { detectTimelineDiscontinuity, type TimelineDiscontinuity } from './av-sync';
import { parseFmp4Fragments, parseFmp4InitSegment, type Fmp4Fragment, type Fmp4InitSegment } from './fmp4-fragment-parser';

export interface Fmp4TrackDiscontinuity extends TimelineDiscontinuity {
  readonly trackId: number;
  readonly timescale: number;
}

export interface Fmp4StreamSegmentResult {
  readonly initGeneration: number;
  readonly recoveryGeneration: number;
  readonly fragments: readonly Fmp4Fragment[];
  readonly discontinuities: readonly Fmp4TrackDiscontinuity[];
}

interface TrackTimeline {
  decodeTime: number;
  duration: number;
  timescale: number;
}

function bytesOf(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

/** Small deterministic signature; used only to detect init-segment replacement. */
function signature(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index];
    hash = Math.imul(hash, 0x01000193);
  }
  return `${bytes.length.toString(16)}-${(hash >>> 0).toString(16)}`;
}

/**
 * Stateful fMP4 timeline coordinator. It does not decode codecs or own MSE;
 * it binds init metadata to media fragments and reports timeline discontinuities.
 */
export class Fmp4StreamSession {
  private init: Fmp4InitSegment | null = null;
  private initSignature: string | null = null;
  private initGeneration = 0;
  private recoveryGeneration = 0;
  private timelines = new Map<number, TrackTimeline>();

  get currentInit(): Fmp4InitSegment | null {
    return this.init;
  }

  updateInitSegment(input: ArrayBuffer | Uint8Array): { changed: boolean; generation: number; init: Fmp4InitSegment } {
    const bytes = bytesOf(input);
    const nextSignature = signature(bytes);
    const parsed = parseFmp4InitSegment(bytes);
    const changed = nextSignature !== this.initSignature;
    if (changed) {
      this.initGeneration += 1;
      this.timelines.clear();
    }
    this.initSignature = nextSignature;
    this.init = parsed;
    return { changed, generation: this.initGeneration, init: parsed };
  }

  parseMediaSegment(
    input: ArrayBuffer | Uint8Array,
    options: { trackId?: number; maxSamples?: number } = {},
  ): Fmp4StreamSegmentResult {
    if (!this.init) throw new Error('fMP4 init segment must be loaded before media fragments.');
    try {
      const fragments = parseFmp4Fragments(input, { ...options, initSegment: this.init });
      const discontinuities: Fmp4TrackDiscontinuity[] = [];
      for (const fragment of fragments) {
        for (const track of fragment.tracks) {
          if (track.timescale === null) {
            throw new Error(`Fragment references track ${track.trackId}, which is absent from the active init segment.`);
          }
          for (const sample of track.samples) {
            const previous = this.timelines.get(track.trackId);
            if (previous) {
              const measured = detectTimelineDiscontinuity(
                { decodeTime: previous.decodeTime, duration: previous.duration, timescale: previous.timescale },
                { decodeTime: sample.decodeTime, timescale: track.timescale },
              );
              if (measured.kind !== 'continuous') {
                discontinuities.push({ trackId: track.trackId, timescale: track.timescale, ...measured });
              }
            }
            if (sample.duration === null) {
              this.timelines.delete(track.trackId);
            } else {
              this.timelines.set(track.trackId, {
                decodeTime: sample.decodeTime,
                duration: sample.duration,
                timescale: track.timescale,
              });
            }
          }
        }
      }
      return {
        initGeneration: this.initGeneration,
        recoveryGeneration: this.recoveryGeneration,
        fragments,
        discontinuities,
      };
    } catch (error) {
      // A malformed fragment must not poison the next segment's continuity baseline.
      this.resetTimeline();
      this.recoveryGeneration += 1;
      throw error instanceof Error
        ? new Error(`fMP4 segment parse failed; timeline baseline reset: ${error.message}`)
        : new Error('fMP4 segment parse failed; timeline baseline reset.');
    }
  }

  resetTimeline(trackId?: number): number {
    if (trackId === undefined) this.timelines.clear();
    else this.timelines.delete(trackId);
    return this.recoveryGeneration;
  }

  recover(): number {
    this.timelines.clear();
    this.recoveryGeneration += 1;
    return this.recoveryGeneration;
  }
}
