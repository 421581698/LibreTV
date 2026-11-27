import { describe, expect, it } from 'vitest';
import { normalizeRpuInput, parseDoviToolInfoSummary, parseLevelExportFiles, deriveOrderedRpuUnitEvidence, parseCompleteRpuL1Brightness } from './analyze-rpu.mjs';

describe('dovi_tool RPU report parsing', () => {
  it('commits to ordered, bounded per-RPU NAL boundaries, not video frames', () => {
    const prefix = Buffer.from([0, 0, 0, 1]);
    const first = Buffer.from([0x19, 1, 2, 3, 4, 5, 0x80]);
    const second = Buffer.from([0x19, 6, 7, 8, 9, 10, 0x80]);
    const bytes = Buffer.concat([prefix, first, prefix, second]);
    const result = deriveOrderedRpuUnitEvidence(bytes, 2);
    expect(result?.version).toBe(1);
    expect(result?.unitSha256s).toHaveLength(2);
    expect(result?.unitSha256s[0]).not.toBe(result?.unitSha256s[1]);
    expect(deriveOrderedRpuUnitEvidence(bytes, 1)).toBeNull();
    expect(deriveOrderedRpuUnitEvidence(Buffer.concat([bytes, prefix]), 3)).toBeNull();
    expect(deriveOrderedRpuUnitEvidence(bytes, 8193)).toBeNull();
    const reversed = deriveOrderedRpuUnitEvidence(Buffer.concat([prefix, second, prefix, first]), 2);
    expect(reversed?.orderedSha256).not.toBe(result?.orderedSha256);
  });

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
  it('preserves escaped UNSPEC62 NAL bytes for dovi_tool to parse', () => {
    const regular = Buffer.from([0x19, 0x00, 0x00, 0x01, 0x80, 0x55, 0x66, 0x80]);
    const escaped = Buffer.from([0x19, 0x00, 0x00, 0x03, 0x01, 0x80, 0x55, 0x66, 0x80]);
    const nalu = Buffer.concat([Buffer.from([0x7c, 0x01]), escaped]);
    const annexB = Buffer.concat([Buffer.from([0, 0, 0, 1]), nalu]);
    const parserInput = Buffer.concat([Buffer.from([0, 0, 0, 1]), escaped]);
    expect(normalizeRpuInput(annexB)).toEqual(parserInput);
    expect(normalizeRpuInput(regular)).toEqual(parserInput);
  });

  it('escapes Annex-B-looking byte sequences inside a raw regular RPU', () => {
    const regular = Buffer.from([0x19, 0x00, 0x00, 0x00, 0x01, 0x22, 0x80]);
    expect(normalizeRpuInput(regular)).toEqual(Buffer.from([
      0x00, 0x00, 0x00, 0x01, 0x19, 0x00, 0x00, 0x03, 0x00, 0x01, 0x22, 0x80,
    ]));
  });

  it('normalizes multiple UNSPEC62 NAL units without losing regular RPU boundaries', () => {
    const first = Buffer.from([0x7c, 0x01, 0x19, 0x11, 0x22, 0x33, 0x44, 0x55, 0x80]);
    const second = Buffer.from([0x7c, 0x01, 0x19, 0x22, 0x33, 0x44, 0x55, 0x66, 0x80]);
    const annexB = Buffer.concat([
      Buffer.from([0, 0, 0, 1]), first,
      Buffer.from([0, 0, 0, 1]), second,
    ]);
    expect(normalizeRpuInput(annexB)).toEqual(Buffer.concat([
      Buffer.from([0, 0, 0, 1, 0x19, 0x11, 0x22, 0x33, 0x44, 0x55, 0x80]),
      Buffer.from([0, 0, 0, 1, 0x19, 0x22, 0x33, 0x44, 0x55, 0x66, 0x80]),
    ]));
  });

  it('preserves already-normalized Annex-B regular RPU chunks', () => {
    const regular = Buffer.from([0x19, 0x11, 0x22, 0x33, 0x44, 0x55, 0x80]);
    const annexB = Buffer.concat([Buffer.from([0, 0, 0, 1]), regular]);
    expect(normalizeRpuInput(annexB)).toEqual(annexB);
  });

  it('rejects malformed NAL headers, malformed RPU payloads and invalid emulation-prevention bytes', () => {
    expect(() => normalizeRpuInput(Buffer.from([0, 0, 0, 1, 0x40, 0x01, 0x19, 0x80]))).toThrow(/UNSPEC62/);
    expect(() => normalizeRpuInput(Buffer.from([0, 0, 0, 1, 0x7c, 0x01, 0x19, 0, 0, 3, 4, 0x80]))).toThrow(/emulation-prevention/);
    expect(() => normalizeRpuInput(Buffer.from([0x19, 0x00, 0x00, 0x01]))).toThrow(/valid regular RPU/);
  });

});

describe('RPU L1 real export: require every frame', () => {
  it('binds actual PQ statistics to each ordinal and fails closed on sparse or corrupt metadata', () => {
    const data=JSON.stringify([
      {frame:0,min_pq:0,avg_pq:1600,max_pq:2800},
      {frame:1,min_pq:2,avg_pq:2000,max_pq:3400},
    ]);
    expect(parseCompleteRpuL1Brightness(data,2)?.frames[1])
      .toMatchObject({frameOrdinal:1,avgPq:2000,maxPq:3400});
    expect(parseCompleteRpuL1Brightness(data,3)).toBeNull();
    expect(parseCompleteRpuL1Brightness('[{"frame":0,"min_pq":0,"avg_pq":100,"max_pq":4096}]',1)).toBeNull();
    expect(parseCompleteRpuL1Brightness('[{"frame":0,"min_pq":0,"max_pq":100}]',1)).toBeNull();
    expect(parseCompleteRpuL1Brightness('[{"frame":0,"min_pq":100,"avg_pq":50,"max_pq":200}]',1)).toBeNull();
    expect(parseCompleteRpuL1Brightness(JSON.stringify([
      {frame:0,min_pq:0,avg_pq:20,max_pq:100},
      {frame:0,min_pq:0,avg_pq:20,max_pq:100},
    ]),2)).toBeNull();
  });
});
