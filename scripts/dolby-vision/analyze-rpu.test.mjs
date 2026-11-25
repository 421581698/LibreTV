import { describe, expect, it } from 'vitest';
import { parseDoviToolInfoSummary, parseLevelExportFiles } from './analyze-rpu.mjs';

describe('dovi_tool RPU report parsing', () => {
  it('parses a single Profile summary and positive RPU frame count', () => {
    expect(parseDoviToolInfoSummary('Summary:\n  Frames: 240\n  Profile: 8\n  DM version: 2 (CM v4.0)'))
      .toEqual({ frameCount: 240, profiles: [8] });
  });

  it('preserves multiple profiles rather than inventing one profile', () => {
    expect(parseDoviToolInfoSummary('Summary:\n  Frames: 120\n  Profiles: 7 (FEL), 8\n  DM version: 1 + 2'))
      .toEqual({ frameCount: 120, profiles: [7, 8] });
  });

  it('rejects missing, zero-frame or profile-less parser summaries', () => {
    expect(() => parseDoviToolInfoSummary('Parsing RPU file...')).toThrow(/Frames 或 Profile/);
    expect(() => parseDoviToolInfoSummary('Frames: 0\nProfile: 8')).toThrow(/大于 0/);
    expect(() => parseDoviToolInfoSummary('Frames: 2\nProfile: unknown')).toThrow(/有效 Dolby Vision Profile/);
  });

  it('reports only metadata levels with actual exported frame records', () => {
    const report = parseLevelExportFiles({
      1: '[{"frame":0,"min_pq":1},{"frame":1,"min_pq":2}]',
      2: '[]',
      5: '[{"frame":0,"active_area_left_offset":0}]',
      6: '[]',
      8: '[{"frame":1,"target_display_index":1}]',
    }, 2);
    expect(report).toEqual({
      metadataLevels: [1, 5, 8],
      metadataLevelFrameCounts: { 1: 2, 5: 1, 8: 1 },
    });
  });

  it('counts distinct frames when an export contains multiple records for one frame', () => {
    const report = parseLevelExportFiles({
      1: '[{"frame":0,"min_pq":1},{"frame":0,"max_pq":2},{"frame":1,"min_pq":3}]',
    }, 2);
    expect(report).toEqual({
      metadataLevels: [1],
      metadataLevelFrameCounts: { 1: 2 },
    });
  });

  it('rejects malformed or structurally invalid level exports', () => {
    expect(() => parseLevelExportFiles({ 1: '{bad json' }, 1)).toThrow(/不是有效 JSON/);
    expect(() => parseLevelExportFiles({ 2: '{}' }, 1)).toThrow(/必须是数组/);
    expect(() => parseLevelExportFiles({ 5: '[{"frame":-1}]' }, 1)).toThrow(/无效帧记录/);
  });

  it('rejects metadata records outside the complete RPU frame range', () => {
    expect(() => parseLevelExportFiles({
      1: '[{"frame":0},{"frame":2}]',
    }, 2)).toThrow(/超出完整 RPU 帧范围/);
  });
});
