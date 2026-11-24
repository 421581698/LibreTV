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
  rpuSha256: sha256Schema,
  inputKind: z.enum(['hevc', 'rpu']),
  extractionScope: extractionScopeSchema,
  notes: z.array(z.string()),
}).strict().superRefine((report, context) => {
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
  if (report.inputKind === 'hevc' && typeof report.extractionScope !== 'object') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['extractionScope'], message: 'HEVC 报告必须包含轨道/帧范围。' });
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
      ? (expectedMediaSha256.toLowerCase() === report.inputSha256.toLowerCase() ? 'matched' : 'mismatch')
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
