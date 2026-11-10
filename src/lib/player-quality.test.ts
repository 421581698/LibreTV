import { describe, expect, it } from 'vitest';
import { getAdvertised4kStatus, resolveQualitySelection } from './player-quality';

describe('resolveQualitySelection', () => {
  it('reports advertised 4K only from complete HLS rendition metadata', () => {
    expect(getAdvertised4kStatus([1080], 1, true)).toBe('not-advertised');
    expect(getAdvertised4kStatus([1080, 2160], 2, true)).toBe('advertised');
    expect(getAdvertised4kStatus([], 1, false)).toBe('unknown');
    expect(getAdvertised4kStatus([1080], 2, false)).toBe('unknown');
  });
  const levels = [
    { index: 0, height: 480 },
    { index: 1, height: 720 },
    { index: 2, height: 1080 },
    { index: 3, height: 2160 },
  ];

  it('keeps adaptive playback in auto mode', () => {
    expect(resolveQualitySelection(levels, 'auto')).toEqual({
      heights: [2160, 1080, 720, 480],
      shouldPause: false,
    });
  });

  it('locks to the highest available rendition at or below 1080p', () => {
    expect(resolveQualitySelection(levels, '1080')).toMatchObject({
      selectedIndex: 2,
      selectedHeight: 1080,
      shouldPause: false,
    });
  });

  it('never exceeds 1080p when the source only advertises 4K', () => {
    const result = resolveQualitySelection([{ index: 0, height: 2160 }], '1080');
    expect(result.shouldPause).toBe(true);
    expect(result.selectedIndex).toBeUndefined();
    expect(result.notice).toContain('没有 1080P');
  });

  it('locks to 4K when the source provides a 2160p rendition', () => {
    expect(resolveQualitySelection(levels, '4k')).toMatchObject({
      selectedIndex: 3,
      selectedHeight: 2160,
      shouldPause: false,
    });
  });

  it('chooses the highest bitrate when multiple variants share the selected resolution', () => {
    const result = resolveQualitySelection([
      { index: 1, height: 1080, bitrate: 4_000_000 },
      { index: 2, height: 1080, bitrate: 8_000_000 },
      { index: 3, height: 2160, bitrate: 18_000_000 },
    ], '1080');
    expect(result.selectedIndex).toBe(2);
  });

  it('reports missing 4K and uses the highest available lower rendition', () => {
    expect(resolveQualitySelection(levels.slice(0, 3), '4k')).toMatchObject({
      selectedIndex: 2,
      selectedHeight: 1080,
      shouldPause: false,
      notice: '源站未提供 4K，当前锁定最高可用档位 1080P。',
    });
  });

  it('does not guess when rendition heights are missing for a strict 1080p ceiling', () => {
    const result = resolveQualitySelection([{ index: 0, height: 0 }], '1080');
    expect(result.shouldPause).toBe(true);
    expect(result.heights).toEqual([]);
  });

  it('does not claim 4K is unavailable when some playlist levels have unknown heights', () => {
    const result = resolveQualitySelection([
      { index: 0, height: 1080 },
      { index: 1, height: 0 },
    ], '4k');
    expect(result.shouldPause).toBe(false);
    expect(result.selectedIndex).toBeUndefined();
    expect(result.notice).toContain('无法确认');
  });

  it('keeps 4K priority adaptive when the playlist omits rendition metadata', () => {
    const result = resolveQualitySelection([{ index: 0, height: 0 }], '4k');
    expect(result.shouldPause).toBe(false);
    expect(result.selectedIndex).toBeUndefined();
    expect(result.notice).toContain('无法读取');
  });
});
