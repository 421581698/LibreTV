/**
 * Validates versioned snapshots received from a trusted native app bridge.
 *
 * These values are adapter-reported diagnostics, not independent proof of
 * physical Dolby output. This module deliberately does not feed the
 * AudioVerificationEvidence "verified" fields.
 */

export type NativeAudioPlatform = 'ios' | 'ipados' | 'android';
export type NativeAudioRoute =
  | 'built-in-speaker'
  | 'wired-headphones'
  | 'bluetooth'
  | 'hdmi'
  | 'unknown';
export type NativeReportedState =
  | 'reported-active'
  | 'reported-inactive'
  | 'unsupported'
  | 'unknown';

export interface NativeAudioSnapshotV1 {
  version: 1;
  platform: NativeAudioPlatform;
  sessionId: string;
  capturedAtMs: number;
  device: {
    osVersion: string;
    appVersion: string;
  };
  input: {
    codec: string | null;
    channels: number | null;
    sampleRateHz: number | null;
    jocMarker: 'present' | 'absent' | 'unknown';
  };
  decoder: {
    state: 'idle' | 'supported' | 'active' | 'failed' | 'unknown';
    codec: string | null;
  };
  spatializer: {
    available: boolean | null;
    enabled: boolean | null;
  };
  output: {
    route: NativeAudioRoute;
    nativeDolbyState: NativeReportedState;
    jocDecodeState: NativeReportedState;
    objectRenderState: NativeReportedState;
  };
}

export type NativeAudioSnapshotResult =
  | { ok: true; snapshot: NativeAudioSnapshotV1 }
  | {
      ok: false;
      reason:
        | 'invalid-shape'
        | 'unsupported-version'
        | 'invalid-enum'
        | 'invalid-value'
        | 'wrong-session'
        | 'stale-snapshot'
        | 'future-snapshot';
    };

export interface NativeAudioSnapshotValidationOptions {
  expectedSessionId: string;
  nowMs?: number;
  maxAgeMs?: number;
  maxFutureSkewMs?: number;
}

const platforms = new Set<NativeAudioPlatform>(['ios', 'ipados', 'android']);
const routes = new Set<NativeAudioRoute>([
  'built-in-speaker', 'wired-headphones', 'bluetooth', 'hdmi', 'unknown',
]);
const reportedStates = new Set<NativeReportedState>([
  'reported-active', 'reported-inactive', 'unsupported', 'unknown',
]);
const decoderStates = new Set(['idle', 'supported', 'active', 'failed', 'unknown']);
const jocMarkers = new Set(['present', 'absent', 'unknown']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown, maxLength = 128): value is string | null {
  return value === null || (typeof value === 'string' && value.length > 0 && value.length <= maxLength);
}

function isNullableInteger(value: unknown, min: number, max: number): value is number | null {
  return value === null || (Number.isInteger(value) && (value as number) >= min && (value as number) <= max);
}

function isNullableBoolean(value: unknown): value is boolean | null {
  return value === null || typeof value === 'boolean';
}

/**
 * Parse untrusted bridge input. The caller must additionally ensure that the
 * message came from the trusted top-level native shell, not an iframe or URL.
 */
export function parseNativeAudioSnapshot(
  value: unknown,
  options: NativeAudioSnapshotValidationOptions,
): NativeAudioSnapshotResult {
  if (!isRecord(value)) return { ok: false, reason: 'invalid-shape' };
  if (value.version !== 1) return { ok: false, reason: 'unsupported-version' };

  if (
    typeof value.platform !== 'string' || !platforms.has(value.platform as NativeAudioPlatform) ||
    !isRecord(value.device) || !isRecord(value.input) || !isRecord(value.decoder) ||
    !isRecord(value.spatializer) || !isRecord(value.output)
  ) {
    return { ok: false, reason: 'invalid-shape' };
  }

  const device = value.device;
  const input = value.input;
  const decoder = value.decoder;
  const spatializer = value.spatializer;
  const output = value.output;

  if (
    typeof value.sessionId !== 'string' || value.sessionId.length < 8 || value.sessionId.length > 128 ||
    typeof value.capturedAtMs !== 'number' || !Number.isFinite(value.capturedAtMs) ||
    typeof device.osVersion !== 'string' || !device.osVersion.length || device.osVersion.length > 64 ||
    typeof device.appVersion !== 'string' || !device.appVersion.length || device.appVersion.length > 64 ||
    !isNullableString(input.codec) ||
    !isNullableInteger(input.channels, 1, 64) ||
    !isNullableInteger(input.sampleRateHz, 8_000, 384_000) ||
    !isNullableString(decoder.codec) ||
    !isNullableBoolean(spatializer.available) ||
    !isNullableBoolean(spatializer.enabled)
  ) {
    return { ok: false, reason: 'invalid-value' };
  }

  if (
    !jocMarkers.has(input.jocMarker as string) ||
    !decoderStates.has(decoder.state as string) ||
    !routes.has(output.route as NativeAudioRoute) ||
    !reportedStates.has(output.nativeDolbyState as NativeReportedState) ||
    !reportedStates.has(output.jocDecodeState as NativeReportedState) ||
    !reportedStates.has(output.objectRenderState as NativeReportedState)
  ) {
    return { ok: false, reason: 'invalid-enum' };
  }

  if (value.sessionId !== options.expectedSessionId) {
    return { ok: false, reason: 'wrong-session' };
  }

  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? 30_000;
  const maxFutureSkewMs = options.maxFutureSkewMs ?? 5_000;
  if (value.capturedAtMs > nowMs + maxFutureSkewMs) {
    return { ok: false, reason: 'future-snapshot' };
  }
  if (nowMs - value.capturedAtMs > maxAgeMs) {
    return { ok: false, reason: 'stale-snapshot' };
  }

  // Copy only the declared schema fields. Extra bridge properties (including
  // accidental URLs, tokens or headers) never enter application state.
  return {
    ok: true,
    snapshot: {
      version: 1,
      platform: value.platform as NativeAudioPlatform,
      sessionId: value.sessionId,
      capturedAtMs: value.capturedAtMs,
      device: { osVersion: device.osVersion, appVersion: device.appVersion },
      input: {
        codec: input.codec,
        channels: input.channels,
        sampleRateHz: input.sampleRateHz,
        jocMarker: input.jocMarker as NativeAudioSnapshotV1['input']['jocMarker'],
      },
      decoder: {
        state: decoder.state as NativeAudioSnapshotV1['decoder']['state'],
        codec: decoder.codec,
      },
      spatializer: {
        available: spatializer.available,
        enabled: spatializer.enabled,
      },
      output: {
        route: output.route as NativeAudioRoute,
        nativeDolbyState: output.nativeDolbyState as NativeReportedState,
        jocDecodeState: output.jocDecodeState as NativeReportedState,
        objectRenderState: output.objectRenderState as NativeReportedState,
      },
    },
  };
}

/** A deliberately non-certifying label for diagnostics UI. */
export function describeNativeAudioSnapshot(snapshot: NativeAudioSnapshotV1): string {
  const state = snapshot.output.nativeDolbyState;
  const route = snapshot.output.route;
  return `原生应用报告：Dolby=${state}；输出路由=${route}。此报告不是独立的声学输出验证。`;
}
