import { digestRpuFrameMapping } from './frame-mapping-evidence';
import { createHash, createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { DolbyVisionRpuReportSchema, validateDolbyVisionRpuReport } from './rpu-evidence-contract';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);
const signedPayloadShape = {
  version: z.literal(1),
  keyId: z.string().min(1).max(128),
  assetId: z.string().min(1).max(512),
  issuedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
  report: DolbyVisionRpuReportSchema,
  analysisContext: z.union([
    z.object({
      scope: z.literal('hls-fmp4'),
      resourceId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
      graphId: z.string().min(1).max(200),
      graphSha256: sha256Schema,
      rootAssetId: z.string().regex(/^[A-Za-z0-9:_-]{1,200}$/),
      variantAssetId: z.string().regex(/^[A-Za-z0-9:_-]{1,200}$/),
      fragmentCount: z.number().int().positive().max(10000),
      fragmentSequenceContinuity: z.literal('sequential'),
      temporalContinuity: z.literal('contiguous'),
    }).strict(),
    z.object({
      scope: z.literal('hls-fmp4-segment'),
      resourceId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
      graphId: z.string().min(1).max(200),
      graphSha256: sha256Schema,
      rootAssetId: z.string().regex(/^[A-Za-z0-9:_-]{1,200}$/),
      variantAssetId: z.string().regex(/^[A-Za-z0-9:_-]{1,200}$/),
      fragmentCount: z.number().int().positive().max(10000),
      fragmentSequenceContinuity: z.literal('sequential'),
      temporalContinuity: z.literal('contiguous'),
      fragmentOrdinal: z.number().int().nonnegative().max(9999),
      fragmentAssetId: z.string().regex(/^[A-Za-z0-9:_-]{1,200}$/),
      fragmentSha256: sha256Schema,
      initializationAssetId: z.string().regex(/^[A-Za-z0-9:_-]{1,200}$/),
      initializationSha256: sha256Schema,
      assembledSegmentSha256: sha256Schema,
      fragmentSequenceNumber: z.number().int().positive(),
      decodeTime: z.number().int().nonnegative(),
      sampleDuration: z.number().int().positive(),
      sampleCount: z.number().int().positive(),
      timescale: z.number().int().positive(),
    }).strict(),
  ]).optional(),
};

function addPayloadIssues(payload: z.infer<z.ZodObject<typeof signedPayloadShape>>, context: z.RefinementCtx) {
  if (payload.expiresAt <= payload.issuedAt) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: '过期时间必须晚于签发时间。' });
  }
  if (!['hevc', 'av1'].includes(payload.report.inputKind)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['report', 'inputKind'], message: '签名证据必须绑定原始 HEVC/AV1 媒体输入，不能使用脱离媒体的 RPU 文件。' });
  }
  if (typeof payload.report.extractionScope !== 'object' ||
      payload.report.extractionScope.frameLimit !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['report', 'extractionScope'], message: '不能将局部帧扫描包装成完整媒体证据。' });
  }
}

export const SignedDolbyVisionRpuEnvelopeSchema = z.object({
  ...signedPayloadShape,
  signature: z.string().min(80).max(256),
}).strict().superRefine((envelope, context) => addPayloadIssues(envelope, context));

export type SignedDolbyVisionRpuEnvelope = z.infer<typeof SignedDolbyVisionRpuEnvelopeSchema>;

export interface VerifiedDolbyVisionRpuEnvelope {
  assetId: string;
  keyId: string;
  issuedAt: number;
  expiresAt: number;
  evidence: NonNullable<ReturnType<typeof validateDolbyVisionRpuReport>>['evidence'];
  report: z.infer<typeof DolbyVisionRpuReportSchema>;
  analysisContext?: z.infer<typeof signedPayloadShape.analysisContext>;
  sourceHashBinding: 'matched';
}

export interface ExpectedHlsRpuFragment {
  fragmentAssetId: string;
  fragmentSha256: string;
  initializationAssetId: string;
  initializationSha256: string;
  assembledSegmentSha256: string;
  fragmentSequenceNumber: number;
  decodeTime: number;
  sampleDuration: number;
  sampleCount: number;
  timescale: number;
}

export interface VerifiedHlsRpuSegmentSet {
  segments: VerifiedDolbyVisionRpuEnvelope[];
  totalRpuFrameCount: number;
  timelineContinuity: 'contiguous';
  rpuProfileContinuity: 'consistent';
  /** Signed aggregate frame count equals registered video sample count; this does NOT prove a per-sample RPU mapping. */
  rpuFrameAlignment: 'frame-count-matches-video-samples';
  rpuSemanticContinuity: 'not-established';
  /** End-to-end RPU order/semantics cannot be proved from aggregate signed summaries. */
  semanticEvidenceLimitation: 'per-frame-rpu-boundaries-not-signed' | 'signed-rpu-unit-order-does-not-prove-video-frame-mapping';
  rpuUnitBoundaryEvidence: 'signed-ordered-per-unit-sha256' | 'not-established';
  orderedRpuUnitSha256: string | null;
  /** Graph-bound commitment to all signed local mappings, not global PTS continuity. */
  orderedFrameMappingSha256: string | null;
  /** Maximum verified end time in the media track's timescale units. */
  verifiedDecodeEnd: number;
  verifiedTimescale: number;
  /** Parser version is identical across every verified segment. */
  verifiedParserVersion: string;
  /** Summed signed per-level metadata coverage (not a per-sample mapping). */
  verifiedMetadataLevelFrameCounts: Record<string, number>;
  /** SHA-256 of graph-bound, ordered signed fragment summaries; not a decoder/output attestation. */
  orderedRpuEvidenceSha256: string;
}

/**
 * Verify every fragment signature against trusted graph metadata and prove
 * container-timeline continuity. This deliberately does not claim semantic
 * frame-to-frame RPU continuity, which requires parser-level per-frame data.
 */
export function verifySignedDolbyVisionRpuSegmentSet(
  values: unknown[],
  options: {
    publicKeyPem: string;
    expectedKeyId: string;
    resourceId: string;
    graphId: string;
    graphSha256: string;
    rootAssetId: string;
    variantAssetId: string;
    expectedFragmentCount: number;
    expectedSegments: ExpectedHlsRpuFragment[];
    now?: number;
  },
): VerifiedHlsRpuSegmentSet | null {
  if (!Array.isArray(values) || !Number.isSafeInteger(options.expectedFragmentCount) ||
      options.expectedFragmentCount < 1 || options.expectedFragmentCount > 10_000 ||
      values.length !== options.expectedFragmentCount ||
      options.expectedSegments.length !== options.expectedFragmentCount ||
      !sha256Schema.safeParse(options.graphSha256).success) return null;

  const verified: VerifiedDolbyVisionRpuEnvelope[] = [];
  const seenAssetIds = new Set<string>();
  let previousEnd: number | null = null;
  let previousSequence: number | null = null;
  let commonTimescale: number | null = null;
  let commonProfiles: number[] | null = null;
  let totalRpuFrameCount = 0;
  let commonParserVersion: string | null = null;
  let commonInputKind: string | null = null;
  const metadataLevelCounts: Record<string, number> = Object.create(null);
  let allSegmentsHaveUnitEvidence = true;
  let allSegmentsHaveFrameMapping = true;
  const orderedMappingHash = createHash('sha256').update(`hls-frame-mappings-v1\n${options.graphSha256.toLowerCase()}\n`);
  const orderedUnitHash = createHash('sha256').update(`hls-graph-rpu-units-v1\n${options.graphSha256.toLowerCase()}\n`);
  const orderedEvidence: Array<{
    ordinal: number;
    fragmentAssetId: string;
    fragmentSha256: string;
    rpuSha256: string;
    frameCount: number;
    parserVersion: string;
  }> = [];

  for (let ordinal = 0; ordinal < options.expectedFragmentCount; ordinal += 1) {
    const expected = options.expectedSegments[ordinal];
    if (!expected || seenAssetIds.has(expected.fragmentAssetId) ||
        !sha256Schema.safeParse(expected.fragmentSha256).success ||
        !sha256Schema.safeParse(expected.initializationSha256).success ||
        !sha256Schema.safeParse(expected.assembledSegmentSha256).success ||
        !Number.isSafeInteger(expected.fragmentSequenceNumber) || expected.fragmentSequenceNumber <= 0 ||
        !Number.isSafeInteger(expected.decodeTime) || expected.decodeTime < 0 ||
        !Number.isSafeInteger(expected.sampleDuration) || expected.sampleDuration <= 0 ||
        !Number.isSafeInteger(expected.sampleCount) || expected.sampleCount <= 0 ||
        !Number.isSafeInteger(expected.timescale) || expected.timescale <= 0) return null;
    // The registered clear VOD assembly contract permits exactly one init asset.
    const first = options.expectedSegments[0];
    if (expected.initializationAssetId !== first.initializationAssetId ||
        expected.initializationSha256.toLowerCase() !== first.initializationSha256.toLowerCase()) return null;
    seenAssetIds.add(expected.fragmentAssetId);

    if (previousEnd !== null && expected.decodeTime !== previousEnd) return null;
    if (previousSequence !== null && expected.fragmentSequenceNumber !== previousSequence + 1) return null;
    if (commonTimescale !== null && expected.timescale !== commonTimescale) return null;
    const end = expected.decodeTime + expected.sampleDuration;
    if (!Number.isSafeInteger(end)) return null;
    previousEnd = end;
    previousSequence = expected.fragmentSequenceNumber;
    commonTimescale = expected.timescale;

    const analysisContext = {
      scope: 'hls-fmp4-segment' as const,
      resourceId: options.resourceId,
      graphId: options.graphId,
      graphSha256: options.graphSha256,
      rootAssetId: options.rootAssetId,
      variantAssetId: options.variantAssetId,
      fragmentCount: options.expectedFragmentCount,
      fragmentSequenceContinuity: 'sequential' as const,
      temporalContinuity: 'contiguous' as const,
      fragmentOrdinal: ordinal,
      ...expected,
    };
    const result = verifySignedDolbyVisionRpuEnvelope(values[ordinal], {
      publicKeyPem: options.publicKeyPem,
      expectedKeyId: options.expectedKeyId,
      expectedAssetId: expected.fragmentAssetId,
      expectedMediaSha256: expected.assembledSegmentSha256,
      expectedAnalysisContext: analysisContext,
      now: options.now,
    });
    if (!result || result.report.frameCount !== expected.sampleCount) return null;
    const mapping = result.report.frameMappingEvidence;
    if (mapping) {
      orderedMappingHash.update(canonicalizeDolbyVisionRpuPayload({ ordinal, fragmentAssetId: expected.fragmentAssetId, mappingSha256: mapping.mappingSha256 })).update('\n');
    } else allSegmentsHaveFrameMapping = false;
    const unitEvidence = result.report.rpuUnitEvidence;
    if (unitEvidence) {
      for (const unitHash of unitEvidence.unitSha256s) orderedUnitHash.update(unitHash).update('\n');
    } else allSegmentsHaveUnitEvidence = false;
    if (commonInputKind === null) commonInputKind = result.report.inputKind;
    else if (result.report.inputKind !== commonInputKind) return null;
    if (commonParserVersion === null) commonParserVersion = result.report.parserVersion;
    else if (result.report.parserVersion !== commonParserVersion) return null;
    for (const [level, count] of Object.entries(result.report.metadataLevelFrameCounts)) {
      const accumulated = (metadataLevelCounts[level] ?? 0) + count;
      if (!Number.isSafeInteger(accumulated)) return null;
      metadataLevelCounts[level] = accumulated;
    }
    orderedEvidence.push({
      ordinal,
      fragmentAssetId: expected.fragmentAssetId,
      fragmentSha256: expected.fragmentSha256.toLowerCase(),
      rpuSha256: result.report.rpuSha256.toLowerCase(),
      frameCount: result.report.frameCount,
      parserVersion: result.report.parserVersion,
    });
    const profiles = result.report.profiles;
    if (commonProfiles === null) commonProfiles = profiles;
    else if (profiles.length !== commonProfiles.length ||
        profiles.some((profile, index) => profile !== commonProfiles?.[index])) return null;
    totalRpuFrameCount += result.report.frameCount;
    if (!Number.isSafeInteger(totalRpuFrameCount)) return null;
    verified.push(result);
  }

  return {
    segments: verified,
    totalRpuFrameCount,
    timelineContinuity: 'contiguous',
    rpuProfileContinuity: 'consistent',
    rpuFrameAlignment: 'frame-count-matches-video-samples',
    rpuSemanticContinuity: 'not-established',
    semanticEvidenceLimitation: allSegmentsHaveUnitEvidence
      ? 'signed-rpu-unit-order-does-not-prove-video-frame-mapping'
      : 'per-frame-rpu-boundaries-not-signed',
    rpuUnitBoundaryEvidence: allSegmentsHaveUnitEvidence ? 'signed-ordered-per-unit-sha256' : 'not-established',
    orderedRpuUnitSha256: allSegmentsHaveUnitEvidence ? orderedUnitHash.digest('hex') : null,
    orderedFrameMappingSha256: allSegmentsHaveFrameMapping ? orderedMappingHash.digest('hex') : null,
    verifiedDecodeEnd: previousEnd!,
    verifiedTimescale: commonTimescale!,
    verifiedParserVersion: commonParserVersion!,
    verifiedMetadataLevelFrameCounts: Object.fromEntries(Object.entries(metadataLevelCounts).sort(([a], [b]) => Number(a) - Number(b))),
    orderedRpuEvidenceSha256: createHash('sha256').update(canonicalizeDolbyVisionRpuPayload({
      scope: 'hls-ordered-rpu-evidence-v1',
      graphSha256: options.graphSha256.toLowerCase(),
      resourceId: options.resourceId,
      variantAssetId: options.variantAssetId,
      orderedEvidence,
    })).digest('hex'),
  };
}

export function canonicalizeDolbyVisionRpuPayload(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError('Signed payload contains a non-JSON value.');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalizeDolbyVisionRpuPayload).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalizeDolbyVisionRpuPayload(entry)}`).join(',')}}`;
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
    expectedAnalysisContext?: z.infer<typeof signedPayloadShape.analysisContext> | null;
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
  if (options.expectedAnalysisContext === undefined || options.expectedAnalysisContext === null) {
    if (envelope.analysisContext !== undefined) return null;
  } else if (!envelope.analysisContext ||
      canonicalizeDolbyVisionRpuPayload(envelope.analysisContext) !==
      canonicalizeDolbyVisionRpuPayload(options.expectedAnalysisContext)) {
    return null;
  }
  if (envelope.issuedAt > now + 60 || envelope.expiresAt <= now) return null;
  if (envelope.expiresAt - envelope.issuedAt > 24 * 60 * 60) return null;

  const validated = validateDolbyVisionRpuReport(envelope.report, options.expectedMediaSha256);
  if (!validated || validated.sourceHashBinding !== 'matched') return null;
  const unitEvidence = validated.report.rpuUnitEvidence;
  const mapping = validated.report.frameMappingEvidence;
  if (mapping) {
    try {
      if (!unitEvidence || !validated.report.sourceMediaSha256 ||
          digestRpuFrameMapping(validated.report.sourceMediaSha256.toLowerCase(), mapping.timeBase, mapping.frames) !== mapping.mappingSha256) return null;
      // Presentation order can differ from extraction order. Compare multisets,
      // preserving multiplicity rather than treating repeated RPU hashes as unique.
      const mapped = mapping.frames.map(frame => frame.rpuSha256).sort();
      const extracted = unitEvidence.unitSha256s.map(hash => hash.toLowerCase()).sort();
      if (mapped.length !== extracted.length || mapped.some((hash, i) => hash !== extracted[i])) return null;
    } catch { return null; }
  }
  if (unitEvidence && createHash('sha256').update(unitEvidence.unitSha256s.join('\n')).digest('hex') !==
      unitEvidence.orderedSha256.toLowerCase()) return null;

  const { signature, ...signedPayload } = envelope;
  let validSignature = false;
  try {
    validSignature = verifySignature(
      null,
      Buffer.from(canonicalizeDolbyVisionRpuPayload(signedPayload), 'utf8'),
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
    ...(envelope.analysisContext ? { analysisContext: envelope.analysisContext } : {}),
    evidence: validated.evidence,
    sourceHashBinding: 'matched',
  };
}
