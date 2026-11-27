import { describe, expect, it } from 'vitest';
import { emptyNativePlaybackObservation } from './native-playback-observation';
import { assessDolbyVisionPipeline } from './pipeline-stage-assessment';
import type { DolbyVisionNativeCapabilityReport } from './native-playback-capability';

const capability: DolbyVisionNativeCapabilityReport = {
  nativeHls: 'probably',
  codecs: [{ codec: 'dvh1.05.06', profile: 5, family: 'hevc', support: 'probably' }],
  hdrDisplayHint: 'high',
  actualDolbyVisionOutput: 'unverified',
  dynamicMetadataRendered: 'unverified',
  bitstreamPassthrough: 'unverified',
};

describe('six-stage Dolby Vision assessment never promotes indirect evidence', () => {
  it('keeps all six stages unestablished without device or signed evidence', () => {
    const rows = assessDolbyVisionPipeline({
      declared: false,
      signedRpuVerified: false,
      playback: emptyNativePlaybackObservation(),
      capability: null,
    });
    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row.state)).toEqual(Array(6).fill('not-established'));
  });

  it('separates codec/HDR hints and verified RPU from actual dynamic rendering', () => {
    const rows = assessDolbyVisionPipeline({
      declared: true,
      signedRpuVerified: true,
      playback: emptyNativePlaybackObservation(),
      capability,
    });
    expect(rows.map((row) => row.state)).toEqual([
      'capability-hint',
      'signed-evidence',
      'not-established',
      'not-established',
      'capability-hint',
      'not-established',
    ]);
  });

  it('recognizes signed asset mapping separately from player RPU application', () => {
    const rows = assessDolbyVisionPipeline({
      declared: true, signedRpuVerified: true, registeredFrameMappingVerified: true,
      playback: emptyNativePlaybackObservation(), capability,
    });
    expect(rows[2].state).toBe('signed-evidence');
    expect(rows[2].explanation).toContain('尚无当前 Safari');
    expect(rows[3].state).toBe('not-established');
    expect(rows[4].state).toBe('capability-hint');
    expect(assessDolbyVisionPipeline({
      declared: false, signedRpuVerified: false, registeredFrameMappingVerified: true,
      playback: emptyNativePlaybackObservation(), capability: null,
    })[2].state).toBe('not-established');
  });

  it('treats presented generic frames as observation, never proof of Dolby output', () => {
    const rows = assessDolbyVisionPipeline({
      declared: true,
      signedRpuVerified: false,
      playback: {
        ...emptyNativePlaybackObservation(),
        status: 'progress-observed',
        progressedSeconds: 2,
        presentedFrames: 40,
      },
      capability,
    });
    expect(rows[0].state).toBe('browser-observed');
    expect(rows[1].state).toBe('declaration-only');
    expect(rows.slice(2).map((row) => row.state)).toEqual([
      'not-established', 'not-established', 'capability-hint', 'not-established',
    ]);
  });

  it('does not treat timeline progression without a frame counter as decoded-frame proof', () => {
    const rows = assessDolbyVisionPipeline({
      declared: true,
      signedRpuVerified: false,
      playback: { ...emptyNativePlaybackObservation(), status: 'progress-observed', progressedSeconds: 5 },
      capability,
    });
    expect(rows[0].state).toBe('capability-hint');
  });
});
