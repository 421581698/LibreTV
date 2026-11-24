import { z } from 'zod';

const verifiedEvidenceSchema = z.object({
  source: z.literal('dovi_tool'),
  parserVersion: z.string().regex(/^2\\.3\\.\\d+$/),
  verified: z.literal(true),
  rpuPresent: z.literal(true),
  profile: z.number().int().min(0).max(20).nullable(),
  frameCount: z.number().int().positive(),
  metadataLevels: z.array(z.number().int().min(1).max(11)),
}).strict();

const verifiedResponseSchema = z.object({
  verified: z.literal(true),
  assetId: z.string().min(1).max(200),
  keyId: z.string().min(1).max(128),
  issuedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
  sourceHashBinding: z.literal('matched'),
  evidence: verifiedEvidenceSchema,
}).strict().superRefine((value, context) => {
  if (value.expiresAt <= value.issuedAt) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'Invalid signed evidence lifetime.' });
  }
});

export type VerifiedDolbyVisionEvidenceResponse = z.infer<typeof verifiedResponseSchema>;

/** Client-side display guard. Cryptographic verification remains server-only. */
export function parseVerifiedDolbyVisionEvidenceResponse(
  value: unknown,
  expectedAssetId: string,
): VerifiedDolbyVisionEvidenceResponse | null {
  if (!expectedAssetId || !/^[A-Za-z0-9:_-]{1,200}$/.test(expectedAssetId)) return null;
  const parsed = verifiedResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.assetId !== expectedAssetId) return null;
  return parsed.data;
}
