import { describe, expect, it } from 'vitest';
import { inspectSpatialAudioCapabilities, planSpatialAudio } from './spatial-audio';

describe('planSpatialAudio', () => {
  it('keeps the original route when spatial processing is off', () => {
    expect(planSpatialAudio('off', 6, true).route).toBe('bypass');
  });

  it('uses a real 5.1 binaural route only for six-channel input', () => {
    const plan = planSpatialAudio('headphone-surround', 6, true);
    expect(plan.route).toBe('surround-5.1-binaural');
    expect(plan.label).toContain('5.1');
  });

  it('labels stereo fallback honestly instead of claiming surround', () => {
    const plan = planSpatialAudio('headphone-surround', 2, true);
    expect(plan.route).toBe('stereo-virtualization');
    expect(plan.reason).toContain('不会伪称为真实 5.1 或 Atmos');
  });

  it('bypasses unknown and unsupported channel layouts', () => {
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
