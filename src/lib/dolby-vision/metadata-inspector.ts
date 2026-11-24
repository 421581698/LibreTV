import type { DolbyVisionFormatReport } from './format-inspector';

export type RpuEvidenceSource = 'dovi_tool' | 'libdovi' | 'external-parser';
export type RpuPresence = 'present' | 'absent' | 'unknown';
export type DynamicMetadataStatus = 'confirmed' | 'not-confirmed' | 'unknown';

export interface DolbyVisionRpuEvidence {
  /** Evidence must come from a parser that actually inspected elementary-stream/RPU bytes. */
  source: RpuEvidenceSource;
  parserVersion: string;
  verified: true;
  rpuPresent: boolean;
  profile: number | null;
  frameCount: number | null;
  metadataLevels: number[];
}

export interface DolbyVisionMetadataInput {
  format: DolbyVisionFormatReport;
  rpuEvidence?: DolbyVisionRpuEvidence | null;
}

export interface DolbyVisionMetadataReport {
  declarationDetected: boolean;
  rpuPresence: RpuPresence;
  dynamicMetadata: DynamicMetadataStatus;
  profile: number | null;
  frameCount: number | null;
  metadataLevels: number[];
  evidenceSource: RpuEvidenceSource | 'manifest-only' | 'none';
  consistentWithDeclaration: boolean | null;
  notes: string[];
}

function isValidEvidence(evidence: DolbyVisionRpuEvidence): boolean {
  return evidence.verified === true
    && typeof evidence.parserVersion === 'string'
    && evidence.parserVersion.trim().length > 0
    && Number.isInteger(evidence.frameCount)
    && evidence.frameCount! >= 0
    && (evidence.profile === null || (Number.isInteger(evidence.profile) && evidence.profile > 0))
    && Array.isArray(evidence.metadataLevels)
    && evidence.metadataLevels.every((level) => Number.isInteger(level) && level >= 0 && level <= 255);
}

/**
 * Produce an evidence-aware metadata report.
 *
 * A manifest codec declaration is not RPU evidence. This browser-side module
 * deliberately does not parse binary RPU payloads; dovi_tool/libdovi or another
 * reviewed parser must provide a validated summary for RPU confirmation.
 */
export function inspectDolbyVisionMetadata(input: DolbyVisionMetadataInput): DolbyVisionMetadataReport {
  const { format, rpuEvidence } = input;
  const notes: string[] = [];
  const declarationDetected = format.detected;

  if (!rpuEvidence) {
    notes.push(declarationDetected
      ? '仅发现播放列表/codec 声明；RPU 是否存在、是否有效以及动态元数据内容均未验证。'
      : '没有 Dolby Vision 声明或 RPU 解析证据；状态保持未知，不推断为不支持。');
    return {
      declarationDetected,
      rpuPresence: 'unknown',
      dynamicMetadata: 'unknown',
      profile: format.profiles.length === 1 ? format.profiles[0] : null,
      frameCount: null,
      metadataLevels: [],
      evidenceSource: declarationDetected ? 'manifest-only' : 'none',
      consistentWithDeclaration: null,
      notes,
    };
  }

  if (!isValidEvidence(rpuEvidence)) {
    notes.push('RPU 解析摘要字段无效或不完整；拒绝将其作为已验证证据。');
    return {
      declarationDetected,
      rpuPresence: 'unknown',
      dynamicMetadata: 'unknown',
      profile: null,
      frameCount: null,
      metadataLevels: [],
      evidenceSource: 'none',
      consistentWithDeclaration: null,
      notes,
    };
  }

  const rpuPresence: RpuPresence = rpuEvidence.rpuPresent ? 'present' : 'absent';
  const dynamicMetadata: DynamicMetadataStatus = rpuEvidence.rpuPresent
    ? (rpuEvidence.metadataLevels.length > 0 ? 'confirmed' : 'unknown')
    : 'not-confirmed';
  const consistentWithDeclaration = rpuEvidence.profile === null || format.profiles.length === 0
    ? null
    : format.profiles.includes(rpuEvidence.profile);

  if (rpuEvidence.rpuPresent && rpuEvidence.metadataLevels.length === 0) {
    notes.push('解析器报告存在 RPU，但没有提供可识别的元数据层级；动态元数据内容保持未知。');
  } else if (rpuEvidence.rpuPresent) {
    notes.push('RPU 及元数据层级由外部解析器报告；这仍不证明设备已解码或显示端已输出 Dolby Vision。');
  } else {
    notes.push('解析器未在所检查的码流范围内发现 RPU；不能据此推断其他未检查片段也不存在 RPU。');
  }
  if (consistentWithDeclaration === false) {
    notes.push('RPU Profile 与播放列表声明不一致；需要检查变体选择、封装或解析输入。');
  }

  return {
    declarationDetected,
    rpuPresence,
    dynamicMetadata,
    profile: rpuEvidence.profile,
    frameCount: rpuEvidence.frameCount,
    metadataLevels: [...new Set(rpuEvidence.metadataLevels)].sort((a, b) => a - b),
    evidenceSource: rpuEvidence.source,
    consistentWithDeclaration,
    notes,
  };
}
