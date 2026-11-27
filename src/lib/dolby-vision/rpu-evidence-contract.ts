import { z } from 'zod';
import type { DolbyVisionRpuEvidence } from './metadata-inspector';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);
const extractionScopeSchema = z.union([
  z.object({
    track: z.number().int().positive().nullable(),
    frameLimit: z.number().int().positive().nullable(),
  }).strict(),
  z.literal('pre-extracted-rpu-file'),
]);

/**
 * Strict contract for reports emitted by scripts/dolby-vision/analyze-rpu.mjs.
 * Parsing validates structure only; sourceHashBinding separately determines
 * whether the report belongs to the exact media asset currently being inspected.
 */
export const DolbyVisionRpuReportSchema = z.object({
  source: z.literal('dovi_tool'),
  parserVersion: z.string().regex(/^2\.3\.\d+$/),
  verified: z.literal(true),
  rpuPresent: z.literal(true),
  profile: z.number().int().min(0).max(20).nullable(),
  profiles: z.array(z.number().int().min(0).max(20)).min(1),
  frameCount: z.number().int().positive(),
  metadataLevels: z.array(z.number().int().min(1).max(11)),
  metadataLevelFrameCounts: z.record(z.string().regex(/^(?:[1-9]|1[01])$/), z.number().int().positive()),
  input: z.string().min(1),
  inputSha256: sha256Schema,
  sourceMediaSha256: sha256Schema.nullable(),
  rpuSha256: sha256Schema,
  av1PresentationAlignment: z.object({
    scope: z.literal('ffprobe-decoded-frame-pts'),
    matched: z.literal(true),
    frameCount: z.number().int().positive(),
  }).strict().optional(),
  presentationDurationEvidence: z.object({
    scope: z.literal('independent-sample-durations'),
    timescale: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    start: z.string().regex(/^(?:0|-?[1-9][0-9]{0,18})$/),
    end: z.string().regex(/^(?:0|-?[1-9][0-9]{0,18})$/),
    durations: z.array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)).min(1).max(8192),
  }).strict().optional(),
  frameMappingEvidence: z.object({
    version: z.literal(1),
    timeBase: z.object({ numerator: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), denominator: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict(),
    frames: z.array(z.object({
      frameOrdinal: z.number().int().nonnegative(),
      pts: z.string().regex(/^(?:0|-?[1-9][0-9]{0,18})$/),
      rpuSha256: z.string().regex(/^[a-f0-9]{64}$/),
    }).strict()).min(1).max(8192),
    mappingSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict().optional(),
  // Raw parser statistics are not presentation-bound rendering evidence.
  rpuL1FrameStats: z.object({
    version: z.literal(1),
    frames: z.array(z.object({
      frameOrdinal: z.number().int().nonnegative(),
      minPq: z.number().int().min(0).max(4095),
      avgPq: z.number().int().min(0).max(4095),
      maxPq: z.number().int().min(1).max(4095),
    }).strict()).min(1).max(8192),
  }).strict().optional(),
  rpuL1Evidence: z.object({
    version: z.literal(1),
    frames: z.array(z.object({
      frameOrdinal: z.number().int().nonnegative(),
      pts: z.string().regex(/^(?:0|-?[1-9][0-9]{0,18})$/),
      rpuSha256: sha256Schema,
      minPq: z.number().int().min(0).max(4095),
      avgPq: z.number().int().min(0).max(4095),
      maxPq: z.number().int().min(1).max(4095),
    }).strict()).min(1).max(8192),
  }).strict().optional(),
  rpuUnitEvidence: z.object({
    version: z.literal(1),
    unitSha256s: z.array(sha256Schema).min(1).max(8192),
    orderedSha256: sha256Schema,
  }).strict().optional(),
  inputKind: z.enum(['hevc', 'av1', 'rpu']),
  extractionScope: extractionScopeSchema,
  notes: z.array(z.string()),
}).strict().superRefine((report, context) => {
  if (report.rpuL1FrameStats && (!report.rpuUnitEvidence ||
      report.metadataLevelFrameCounts['1'] !== report.frameCount ||
      report.rpuL1FrameStats.frames.length !== report.frameCount ||
      report.rpuL1FrameStats.frames.some((frame,i) => frame.frameOrdinal !== i ||
        frame.minPq > frame.avgPq || frame.avgPq > frame.maxPq))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['rpuL1FrameStats'],
      message: 'Raw L1 statistics require complete ordered RPU units and valid PQ values.' });
  }
  if (report.rpuL1Evidence) {
    const l1=report.rpuL1Evidence.frames;
    const mapped=report.frameMappingEvidence?.frames;
    if (report.inputKind !== 'hevc' || report.profile !== 8 || !mapped ||
        l1.length !== report.frameCount || l1.some((frame,i)=>
          frame.frameOrdinal !== i || frame.pts !== mapped[i]?.pts ||
          frame.rpuSha256 !== mapped[i]?.rpuSha256 ||
          frame.minPq > frame.avgPq || frame.avgPq > frame.maxPq)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['rpuL1Evidence'],
        message: 'L1 参数只能绑定已逐帧验真的单层 Profile 8 HEVC 媒体。' });
    }
  }
  if (report.presentationDurationEvidence && (!report.frameMappingEvidence ||
      report.presentationDurationEvidence.durations.length !== report.frameCount)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['presentationDurationEvidence'], message: 'Duration evidence requires complete media-bound frame mapping.' });
  }
  if (report.frameMappingEvidence && (report.inputKind === 'rpu' ||
      report.frameMappingEvidence.frames.length !== report.frameCount ||
      !report.rpuUnitEvidence)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['frameMappingEvidence'], message: '逐帧映射必须绑定原始媒体和完整 RPU 单元证据。' });
  }
  if (report.av1PresentationAlignment &&
      (report.inputKind !== 'av1' || report.av1PresentationAlignment.frameCount !== report.frameCount)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['av1PresentationAlignment'], message: '解码帧 PTS 匹配证据必须对应 AV1 帧数。' });
  }
  if (report.rpuUnitEvidence && report.rpuUnitEvidence.unitSha256s.length !== report.frameCount) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['rpuUnitEvidence'], message: '逐单元 RPU 摘要数必须等于 dovi_tool 帧数。' });
  }
  const profiles = [...new Set(report.profiles)].sort((a, b) => a - b);
  if (profiles.length !== report.profiles.length || profiles.some((value, index) => value !== report.profiles[index])) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['profiles'], message: 'profiles 必须去重并升序排列。' });
  }
  if ((profiles.length === 1 ? profiles[0] : null) !== report.profile) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['profile'], message: 'profile 必须与单一 profiles 值一致；多 Profile 时必须为 null。' });
  }
  const levels = [...new Set(report.metadataLevels)].sort((a, b) => a - b);
  if (levels.length !== report.metadataLevels.length || levels.some((value, index) => value !== report.metadataLevels[index])) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['metadataLevels'], message: 'metadataLevels 必须去重并升序排列。' });
  }
  const countLevels = Object.keys(report.metadataLevelFrameCounts).map(Number).sort((a, b) => a - b);
  if (countLevels.length !== levels.length || countLevels.some((value, index) => value !== levels[index])) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['metadataLevelFrameCounts'], message: '层级帧计数必须与 metadataLevels 完全对应。' });
  }
  if (Object.values(report.metadataLevelFrameCounts).some((count) => count > report.frameCount)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['metadataLevelFrameCounts'], message: '单个元数据层级的帧计数不能超过 RPU 总帧数。' });
  }
  if (['hevc', 'av1'].includes(report.inputKind) && typeof report.extractionScope !== 'object') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['extractionScope'], message: 'HEVC/AV1 报告必须包含轨道/帧范围。' });
  }
  if (['hevc', 'av1'].includes(report.inputKind) && report.sourceMediaSha256 === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceMediaSha256'], message: 'HEVC/AV1 报告必须绑定原始媒体 SHA-256。' });
  }
  if (report.inputKind === 'rpu' && report.sourceMediaSha256 !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceMediaSha256'], message: '独立 RPU 文件不能声明原始媒体绑定。' });
  }
  if (report.inputKind === 'rpu' && report.extractionScope !== 'pre-extracted-rpu-file') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['extractionScope'], message: 'RPU 输入必须标记为预提取 RPU 文件。' });
  }
});

export type DolbyVisionRpuReport = z.infer<typeof DolbyVisionRpuReportSchema>;
export type RpuSourceHashBinding = 'matched' | 'detached' | 'mismatch';

export function validateDolbyVisionRpuReport(
  value: unknown,
  expectedMediaSha256?: string | null,
): {
  report: DolbyVisionRpuReport;
  evidence: DolbyVisionRpuEvidence;
  sourceHashBinding: RpuSourceHashBinding;
} | null {
  const parsed = DolbyVisionRpuReportSchema.safeParse(value);
  if (!parsed.success) return null;

  const report = parsed.data;
  const sourceHashBinding: RpuSourceHashBinding = report.inputKind === 'rpu'
    ? 'detached'
    : expectedMediaSha256
      ? (report.sourceMediaSha256?.toLowerCase() === expectedMediaSha256.toLowerCase() ? 'matched' : 'mismatch')
      : 'detached';

  if (sourceHashBinding === 'mismatch') return null;

  return {
    report,
    sourceHashBinding,
    evidence: {
      source: 'dovi_tool',
      parserVersion: report.parserVersion,
      verified: true,
      rpuPresent: true,
      profile: report.profile,
      frameCount: report.frameCount,
      metadataLevels: report.metadataLevels,
    },
  };
}
