export type QualityPreference = 'auto' | '1080' | '4k';

export interface QualityLevelOption {
  index: number;
  height: number;
  bitrate?: number;
}

export type Advertised4kStatus = 'advertised' | 'not-advertised' | 'unknown';

/** Only playlist-declared rendition metadata can establish advertised 4K. */
export function getAdvertised4kStatus(
  heights: number[],
  levelCount: number,
  metadataComplete: boolean,
): Advertised4kStatus {
  if (heights.some((height) => height >= 2000 && height < 3000)) return 'advertised';
  if (levelCount > 0 && metadataComplete) return 'not-advertised';
  return 'unknown';
}

export interface QualitySelection {
  heights: number[];
  selectedIndex?: number;
  selectedHeight?: number;
  shouldPause: boolean;
  notice?: string;
}

/**
 * Resolve a manual rendition without silently selecting a lower tier.
 * 1080P is a strict ceiling; 4K mode selects the best available <=2160p
 * and reports when the source does not advertise a 4K rendition.
 */
export function resolveQualitySelection(
  input: QualityLevelOption[],
  preference: QualityPreference,
): QualitySelection {
  const levels = input
    .filter((level) => Number.isInteger(level.index) && Number.isFinite(level.height) && level.height > 0)
    .sort((a, b) => a.index - b.index);
  const heights = [...new Set(levels.map((level) => level.height))].sort((a, b) => b - a);

  if (preference === 'auto') return { heights, shouldPause: false };
  if (levels.length === 0) {
    return {
      heights,
      shouldPause: preference === '1080',
      notice: preference === '1080'
        ? '源站没有可验证的清晰度档位，已暂停以避免超过 1080P 上限。'
        : '源站档位信息无法读取，暂时无法确认 4K；继续由播放器自适应选择。',
    };
  }

  const hasUnknownHeight = input.some((level) => !Number.isFinite(level.height) || level.height <= 0);
  const hasKnown4k = heights.some((height) => height >= 2000 && height < 3000);
  if (preference === '4k' && hasUnknownHeight && !hasKnown4k) {
    return {
      heights,
      shouldPause: false,
      notice: '部分 HLS 档位缺少分辨率信息，无法确认源站是否提供 4K；继续由播放器自适应选择。',
    };
  }

  const target = preference === '1080' ? 1080 : 2160;
  const eligible = levels.filter((level) => level.height <= target);
  if (eligible.length === 0) {
    return {
      heights,
      shouldPause: true,
      notice: preference === '1080'
        ? '源站没有 1080P 或更低的档位，已暂停播放；请选择 4K 优先或自动。'
        : '源站没有 2160P 或更低的档位，无法应用 4K 优先设置。',
    };
  }

  const selected = eligible.reduce((best, level) =>
    level.height > best.height || (
      level.height === best.height && (level.bitrate ?? 0) > (best.bitrate ?? 0)
    ) ? level : best
  );
  const has4k = heights.some((height) => height >= 2000 && height < 3000);
  return {
    heights,
    selectedIndex: selected.index,
    selectedHeight: selected.height,
    shouldPause: false,
    notice: preference === '4k' && !has4k
      ? `源站未提供 4K，当前锁定最高可用档位 ${selected.height}P。`
      : undefined,
  };
}
