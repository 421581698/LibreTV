import { describe, expect, it } from 'vitest';
import { selectPlaybackBackend } from './backend-registry';
import { NativeMediaBackend } from './native-media-backend';
import { HlsMseBackend } from './hls-mse-backend';

const hls = { url: 'https://example.test/stream.m3u8', kind: 'hls' as const };
const mp4 = { url: 'https://example.test/movie.mp4', kind: 'mp4' as const };

describe('playback backend selection', () => {
  it('selects HLS/MSE for HLS when MSE is supported', () => {
    const selected = selectPlaybackBackend(hls, 'auto', { hasWindow: true, mseSupported: true, nativeHlsSupported: false });
    expect(selected.backend).toBeInstanceOf(HlsMseBackend);
    selected.backend.dispose();
  });

  it('selects native backend for direct files', () => {
    const selected = selectPlaybackBackend(mp4, 'auto', { hasWindow: true, mseSupported: true, nativeHlsSupported: false });
    expect(selected.backend).toBeInstanceOf(NativeMediaBackend);
    selected.backend.dispose();
  });

  it('falls back safely if MSE is unavailable', () => {
    const selected = selectPlaybackBackend(hls, 'auto', { hasWindow: true, mseSupported: false, nativeHlsSupported: true });
    expect(selected.backend).toBeInstanceOf(NativeMediaBackend);
    selected.backend.dispose();
  });
});
