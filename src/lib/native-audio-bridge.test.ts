import { describe, expect, it } from 'vitest';
import {
  describeNativeAudioSnapshot,
  parseNativeAudioSnapshot,
  type NativeAudioSnapshotV1,
} from './native-audio-bridge';

const snapshot: NativeAudioSnapshotV1 = {
  version: 1,
  platform: 'ios',
  sessionId: 'session-12345678',
  capturedAtMs: 100_000,
  device: { osVersion: '27.0', appVersion: '1.0.0' },
  input: { codec: 'ec-3', channels: 6, sampleRateHz: 48_000, jocMarker: 'present' },
  decoder: { state: 'active', codec: 'ec-3' },
  spatializer: { available: true, enabled: true },
  output: {
    route: 'bluetooth',
    nativeDolbyState: 'reported-active',
    jocDecodeState: 'reported-active',
    objectRenderState: 'reported-active',
  },
};

const options = { expectedSessionId: snapshot.sessionId, nowMs: 100_500 };

describe('parseNativeAudioSnapshot', () => {
  it('accepts a fresh, valid snapshot for the active session', () => {
    const result = parseNativeAudioSnapshot(snapshot, options);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.snapshot.output.nativeDolbyState).toBe('reported-active');
  });

  it('rejects unsupported versions and malformed structures', () => {
    expect(parseNativeAudioSnapshot({ ...snapshot, version: 2 }, options))
      .toEqual({ ok: false, reason: 'unsupported-version' });
    expect(parseNativeAudioSnapshot({ ...snapshot, output: null }, options))
      .toEqual({ ok: false, reason: 'invalid-shape' });
  });

  it('rejects snapshots from a previous playback session', () => {
    expect(parseNativeAudioSnapshot(snapshot, { ...options, expectedSessionId: 'session-new-1234' }))
      .toEqual({ ok: false, reason: 'wrong-session' });
  });

  it('rejects stale and implausibly future-dated snapshots', () => {
    expect(parseNativeAudioSnapshot({ ...snapshot, capturedAtMs: 1 }, options))
      .toEqual({ ok: false, reason: 'stale-snapshot' });
    expect(parseNativeAudioSnapshot({ ...snapshot, capturedAtMs: 200_000 }, options))
      .toEqual({ ok: false, reason: 'future-snapshot' });
  });

  it('rejects malformed enums and out-of-range channel declarations', () => {
    expect(parseNativeAudioSnapshot({
      ...snapshot,
      input: { ...snapshot.input, jocMarker: 'decoded' },
    }, options)).toEqual({ ok: false, reason: 'invalid-enum' });
    expect(parseNativeAudioSnapshot({
      ...snapshot,
      input: { ...snapshot.input, channels: 128 },
    }, options)).toEqual({ ok: false, reason: 'invalid-value' });
  });

  it('copies only the declared schema and drops extra properties', () => {
    const result = parseNativeAudioSnapshot({
      ...snapshot,
      mediaUrl: 'https://example.invalid/secret?token=should-not-survive',
      authorization: 'secret',
    }, options);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot).not.toHaveProperty('mediaUrl');
      expect(result.snapshot).not.toHaveProperty('authorization');
    }
  });

  it('labels native values as reports rather than verified acoustic output', () => {
    const result = parseNativeAudioSnapshot(snapshot, options);
    if (!result.ok) throw new Error('Fixture should be valid');
    const label = describeNativeAudioSnapshot(result.snapshot);
    expect(label).toContain('原生应用报告');
    expect(label).toContain('不是独立的声学输出验证');
  });
});
