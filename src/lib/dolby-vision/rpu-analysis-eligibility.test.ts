import { describe, expect, it } from 'vitest';
import { canAnalyzeDolbyVisionRpuAsset } from './rpu-analysis-eligibility';

describe('canAnalyzeDolbyVisionRpuAsset', () => {
  it('allows a registered MP4 with a single HEVC video codec family', () => {
    expect(canAnalyzeDolbyVisionRpuAsset('asset-123', {
      container: 'mp4',
      codecFamilies: ['hevc'],
    })).toBe(true);
  });

  it('rejects AV1 because the HEVC parser cannot process AV1 OBU/EMDF', () => {
    expect(canAnalyzeDolbyVisionRpuAsset('asset-123', {
      container: 'mp4',
      codecFamilies: ['av1'],
    })).toBe(false);
  });

  it('rejects ambiguous mixed codec-family declarations', () => {
    expect(canAnalyzeDolbyVisionRpuAsset('asset-123', {
      container: 'mp4',
      codecFamilies: ['hevc', 'av1'],
    })).toBe(false);
  });

  it('rejects non-MP4 containers', () => {
    expect(canAnalyzeDolbyVisionRpuAsset('asset-123', {
      container: 'hls',
      codecFamilies: ['hevc'],
    })).toBe(false);
  });

  it('requires a stable registered asset ID', () => {
    expect(canAnalyzeDolbyVisionRpuAsset(undefined, {
      container: 'mp4',
      codecFamilies: ['hevc'],
    })).toBe(false);
  });

  it('rejects missing format evidence', () => {
    expect(canAnalyzeDolbyVisionRpuAsset('asset-123', null)).toBe(false);
  });
});
