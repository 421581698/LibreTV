import { createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { DolbyVisionRpuReportSchema, validateDolbyVisionRpuReport } from './rpu-evidence-contract';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);
const signedPayloadSchema = z.object({
  version: z.literal(1),
  keyId: z.string().min(1).max(128),
  assetId: z.string().min(1).max(512),
  issuedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
  report: DolbyVisionRpuReportSchema,
}).strict().superRefine((payload, context) => {
  if (payload.expiresAt <= payload.issuedAt) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: '过期时间必须晚于签发时间。' });
  }
  if (payload.report.inputKind !== 'hevc') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['report', 'inputKind'], message: '签名证据必须绑定原始 HEVC 媒体输入，不能使用脱离媒体的 RPU 文件。' });
  }
  if (payload.report.extractionScope === 'pre-extracted-rpu-file' ||
      payload.report.extractionScope.frameLimit !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['report', 'extractionScope'], message: '不能将局部帧扫描包装成完整媒体证据。' });
  }
}).readonly();

export const SignedDolbyVisionRpuEnvelopeSchema = signedPayloadSchema.extend({
  signature: z.string().min(80).max(256),
}).strict();

export type SignedDolbyVisionRpuEnvelope = z.infer<typeof SignedDolbyVisionRpuEnvelopeSchema>;

export interface VerifiedDolbyVisionRpuEnvelope {
  assetId: string;
  keyId: string;
  issuedAt: number;
  expiresAt: number;
  evidence: NonNullable<ReturnType<typeof validateDolbyVisionRpuReport>>['evidence'];
  report: z.infer<typeof DolbyVisionRpuReportSchema>;
  sourceHashBinding: 'matched';
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(',')}}`;
}

function decodePublicKey(publicKeyPem: string): KeyObject {
  return createPublicKey(publicKeyPem);
}

/**
 * Verify a parser-signed envelope against server-trusted asset identity and
 * digest values. Never pass client-supplied assetId/hash as the expected values.
 */
export function verifySignedDolbyVisionRpuEnvelope(
  value: unknown,
  options: {
    publicKeyPem: string;
    expectedKeyId: string;
    expectedAssetId: string;
    expectedMediaSha256: string;
    now?: number;
  },
): VerifiedDolbyVisionRpuEnvelope | null {
  const parsed = SignedDolbyVisionRpuEnvelopeSchema.safeParse(value);
  if (!parsed.success) return null;
  const envelope = parsed.data;
  const now = options.now ?? Math.floor(Date.now() / 1000);

  if (!options.publicKeyPem || !options.expectedKeyId || !options.expectedAssetId ||
      !sha256Schema.safeParse(options.expectedMediaSha256).success) return null;
  if (envelope.keyId !== options.expectedKeyId || envelope.assetId !== options.expectedAssetId) return null;
  if (envelope.issuedAt > now + 60 || envelope.expiresAt <= now) return null;
  if (envelope.expiresAt - envelope.issuedAt > 24 * 60 * 60) return null;

  const validated = validateDolbyVisionRpuReport(envelope.report, options.expectedMediaSha256);
  if (!validated || validated.sourceHashBinding !== 'matched') return null;

  const { signature, ...signedPayload } = envelope;
  let validSignature = false;
  try {
    validSignature = verifySignature(
      null,
      Buffer.from(canonicalize(signedPayload), 'utf8'),
      decodePublicKey(options.publicKeyPem),
      Buffer.from(signature, 'base64url'),
    );
  } catch {
    return null;
  }
  if (!validSignature) return null;

  return {
    assetId: envelope.assetId,
    keyId: envelope.keyId,
    issuedAt: envelope.issuedAt,
    expiresAt: envelope.expiresAt,
    report: validated.report,
    evidence: validated.evidence,
    sourceHashBinding: 'matched',
  };
}
