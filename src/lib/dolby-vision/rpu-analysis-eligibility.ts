import type { DolbyVisionFormatReport } from './format-inspector';

/**
 * The signed parser accepts registered MP4 assets containing exactly one
 * supported HEVC or AV1 video track. AV1 is demuxed to OBU and parsed through
 * the bounded Dolby T.35/EMDF adapter before the source-bound report is signed.
 */
export function canAnalyzeDolbyVisionRpuAsset(
  assetId: string | undefined,
  report: Pick<DolbyVisionFormatReport, 'container' | 'codecFamilies'> | null,
): boolean {
  return Boolean(
    assetId
    && report?.container === 'mp4'
    && report.codecFamilies.length === 1
    && ['hevc', 'av1'].includes(report.codecFamilies[0]),
  );
}
