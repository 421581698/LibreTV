import {
  extractFmp4SamplePayload,
  parseFmp4InitSegment,
  type Fmp4InitSegment,
  type Fmp4TrackMetadata,
} from './fmp4-fragment-parser';
import { Fmp4StreamSession } from './fmp4-stream-session';
import { validateCmafEac3AccessUnit } from './joc-cmaf-validation';
import { validateCmafJocTrackConfiguration } from './joc-dec3-config';

export interface JocCmafPacket {
  readonly trackId: number;
  readonly sampleIndex: number;
  readonly decodeTime: number;
  readonly presentationTime: number;
  readonly duration: number;
  readonly timescale: number;
  readonly sampleEntry: 'ec-3';
  readonly bytes: Uint8Array;
}

export interface JocCmafExtractionLimits {
  readonly maxSamplesPerSegment?: number;
  readonly maxSampleBytes?: number;
  readonly maxSegmentPayloadBytes?: number;
}

export interface JocCmafExtractionResult {
  /** CMAF codec hint only; this does not establish that the stream contains JOC. */
  readonly codecHint: 'ec-3';
  readonly trackId: number;
  readonly timescale: number;
  readonly packets: readonly JocCmafPacket[];
  readonly discontinuities: ReturnType<Fmp4StreamSession['parseMediaSegment']>['discontinuities'];
  readonly totalPayloadBytes: number;
}

/**
 * Maps an access-unit PTS onto the hls.js media timeline using the HLS
 * fragment start as the anchor for the first access unit in that fragment.
 * This is a timeline transform only; callers must still validate it against
 * real media/device playback before enabling software output.
 */
export function mapJocPresentationTimeToMediaSamples(
  presentationTime: number,
  timescale: number,
  fragmentStartSeconds: number,
  anchorPresentationTime: number,
): number {
  if (![presentationTime, timescale, fragmentStartSeconds, anchorPresentationTime].every(Number.isFinite) ||
      timescale <= 0) {
    throw new Error('JOC media timeline mapping requires finite timestamps and a positive timescale.');
  }
  const mapped = fragmentStartSeconds * 48_000 +
    (presentationTime - anchorPresentationTime) * 48_000 / timescale;
  const rounded = Math.round(mapped);
  if (!Number.isSafeInteger(rounded)) {
    throw new Error('JOC media timeline mapping exceeds the safe sample clock range.');
  }
  return rounded;
}

const DEFAULT_MAX_SAMPLES = 4096;
const DEFAULT_MAX_SAMPLE_BYTES = 1024 * 1024;
const DEFAULT_MAX_SEGMENT_PAYLOAD_BYTES = 8 * 1024 * 1024;

function bytesOf(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function isEac3AudioTrack(track: Fmp4TrackMetadata): boolean {
  return track.handlerType === 'soun' && track.sampleEntries.includes('ec-3');
}

/**
 * Bounded CMAF E-AC-3 sample extractor for a future software-JOC decode lane.
 *
 * It extracts complete MP4 samples and their media-clock timestamps only.
 * An ec-3 sample entry is not proof of a JOC bitstream; OpenJOC must inspect
 * the actual access-unit bytes before any JOC-decoded status can be reported.
 * The caller remains responsible for feeding ordered packets, resetting on
 * discontinuities, and binding work to the active playback generation.
 */
export class JocCmafPacketExtractor {
  private readonly stream = new Fmp4StreamSession();
  private readonly trackId: number;
  private readonly limits: Required<JocCmafExtractionLimits>;
  private activeTrack: Fmp4TrackMetadata | null = null;

  constructor(trackId: number, limits: JocCmafExtractionLimits = {}) {
    if (!Number.isInteger(trackId) || trackId <= 0) {
      throw new Error('E-AC-3 CMAF track ID must be a positive integer.');
    }
    this.trackId = trackId;
    this.limits = {
      maxSamplesPerSegment: limits.maxSamplesPerSegment ?? DEFAULT_MAX_SAMPLES,
      maxSampleBytes: limits.maxSampleBytes ?? DEFAULT_MAX_SAMPLE_BYTES,
      maxSegmentPayloadBytes: limits.maxSegmentPayloadBytes ?? DEFAULT_MAX_SEGMENT_PAYLOAD_BYTES,
    };
    if (!Number.isInteger(this.limits.maxSamplesPerSegment) || this.limits.maxSamplesPerSegment < 1 ||
        !Number.isInteger(this.limits.maxSampleBytes) || this.limits.maxSampleBytes < 1 ||
        !Number.isInteger(this.limits.maxSegmentPayloadBytes) || this.limits.maxSegmentPayloadBytes < 1) {
      throw new Error('E-AC-3 CMAF extraction limits must be positive integers.');
    }
  }

  updateInitSegment(input: ArrayBuffer | Uint8Array): { changed: boolean; generation: number } {
    const bytes = bytesOf(input);
    const parsed: Fmp4InitSegment = parseFmp4InitSegment(bytes);
    const track = parsed.tracks.find(candidate => candidate.trackId === this.trackId);
    if (!track || !isEac3AudioTrack(track) || track.sampleEntry !== 'ec-3') {
      this.activeTrack = null;
      this.stream.recover();
      throw new Error('Selected CMAF track is not an E-AC-3 audio track using the active ec-3 sample description.');
    }
    try {
      validateCmafJocTrackConfiguration({
        sampleEntry: track.sampleEntry,
        timescale: track.timescale,
        sampleRate: track.sampleRate ?? 0,
        decoderConfig: track.decoderConfig,
      });
    } catch (error) {
      this.activeTrack = null;
      this.stream.recover();
      const detail = error instanceof Error ? error.message : 'unknown dec3 profile error';
      throw new Error(`Selected E-AC-3 track is not a supported CMAF JOC track: ${detail}`);
    }
    const result = this.stream.updateInitSegment(bytes);
    this.activeTrack = track;
    return { changed: result.changed, generation: result.generation };
  }

  extractMediaSegment(input: ArrayBuffer | Uint8Array): JocCmafExtractionResult {
    const track = this.activeTrack;
    if (!track) throw new Error('An E-AC-3 audio initialization segment is required before media samples.');
    const bytes = bytesOf(input);
    const parsed = this.stream.parseMediaSegment(bytes, {
      trackId: this.trackId,
      maxSamples: this.limits.maxSamplesPerSegment,
    });
    if (track.timescale !== 48_000) {
      throw new Error('OpenJOC CMAF JOC requires a 48 kHz track timescale.');
    }
    const packets: JocCmafPacket[] = [];
    let totalPayloadBytes = 0;

    for (const fragment of parsed.fragments) {
      const fragmentTrack = fragment.tracks.find(candidate => candidate.trackId === this.trackId);
      if (!fragmentTrack) continue;
      if (fragmentTrack.timescale !== track.timescale || fragmentTrack.timescale === null) {
        throw new Error('E-AC-3 CMAF track timescale changed without a new initialization segment.');
      }
      if (fragmentTrack.sampleEntry !== 'ec-3') {
        throw new Error('E-AC-3 CMAF sample description changed to an unsupported codec.');
      }
      const expectedDescriptionIndex = track.defaultSampleDescriptionIndex ?? 1;
      if (fragmentTrack.sampleDescriptionIndex !== null &&
          fragmentTrack.sampleDescriptionIndex !== expectedDescriptionIndex) {
        throw new Error('E-AC-3 CMAF sample description index changed without a new initialization segment.');
      }
      for (const sample of fragmentTrack.samples) {
        if (sample.duration !== 1536 || sample.size === null || sample.size <= 0) {
          throw new Error('OpenJOC CMAF JOC samples must have a 1536-sample duration and a positive size.');
        }
        if (sample.size > this.limits.maxSampleBytes) {
          throw new Error('E-AC-3 CMAF sample exceeds the configured byte limit.');
        }
        totalPayloadBytes += sample.size;
        if (totalPayloadBytes > this.limits.maxSegmentPayloadBytes) {
          throw new Error('E-AC-3 CMAF segment exceeds the configured payload byte limit.');
        }
        const payload = extractFmp4SamplePayload(bytes, sample, fragment.mdatRanges);
        if (payload.byteLength !== sample.size) {
          throw new Error('E-AC-3 CMAF sample payload length does not match its declared size.');
        }
        validateCmafEac3AccessUnit(payload, track.decoderConfig);
        packets.push({
          trackId: this.trackId,
          sampleIndex: sample.index,
          decodeTime: sample.decodeTime,
          presentationTime: sample.presentationTime,
          duration: sample.duration,
          timescale: fragmentTrack.timescale,
          sampleEntry: 'ec-3',
          bytes: payload,
        });
      }
    }

    return {
      codecHint: 'ec-3',
      trackId: this.trackId,
      timescale: track.timescale,
      packets,
      discontinuities: parsed.discontinuities,
      totalPayloadBytes,
    };
  }

  resetTimeline(): number {
    return this.stream.recover();
  }
}
