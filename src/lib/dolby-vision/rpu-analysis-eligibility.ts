import type { DolbyVisionFormatReport } from './format-inspector';

/**
 * The current signed RPU parser accepts only registered MP4 assets containing
 * a single HEVC video track. AV1 must use its own OBU/EMDF adapter.
 */
export function canAnalyzeDolbyVisionRpuAsset(
  assetId: string | undefined,
  report: Pick<DolbyVisionFormatReport, 'container' | 'codecFamilies'> | null,
): boolean {
  return Boolean(
    assetId
    && report?.container === 'mp4'
    && report.codecFamilies.length === 1
    && report.codecFamilies[0] === 'hevc',
  );
}
