import { describe, expect, it, vi } from 'vitest';
import {
  buildPlaybackDiagnostics,
  readStabilityMetrics,
  sanitizePlaybackDiagnostics,
  toHlsAudioTrackLike,
  toNativeAudioTrackLikes,
  type PlaybackDiagnostics,
} from './playback-diagnostics';

describe('read-only playback diagnostics aggregation', () => {
  it('routes a real HLS EC-3/JOC manifest through format detection without claiming Atmos decode', () => {
    const snapshot = buildPlaybackDiagnostics({
      format: { url: 'https://cdn.example.com/x.m3u8', codecs: 'ec-3', hlsChannels: '6/JOC' },
      assessmentMimeType: 'audio/mp4; codecs="ec-3"',
      capabilityEnvironment: {
        audioContextAvailable: true,
        mediaSourceAvailable: true,
        mediaCapabilitiesAvailable: true,
        userAgent: 'Mozilla/5.0 (iPad) Version/17.0 Safari/605.1.15',
        canPlayType: () => 'maybe',
      },
    });

    expect(snapshot.format?.audioCodec).toBe('eac3');
    expect(snapshot.format?.dolbyFamily).toBe('dolby-atmos-metadata');
    expect(snapshot.format?.hasJocMarker).toBe(true);
    expect(snapshot.format?.container).toBe('hls');
    // JOC marker is metadata only; capability must never assert Atmos decode or passthrough.
    expect(snapshot.capability?.atmosObjectDecode).toBe('not-established');
    expect(snapshot.capability?.bitstreamPassthrough).toBe('unknown');
    expect(snapshot.capability?.nativeDolbyDecode).toBe('unknown');
    expect(snapshot.capability?.safeDefault).toBe('native-media-playback');
    expect(snapshot.capability?.audioContext).toBe(true);
    expect(snapshot.capability?.outputDeviceName).toBe('not-exposed');
    expect(snapshot.capability?.spatialRendering).toBe('not-integrated');
  });

  it('aggregates real hls.js audio tracks through the shared mapper -> inspector path', () => {
    // These objects mirror hls.js MediaPlaylist audio tracks, including fields
    // that must never reach telemetry (name, url).
    const realAudioTracks = [
      { id: 1, name: 'Czech', url: 'https://cdn/audio/token=abc', groupId: 'aud1', channels: '2', audioCodec: 'mp4a.40.2', default: true, autoselect: true },
      { id: 2, name: 'Atmos', url: 'https://cdn/audio/token=xyz', groupId: 'aud1', channels: '6/JOC', audioCodec: 'ec-3', default: false, autoselect: false },
    ];
    const mapped = realAudioTracks.map(toHlsAudioTrackLike);
    expect(mapped[0]).not.toHaveProperty('name');
    expect(mapped[0]).not.toHaveProperty('url');
    const snapshot = buildPlaybackDiagnostics({ audioTracks: mapped });
    expect(snapshot.audio).toEqual({
      renditionCount: 2,
      maxChannels: 6,
      hasJocMarker: true,
    });
    expect(JSON.stringify(snapshot)).not.toContain('token=');
  });

  it('does not treat six channels alone as 5.1 and keeps unknown codec honest', () => {
    const snapshot = buildPlaybackDiagnostics({
      format: { codecs: 'mp4a.40.2', hlsChannels: '6' },
    });
    // Six channels stay "unknown" layout in the audio inspector and we never
    // fabricate a 5.1 label; the telemetry snapshot carries no channel layout.
    expect(snapshot.format?.hasJocMarker).toBe(false);
    expect(snapshot.format?.audioCodec).toBe('aac');
    expect(snapshot.format?.dolbyFamily).toBe('none');
  });

  it('classifies real video state (offline / stalled) with bounded peaks', () => {
    const metrics = readStabilityMetrics({
      video: {
        currentTime: 10,
        readyState: 2,
        networkState: 2,
        paused: false,
        ended: false,
        buffered: { length: 1, start: () => 0, end: () => 10 },
        getVideoPlaybackQuality: () => ({ droppedVideoFrames: 30, totalVideoFrames: 100 }),
      },
      nowMs: 20_000,
      lastProgressAtMs: 0, // stalled for 20s with no forward buffer
      online: false,
    });
    const snapshot = buildPlaybackDiagnostics(
      { stabilityMetrics: metrics },
      { peakStallMs: 9_000, peakDroppedFrameRatio: 0.2 },
    );
    expect(snapshot.stability?.health).toBe('offline');
    expect(snapshot.stability?.peakStallMs).toBe(20_000);
    expect(snapshot.stability?.peakDroppedFrameRatio).toBeCloseTo(0.3);
  });

  it('reads buffered-ahead and dropped frames from real element state', () => {
    const metrics = readStabilityMetrics({
      video: {
        currentTime: 25,
        readyState: 4,
        networkState: 1,
        paused: false,
        ended: false,
        buffered: { length: 2, start: (i: number) => [0, 20][i], end: (i: number) => [15, 40][i] },
        getVideoPlaybackQuality: () => ({ droppedVideoFrames: 5, totalVideoFrames: 1000 }),
      },
      nowMs: 5_000,
      lastProgressAtMs: 4_900,
      online: true,
    });
    expect(metrics.bufferedAheadSeconds).toBe(15);
    expect(metrics.droppedFrames).toBe(5);
    expect(metrics.totalFrames).toBe(1000);
  });

  it('records no automatic action of any kind — aggregation is pure', () => {
    const onSwitch = vi.fn();
    const snapshot = buildPlaybackDiagnostics({
      format: { codecs: 'ec-3', hlsChannels: '6/JOC' },
      audioTracks: [{ channels: '6/JOC', audioCodec: 'ec-3' }],
    });
    expect(onSwitch).not.toHaveBeenCalled();
    expect(JSON.stringify(snapshot)).not.toContain('switch');
    expect(snapshot.capability).toBeNull(); // no environment => no capability probe
  });
});

describe('sanitizePlaybackDiagnostics (telemetry whitelist)', () => {
  it('drops URLs, free-form strings and out-of-range numbers', () => {
    const malicious = {
      format: {
        container: 'hls',
        audioCodec: 'eac3',
        dolbyFamily: 'dolby-atmos-metadata',
        confidence: 'declared',
        hasJocMarker: true,
      },
      audio: { renditionCount: 3, maxChannels: 6, hasJocMarker: false },
      capability: {
        browserFamily: 'safari',
        nativeDolbyDecode: 'yes-definitely', // must be forced back to 'unknown'
        bitstreamPassthrough: 'enabled', // must be forced back to 'unknown'
        browserDecode: 'maybe',
        atmosObjectDecode: 'proven',
        safeDefault: 'auto-atmos',
      },
      stability: { health: 'stalled', peakStallMs: 12000, peakDroppedFrameRatio: 0.4 },
      // Deliberate smuggled fields that must be stripped by the whitelist.
      url: 'https://cdn.example.com/token=secret',
      note: 'free form',
    } as unknown as PlaybackDiagnostics;
    const clean = sanitizePlaybackDiagnostics(malicious);
    const json = JSON.stringify(clean);
    expect(json).not.toContain('https://');
    expect(json).not.toContain('token=secret');
    expect(json).not.toContain('free form');
    expect(clean?.capability?.nativeDolbyDecode).toBe('unknown');
    expect(clean?.capability?.bitstreamPassthrough).toBe('unknown');
    expect(clean?.capability?.atmosObjectDecode).toBe('not-established');
    expect(clean?.capability?.safeDefault).toBe('native-media-playback');
    expect(clean?.capability?.outputDeviceName).toBe('not-exposed');
    expect(clean?.capability?.spatialRendering).toBe('not-integrated');
    expect(clean?.capability?.browserDecode).toBe('not-probed');
  });

  it('returns undefined for missing or malformed input', () => {
    expect(sanitizePlaybackDiagnostics(undefined)).toBeUndefined();
    expect(sanitizePlaybackDiagnostics(null)).toBeUndefined();
    expect(sanitizePlaybackDiagnostics({} as PlaybackDiagnostics)).toEqual({
      format: null, audio: null, capability: null, stability: null,
    });
  });
});


describe('native Safari audio-track observations', () => {
  it('records only exposed track count and does not invent codec or channel metadata', () => {
    expect(toNativeAudioTrackLikes({ length: 2 })).toEqual([{ id: 0 }, { id: 1 }]);
    const snapshot = buildPlaybackDiagnostics({ audioTracks: toNativeAudioTrackLikes({ length: 2 }) });
    expect(snapshot.audio).toEqual({ renditionCount: 2, maxChannels: null, hasJocMarker: false });
    expect(snapshot.format).toBeNull();
  });

  it('distinguishes an unavailable native track API from an exposed empty list', () => {
    expect(toNativeAudioTrackLikes(undefined)).toBeNull();
    expect(toNativeAudioTrackLikes({ length: 0 })).toEqual([]);
  });

  it('rejects invalid or implausibly large native track counts', () => {
    expect(toNativeAudioTrackLikes({ length: -1 })).toBeNull();
    expect(toNativeAudioTrackLikes({ length: 1.5 })).toBeNull();
    expect(toNativeAudioTrackLikes({ length: 65 })).toBeNull();
  });
});
