import { describe, expect, it } from 'vitest';
import { isCandidatePreviewEligible } from './collector-playback-eligibility';

const base = {
  kind: 'direct-media',
  url: 'https://media.example/movie.mp4',
  status: 'validated',
  access_state: 'PUBLIC',
  validation: {
    reachable: true,
    media_format: 'progressive',
    content_type: 'video/mp4',
    access: { access_state: 'PUBLIC' },
  },
};

describe('isCandidatePreviewEligible', () => {
  it('allows a public, reachable, supported progressive file after validation', () => {
    expect(isCandidatePreviewEligible(base)).toBe(true);
  });

  it('never treats HTTP reachability alone as playback eligibility', () => {
    expect(isCandidatePreviewEligible({ ...base, status: 'checked' })).toBe(false);
  });

  it('rejects inaccessible or encrypted resources', () => {
    expect(isCandidatePreviewEligible({
      ...base,
      validation: { ...base.validation, access: { access_state: 'ENCRYPTED_STREAM' } },
    })).toBe(false);
  });

  it('rejects unreachable resources', () => {
    expect(isCandidatePreviewEligible({
      ...base,
      validation: { ...base.validation, reachable: false },
    })).toBe(false);
  });

  it('rejects DASH until a PlayerShell adapter exists', () => {
    expect(isCandidatePreviewEligible({
      ...base,
      url: 'https://media.example/manifest.mpd',
      validation: { ...base.validation, media_format: 'dash' },
    })).toBe(false);
  });

  it('requires a valid HLS manifest', () => {
    expect(isCandidatePreviewEligible({
      ...base,
      url: 'https://media.example/master.m3u8',
      validation: {
        reachable: true,
        media_format: 'hls',
        manifest_valid: false,
        access: { access_state: 'PUBLIC' },
      },
    })).toBe(false);
  });

  it('requires a reachable HLS segment sample or variant leaf', () => {
    expect(isCandidatePreviewEligible({
      ...base,
      url: 'https://media.example/live.m3u8',
      validation: {
        reachable: true,
        media_format: 'hls',
        manifest_valid: true,
        segment_probe: { sampled: 3, failed: 0 },
        access: { access_state: 'PUBLIC' },
      },
    })).toBe(true);
    expect(isCandidatePreviewEligible({
      ...base,
      url: 'https://media.example/live.m3u8',
      validation: {
        reachable: true,
        media_format: 'hls',
        manifest_valid: true,
        segment_probe: { sampled: 3, failed: 1 },
        access: { access_state: 'PUBLIC' },
      },
    })).toBe(false);
  });

  it('rejects an HLS master with no reachable leaf variants', () => {
    expect(isCandidatePreviewEligible({
      ...base,
      url: 'https://media.example/master.m3u8',
      validation: {
        reachable: true,
        media_format: 'hls',
        manifest_valid: true,
        variant_tree_probe: { reachable_leaf_count: 0 },
        access: { access_state: 'PUBLIC' },
      },
    })).toBe(false);
  });

  it('rejects unsafe manifest references', () => {
    expect(isCandidatePreviewEligible({
      ...base,
      url: 'https://media.example/master.m3u8',
      validation: {
        reachable: true,
        media_format: 'hls',
        manifest_valid: true,
        rejected_reference_count: 1,
        segment_probe: { sampled: 3, failed: 0 },
        access: { access_state: 'PUBLIC' },
      },
    })).toBe(false);
  });

  it('does not offer embedded players as direct media', () => {
    expect(isCandidatePreviewEligible({ ...base, kind: 'embedded-player' })).toBe(false);
  });
});
