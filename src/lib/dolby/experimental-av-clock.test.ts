import { describe, expect, it } from 'vitest';
import { planExperimentalPcm } from './experimental-av-clock';
const base = { ptsSamples: 48000n, sampleRate: 48000, mediaTime: 1, audioTime: 10, playbackRate: 1, queuedUntil: 10 };
describe('experimental PCM clock', () => {
  it('maps media PTS to audio clock', () => {
    expect(planExperimentalPcm(base)).toEqual({ action: 'schedule', at: 10 });
    expect(planExperimentalPcm({ ...base, ptsSamples: 57600n, playbackRate: 2 })).toEqual({ action: 'schedule', at: 10.1 });
  });
  it('bounds late and early frames', () => {
    expect(planExperimentalPcm({ ...base, mediaTime: 2 })).toEqual({ action: 'drop' });
    expect(planExperimentalPcm({ ...base, mediaTime: 0 })).toEqual({ action: 'wait' });
  });
  it('rejects unsupported sample rates, extreme playback rates and negative queue clocks', () => {
    for (const sampleRate of [7999, 48000.5, 192001]) expect(planExperimentalPcm({ ...base, sampleRate })).toEqual({ action: 'reset' });
    for (const playbackRate of [0.1, 5]) expect(planExperimentalPcm({ ...base, playbackRate })).toEqual({ action: 'reset' });
    expect(planExperimentalPcm({ ...base, queuedUntil: -1 })).toEqual({ action: 'reset' });
    expect(planExperimentalPcm({ ...base, ptsSamples: 9007199254740992n })).toEqual({ action: 'reset' });
  });
  it('resets on invalid clock or queue overlap', () => {
    expect(planExperimentalPcm({ ...base, playbackRate: 0 })).toEqual({ action: 'reset' });
    expect(planExperimentalPcm({ ...base, queuedUntil: 11 })).toEqual({ action: 'reset' });
  });
});
