export type QualityEvidence =
  | { kind: 'player-decoded'; decodedHeight: number; codec?: string; observedAt: number }
  | { kind: 'playlist-declared'; declaredHeight: number; bandwidth?: number; observedAt: number }
  | { kind: 'segment-probe'; segmentHeight?: number; bytes?: number; observedAt: number }
  | { kind: 'unknown'; reason: string };
export interface QualityAssessment { label: string; height: number | null; confidence: 'verified' | 'indicative' | 'unknown'; source: QualityEvidence['kind']; }
export function assessQuality(evidence: QualityEvidence): QualityAssessment {
  if (evidence.kind === 'player-decoded' && Number.isFinite(evidence.decodedHeight) && evidence.decodedHeight > 0)
    return { label: `${evidence.decodedHeight}p 实际解码`, height: evidence.decodedHeight, confidence: 'verified', source: evidence.kind };
  if (evidence.kind === 'playlist-declared' && evidence.declaredHeight > 0)
    return { label: `${evidence.declaredHeight}p 清单声明`, height: evidence.declaredHeight, confidence: 'indicative', source: evidence.kind };
  if (evidence.kind === 'segment-probe' && evidence.segmentHeight && evidence.segmentHeight > 0)
    return { label: `${evidence.segmentHeight}p 分片探测`, height: evidence.segmentHeight, confidence: 'indicative', source: evidence.kind };
  return { label: '画质未知', height: null, confidence: 'unknown', source: evidence.kind };
}
