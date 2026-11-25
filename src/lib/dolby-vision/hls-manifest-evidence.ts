import {
  inspectDolbyVisionFormat,
  type DolbyVisionCodecDeclaration,
} from './format-inspector';

export interface HlsDolbyVisionVariantEvidence {
  uri: string;
  bandwidth: number | null;
  codecs: string[];
  supplementalCodecs: string[];
  declarations: DolbyVisionCodecDeclaration[];
  declaredDolbyVision: boolean;
  profile: number | null;
  rpuPresence: 'unknown';
}

export interface HlsDolbyVisionManifestEvidence {
  validMasterPlaylist: boolean;
  variants: HlsDolbyVisionVariantEvidence[];
  declaredVariantCount: number;
  rpuPresence: 'unknown';
  notes: string[];
}

function parseAttributes(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern = /([A-Z0-9-]+)=("(?:[^"\\]|\\.)*"|[^,]*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    const raw = match[2].trim();
    result[match[1]] = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
  }
  return result;
}

/** Map each HLS master variant to its own codec declarations; never claim segment RPU analysis. */
export function inspectHlsDolbyVisionManifestEvidence(
  manifest: string,
): HlsDolbyVisionManifestEvidence {
  const lines = manifest.split(/\r?\n/).map((line) => line.trim());
  const variants: HlsDolbyVisionVariantEvidence[] = [];
  let pending: Record<string, string> | null = null;
  let validMasterPlaylist = lines[0] === '#EXTM3U';

  for (const line of lines) {
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      if (pending) {
        validMasterPlaylist = false;
        break;
      }
      pending = parseAttributes(line.slice(line.indexOf(':') + 1));
      continue;
    }
    if (pending && line && !line.startsWith('#')) {
      const codecs = (pending.CODECS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
      const supplementalCodecs = (pending['SUPPLEMENTAL-CODECS'] ?? '').split(',').map((value) => value.trim()).filter(Boolean);
      const report = inspectDolbyVisionFormat({
        url: line,
        mimeType: 'application/vnd.apple.mpegurl',
        codecs,
        supplementalCodecs,
      });
      const declarations = report.declarations;
      variants.push({
        uri: line,
        bandwidth: /^\d+$/.test(pending.BANDWIDTH ?? '') ? Number(pending.BANDWIDTH) : null,
        codecs,
        supplementalCodecs,
        declarations,
        declaredDolbyVision: declarations.length > 0,
        profile: declarations.length === 1 ? declarations[0].profile : null,
        rpuPresence: 'unknown',
      });
      pending = null;
    }
  }

  if (pending) validMasterPlaylist = false;
  return {
    validMasterPlaylist,
    variants,
    declaredVariantCount: variants.filter((variant) => variant.declaredDolbyVision).length,
    rpuPresence: 'unknown',
    notes: [
      '该报告将主清单中的 codec 声明逐变体关联，不代表已读取媒体分片。',
      '分片级 RPU、帧连续性和跨分片元数据仍需对已登记 HLS 资产图执行真实字节分析。',
    ],
  };
}
