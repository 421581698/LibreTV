/**
 * Read-only playback diagnostics aggregation.
 *
 * Phase 1 rule: collect and report, never act. This module is the single place
 * where the four diagnostic libraries (format detector, audio inspector,
 * capability manager, playback stability) are invoked with REAL observations
 * from the player's HLS and video events. It produces a telemetry-safe snapshot
 * made only of enums, booleans and bounded numbers — never media URLs, tokens,
 * free-form notes or rendition names.
 *
 * Everything here is pure (no React / DOM dependency) so the exact code path
 * used by the player can be proven by unit tests in this DOM-less repo.
 */

import {
  detectMediaFormat,
  type AudioCodec,
  type Ac4CodecProfile,
  type DolbyFamily,
  type MediaContainer,
  type MediaFormatInput,
} from './format-detector';
import {
  inspectHlsAudioTrack,
  type HlsAudioTrackLike,
} from './audio-inspector';
import {
  assessCodecCapability,
  inspectAudioCapabilities,
  type AudioCapabilityEnvironment,
  type AudioCapabilityProfile,
  type CodecCapabilityAssessment,
} from './capability-manager';
import {
  evaluatePlaybackHealth,
  getBufferedAheadSeconds,
  type PlaybackHealth,
  type PlaybackStabilityMetrics,
} from './playback-stability';

export interface FormatDiagnostics {
  container: MediaContainer;
  audioCodec: AudioCodec;
  dolbyFamily: DolbyFamily;
  confidence: 'declared' | 'inferred' | 'unknown';
  hasJocMarker: boolean;
  ac4Profile?: Ac4CodecProfile | null;
}

export interface AudioDiagnostics {
  renditionCount: number;
  maxChannels: number | null;
  hasJocMarker: boolean;
}

export interface CapabilityDiagnostics {
  browserFamily: AudioCapabilityProfile['browserFamily'];
  nativeDolbyDecode: 'unknown';
  bitstreamPassthrough: 'unknown';
  browserDecode: CodecCapabilityAssessment['browserDecode'];
  atmosObjectDecode: 'not-established';
  safeDefault: 'native-media-playback';
  audioContext?: boolean;
  mediaSource?: boolean;
  mediaCapabilities?: boolean;
  outputMaxChannels?: number | null;
  outputLatencyMs?: number | null;
  outputDeviceName?: 'not-exposed';
  spatialRendering?: 'not-integrated';
}

export interface StabilityDiagnostics {
  health: PlaybackHealth;
  peakStallMs: number;
  peakDroppedFrameRatio: number | null;
}

/** Telemetry-safe; contains no URLs, tokens, notes or rendition names. */
export interface PlaybackDiagnostics {
  format: FormatDiagnostics | null;
  audio: AudioDiagnostics | null;
  capability: CapabilityDiagnostics | null;
  stability: StabilityDiagnostics | null;
}

export interface DiagnosticsInput {
  format?: MediaFormatInput | null;
  audioTracks?: HlsAudioTrackLike[] | null;
  capabilityEnvironment?: AudioCapabilityEnvironment | null;
  stabilityMetrics?: PlaybackStabilityMetrics | null;
  /** MIME used for the canPlayType hint; derived from the declared codec. */
  assessmentMimeType?: string;
}

export interface StabilityPeaks {
  peakStallMs: number;
  peakDroppedFrameRatio: number | null;
}

/** Minimal video-element shape required for a stability observation (pure input). */
export interface VideoStateLike {
  currentTime: number;
  readyState: number;
  networkState: number;
  paused: boolean;
  ended: boolean;
  buffered: { length: number; start(index: number): number; end(index: number): number } | null;
  getVideoPlaybackQuality?: () => { droppedVideoFrames?: number; totalVideoFrames?: number };
}

export interface StabilityObservationInput {
  video: VideoStateLike;
  nowMs: number;
  lastProgressAtMs: number | null;
  online: boolean;
}

/**
 * Build a stability metric snapshot from real video-element state.
 * The player calls this on timeupdate/waiting/playing; tests call the same
 * function with realistic buffered ranges, readyState and frame counters.
 */
export function readStabilityMetrics(input: StabilityObservationInput): PlaybackStabilityMetrics {
  const quality = input.video.getVideoPlaybackQuality?.();
  return {
    nowMs: input.nowMs,
    lastProgressAtMs: input.lastProgressAtMs,
    bufferedAheadSeconds: getBufferedAheadSeconds(input.video.buffered as Pick<TimeRanges, 'length' | 'start' | 'end'> | null, input.video.currentTime),
    readyState: input.video.readyState,
    networkState: input.video.networkState,
    online: input.online,
    paused: input.video.paused,
    ended: input.video.ended,
    droppedFrames: typeof quality?.droppedVideoFrames === 'number' ? quality.droppedVideoFrames : null,
    totalFrames: typeof quality?.totalVideoFrames === 'number' ? quality.totalVideoFrames : null,
  };
}

/**
 * Map a real hls.js MediaPlaylist audio track to the inspector's input shape.
 * Drops name/url so no rendition label or media URL reaches telemetry. The
 * player and the unit tests share this exact function, proving the real
 * `hls.audioTracks -> inspectHlsAudioTrack` path is covered.
 */
export function toHlsAudioTrackLike(track: {
  id?: number;
  groupId?: string;
  channels?: string;
  audioCodec?: string;
  default?: boolean;
  autoselect?: boolean;
}): HlsAudioTrackLike {
  return {
    id: track.id,
    groupId: track.groupId,
    channels: track.channels,
    audioCodec: track.audioCodec,
    default: track.default,
    autoselect: track.autoselect,
  };
}

/**
 * Read only the count exposed by a native HTMLMediaElement AudioTrackList.
 * Native track APIs do not reliably expose codec, channel layout or JOC.
 * A null result means the browser does not expose the API; [] means it does
 * expose the API and currently reports no tracks.
 */
export function toNativeAudioTrackLikes(
  trackList: { length: number } | null | undefined,
): HlsAudioTrackLike[] | null {
  if (!trackList || !Number.isInteger(trackList.length) || trackList.length < 0 || trackList.length > 64) {
    return null;
  }
  return Array.from({ length: trackList.length }, (_value, id) => ({ id }));
}

function boundedRatio(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : null;
}

function boundedMs(value: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(24 * 60 * 60 * 1000, value)
    : 0;
}

/**
 * Aggregate all four diagnostic libraries from real observations into one
 * read-only, telemetry-safe snapshot. No library here can change playback.
 */
export function buildPlaybackDiagnostics(
  input: DiagnosticsInput,
  peaks: StabilityPeaks = { peakStallMs: 0, peakDroppedFrameRatio: null },
): PlaybackDiagnostics {
  let format: FormatDiagnostics | null = null;
  if (input.format) {
    const report = detectMediaFormat(input.format);
    format = {
      container: report.container,
      audioCodec: report.audioCodec,
      dolbyFamily: report.dolbyFamily,
      confidence: report.confidence,
      // JOC is a metadata hint only — never surfaced as Atmos object decode.
      hasJocMarker: report.hasJocMarker,
      ac4Profile: report.ac4Profile,
    };
  }

  let audio: AudioDiagnostics | null = null;
  if (input.audioTracks) {
    const renditions = input.audioTracks.map(inspectHlsAudioTrack);
    audio = {
      renditionCount: renditions.length,
      maxChannels: renditions.reduce<number | null>((max, r) =>
        r.channelCount === null ? max : Math.max(max ?? 0, r.channelCount), null),
      hasJocMarker: renditions.some((r) => r.hasJocMarker),
    };
  }

  let capability: CapabilityDiagnostics | null = null;
  if (input.capabilityEnvironment) {
    const env = input.capabilityEnvironment;
    const profile = inspectAudioCapabilities(env);
    let browserDecode: CodecCapabilityAssessment['browserDecode'] = 'not-probed';
    if (format && format.audioCodec !== 'unknown') {
      const assessment = assessCodecCapability(
        format.audioCodec,
        format.dolbyFamily,
        input.assessmentMimeType ?? 'audio/mp4',
        env,
      );
      browserDecode = assessment.browserDecode;
    }
    capability = {
      browserFamily: profile.browserFamily,
      nativeDolbyDecode: 'unknown',
      bitstreamPassthrough: 'unknown',
      browserDecode,
      atmosObjectDecode: 'not-established',
      safeDefault: 'native-media-playback',
      audioContext: env.audioContextAvailable,
      mediaSource: env.mediaSourceAvailable,
      mediaCapabilities: env.mediaCapabilitiesAvailable,
      outputMaxChannels: profile.outputMaxChannels,
      outputLatencyMs: profile.outputLatencyMs,
      outputDeviceName: 'not-exposed',
      spatialRendering: 'not-integrated',
    };
  }

  let stability: StabilityDiagnostics | null = null;
  if (input.stabilityMetrics) {
    const report = evaluatePlaybackHealth(input.stabilityMetrics);
    stability = {
      health: report.health,
      peakStallMs: boundedMs(Math.max(peaks.peakStallMs, report.stallDurationMs)),
      peakDroppedFrameRatio: boundedRatio(
        peaks.peakDroppedFrameRatio === null && report.droppedFrameRatio === null
          ? null
          : Math.max(peaks.peakDroppedFrameRatio ?? 0, report.droppedFrameRatio ?? 0),
      ),
    };
  }

  return { format, audio, capability, stability };
}

const CONTAINERS: MediaContainer[] = ['hls', 'mp4', 'mkv', 'webm', 'mpeg-ts', 'unknown'];
const CODECS: AudioCodec[] = ['ac4', 'eac3', 'ac3', 'truehd', 'dolby-mat', 'dts-x', 'dts-hd', 'dts', 'aac', 'iamf', 'pcm', 'opus', 'flac', 'alac', 'unknown'];
const DOLBY_FAMILIES: DolbyFamily[] = ['dolby-ac4', 'dolby-digital', 'dolby-digital-plus', 'dolby-truehd', 'dolby-mat', 'dolby-atmos-metadata', 'none', 'unknown'];
const CONFIDENCES = ['declared', 'inferred', 'unknown'];
const BROWSER_FAMILIES = ['safari', 'chromium', 'firefox', 'other', 'unknown'];
const BROWSER_DECODE = ['not-probed', 'can-play-hint', 'cannot-play-hint'];
const HEALTHS: PlaybackHealth[] = ['healthy', 'low-buffer', 'buffering', 'stalled', 'offline', 'degraded', 'unknown'];

function oneOf<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : fallback;
}

/**
 * Strict whitelist used by mergePlaybackHealth. Rebuilds the snapshot from
 * known enums/numbers/booleans only, so no URL or free-form string can survive.
 */
export function sanitizePlaybackDiagnostics(value: PlaybackDiagnostics | undefined | null): PlaybackDiagnostics | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const result: PlaybackDiagnostics = { format: null, audio: null, capability: null, stability: null };

  if (value.format && typeof value.format === 'object') {
    result.format = {
      container: oneOf(CONTAINERS, value.format.container, 'unknown'),
      audioCodec: oneOf(CODECS, value.format.audioCodec, 'unknown'),
      dolbyFamily: oneOf(DOLBY_FAMILIES, value.format.dolbyFamily, 'unknown'),
      confidence: oneOf(CONFIDENCES, value.format.confidence, 'unknown') as FormatDiagnostics['confidence'],
      hasJocMarker: value.format.hasJocMarker === true,
      ac4Profile: value.format.ac4Profile &&
        Number.isInteger(value.format.ac4Profile.bitstreamVersion) && value.format.ac4Profile.bitstreamVersion >= 0 && value.format.ac4Profile.bitstreamVersion <= 255 &&
        Number.isInteger(value.format.ac4Profile.presentationVersion) && value.format.ac4Profile.presentationVersion >= 0 && value.format.ac4Profile.presentationVersion <= 255 &&
        Number.isInteger(value.format.ac4Profile.mdcompat) && value.format.ac4Profile.mdcompat >= 0 && value.format.ac4Profile.mdcompat <= 4
        ? { bitstreamVersion: value.format.ac4Profile.bitstreamVersion, presentationVersion: value.format.ac4Profile.presentationVersion, mdcompat: value.format.ac4Profile.mdcompat }
        : null,
    };
  }
  if (value.audio && typeof value.audio === 'object') {
    const count = value.audio.renditionCount;
    const channels = value.audio.maxChannels;
    result.audio = {
      renditionCount: typeof count === 'number' && Number.isFinite(count) && count >= 0 ? Math.min(1000, Math.floor(count)) : 0,
      maxChannels: typeof channels === 'number' && Number.isFinite(channels) && channels > 0 ? Math.min(64, Math.floor(channels)) : null,
      hasJocMarker: value.audio.hasJocMarker === true,
    };
  }
  if (value.capability && typeof value.capability === 'object') {
    result.capability = {
      browserFamily: oneOf(BROWSER_FAMILIES, value.capability.browserFamily, 'unknown') as CapabilityDiagnostics['browserFamily'],
      nativeDolbyDecode: 'unknown',
      bitstreamPassthrough: 'unknown',
      browserDecode: oneOf(BROWSER_DECODE, value.capability.browserDecode, 'not-probed') as CodecCapabilityAssessment['browserDecode'],
      atmosObjectDecode: 'not-established',
      safeDefault: 'native-media-playback',
      audioContext: value.capability.audioContext === true,
      mediaSource: value.capability.mediaSource === true,
      mediaCapabilities: value.capability.mediaCapabilities === true,
      outputMaxChannels: typeof value.capability.outputMaxChannels === 'number' && Number.isFinite(value.capability.outputMaxChannels) && value.capability.outputMaxChannels > 0 ? Math.min(64, Math.floor(value.capability.outputMaxChannels)) : null,
      outputLatencyMs: typeof value.capability.outputLatencyMs === 'number' && Number.isFinite(value.capability.outputLatencyMs) && value.capability.outputLatencyMs >= 0 ? Math.min(60000, Math.floor(value.capability.outputLatencyMs)) : null,
      outputDeviceName: 'not-exposed',
      spatialRendering: 'not-integrated',
    };
  }
  if (value.stability && typeof value.stability === 'object') {
    result.stability = {
      health: oneOf(HEALTHS, value.stability.health, 'unknown'),
      peakStallMs: boundedMs(value.stability.peakStallMs),
      peakDroppedFrameRatio: boundedRatio(value.stability.peakDroppedFrameRatio),
    };
  }
  return result;
}
