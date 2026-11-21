import { describe, expect, it } from 'vitest';
import { inspectSpatialAudioCapabilities, isAudioSourceUrlOriginSafe, isMediaElementAudioOriginSafe, planSpatialAudio } from './spatial-audio';

describe('planSpatialAudio', () => {
  it('keeps the original route when spatial processing is off', () => {
    expect(planSpatialAudio('off', 6, true).route).toBe('bypass');
  });

  it('requires an explicitly verified 5.1 speaker layout before binaural routing', () => {
    expect(planSpatialAudio('headphone-surround', 6, true).route).toBe('bypass');
    const plan = planSpatialAudio('headphone-surround', 6, true, '5.1');
    expect(plan.route).toBe('surround-5.1-binaural');
    expect(plan.label).toContain('5.1');
  });

  it('labels stereo fallback honestly instead of claiming surround', () => {
    const plan = planSpatialAudio('headphone-surround', 2, true);
    expect(plan.route).toBe('stereo-virtualization');
    expect(plan.reason).toContain('不会伪称为真实 5.1 或 Atmos');
  });

  it('bypasses unknown and unsupported channel layouts', () => {
    expect(planSpatialAudio('headphone-surround', 6, true, 'unknown').reason).toContain('未验证扬声器顺序');
    expect(planSpatialAudio('headphone-surround', 0, true).route).toBe('bypass');
    expect(planSpatialAudio('headphone-surround', 8, true).route).toBe('bypass');
    expect(planSpatialAudio('headphone-stereo', 2, false).route).toBe('bypass');
  });

  it('allows stereo headphone virtualization for two-channel input', () => {
    expect(planSpatialAudio('headphone-stereo', 2, true).route).toBe('stereo-virtualization');
  });
});

describe('inspectSpatialAudioCapabilities', () => {
  it('returns a safe unavailable profile when no AudioContext exists', () => {
    expect(inspectSpatialAudioCapabilities(null)).toEqual({
      webAudio: false,
      mediaElementSource: false,
      hrtfPanner: false,
      outputMaxChannels: null,
      outputLatencyMs: null,
    });
  });
});

describe('isMediaElementAudioOriginSafe', () => {
  const media = (currentSrc: string, crossOrigin: string | null = null) => ({
    currentSrc,
    src: currentSrc,
    crossOrigin,
  }) as unknown as HTMLMediaElement;

  it('allows same-origin and MediaSource blob URLs', () => {
    expect(isMediaElementAudioOriginSafe(media('/media/movie.mp4'), 'https://libretv.example')).toBe(true);
    expect(isMediaElementAudioOriginSafe(media('blob:https://libretv.example/abc'), 'https://libretv.example')).toBe(true);
  });

  it('rejects direct cross-origin media without an explicit CORS mode', () => {
    expect(isMediaElementAudioOriginSafe(media('https://cdn.example/movie.mp4'), 'https://libretv.example')).toBe(false);
  });

  it('allows cross-origin media only when the element is configured for CORS', () => {
    expect(isMediaElementAudioOriginSafe(media('https://cdn.example/movie.mp4', 'anonymous'), 'https://libretv.example')).toBe(true);
    expect(isMediaElementAudioOriginSafe(media('https://cdn.example/movie.mp4', 'use-credentials'), 'https://libretv.example')).toBe(true);
  });
});

describe('isAudioSourceUrlOriginSafe', () => {
  it('checks a prospective source URL before it is assigned to a media element', () => {
    expect(isAudioSourceUrlOriginSafe('blob:https://libretv.example/abc', 'https://libretv.example')).toBe(true);
    expect(isAudioSourceUrlOriginSafe('https://cdn.example/movie.mp4', 'https://libretv.example')).toBe(false);
    expect(isAudioSourceUrlOriginSafe('https://cdn.example/movie.mp4', 'https://libretv.example', 'anonymous')).toBe(true);
  });
});
