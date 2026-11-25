import { describe, expect, it } from 'vitest';
import { inspectDolbyVisionFormat } from './format-inspector';
import { shouldPreferNativeDolbyVisionHls } from './native-hls-playback-policy';

const dolbyHls = inspectDolbyVisionFormat({
  url: 'https://example.test/master.m3u8',
  manifest: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=8000000,CODECS="dvh1.05.06",VIDEO-RANGE=PQ\ndolby.m3u8',
});
const ordinaryHls = inspectDolbyVisionFormat({
  url: 'https://example.test/master.m3u8',
  manifest: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,CODECS="avc1.4d401e"\nregular.m3u8',
});
const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1';
const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Safari/537.36';

const defaultOptions = {
  userAgent: safari,
  nativeHlsTypeSupport: 'maybe',
  qualityPreference: 'auto',
  playbackStarted: false,
  alreadyAttemptedNative: false,
};

describe('native Safari Dolby Vision HLS routing', () => {
  it('chooses the native path when Dolby is declared and Safari supports native HLS', () => {
    expect(shouldPreferNativeDolbyVisionHls(dolbyHls, defaultOptions)).toBe(true);
  });

  it('preserves hls.js for ordinary HLS, other browsers and unsupported native formats', () => {
    expect(shouldPreferNativeDolbyVisionHls(ordinaryHls, defaultOptions)).toBe(false);
    expect(shouldPreferNativeDolbyVisionHls(dolbyHls, { ...defaultOptions, userAgent: chrome })).toBe(false);
    expect(shouldPreferNativeDolbyVisionHls(dolbyHls, { ...defaultOptions, nativeHlsTypeSupport: '' })).toBe(false);
  });

  it('does not override manual quality restrictions or an ongoing playback session', () => {
    expect(shouldPreferNativeDolbyVisionHls(dolbyHls, { ...defaultOptions, qualityPreference: '1080' })).toBe(false);
    expect(shouldPreferNativeDolbyVisionHls(dolbyHls, { ...defaultOptions, qualityPreference: '4k' })).toBe(false);
    expect(shouldPreferNativeDolbyVisionHls(dolbyHls, { ...defaultOptions, playbackStarted: true })).toBe(false);
  });

  it('does not retry a failed native handoff for the same source', () => {
    expect(shouldPreferNativeDolbyVisionHls(dolbyHls, { ...defaultOptions, alreadyAttemptedNative: true })).toBe(false);
  });
});
