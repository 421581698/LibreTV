export type PlaybackHealth = 'healthy' | 'low-buffer' | 'buffering' | 'stalled' | 'offline' | 'degraded' | 'unknown';

export interface PlaybackStabilityMetrics {
  nowMs: number;
  lastProgressAtMs: number | null;
  bufferedAheadSeconds: number | null;
  readyState: number;
  networkState: number;
  online: boolean;
  paused: boolean;
  ended: boolean;
  droppedFrames?: number | null;
  totalFrames?: number | null;
}

export interface PlaybackStabilityPolicy {
  lowBufferSeconds: number;
  stallAfterMs: number;
  droppedFrameRatio: number;
}

export interface PlaybackStabilityReport {
  health: PlaybackHealth;
  bufferedAheadSeconds: number | null;
  stallDurationMs: number;
  droppedFrameRatio: number | null;
  shouldShowBuffering: boolean;
  shouldOfferRetry: boolean;
  recommendations: string[];
}

const DEFAULT_POLICY: PlaybackStabilityPolicy = {
  lowBufferSeconds: 4,
  stallAfterMs: 8000,
  droppedFrameRatio: 0.12,
};

function frameDropRatio(dropped?: number | null, total?: number | null): number | null {
  if (!Number.isFinite(dropped) || !Number.isFinite(total) || !total || total <= 0 || dropped! < 0) return null;
  return Math.min(1, dropped! / total!);
}

/** Pure telemetry classifier. It does not mutate the player or trigger recovery. */
export function evaluatePlaybackHealth(
  metrics: PlaybackStabilityMetrics,
  policy: Partial<PlaybackStabilityPolicy> = {},
): PlaybackStabilityReport {
  const thresholds = { ...DEFAULT_POLICY, ...policy };
  const stallDurationMs = metrics.lastProgressAtMs === null
    ? 0 : Math.max(0, metrics.nowMs - metrics.lastProgressAtMs);
  const droppedFrameRatio = frameDropRatio(metrics.droppedFrames, metrics.totalFrames);
  const recommendations: string[] = [];

  let health: PlaybackHealth = 'unknown';
  if (!metrics.online) {
    health = 'offline';
    recommendations.push('网络已离线；等待网络恢复后再尝试继续播放。');
  } else if (metrics.paused || metrics.ended) {
    health = 'healthy';
  } else if (metrics.readyState < 3 && metrics.bufferedAheadSeconds !== null && metrics.bufferedAheadSeconds <= 0.25) {
    health = stallDurationMs >= thresholds.stallAfterMs ? 'stalled' : 'buffering';
    recommendations.push('缓冲数据不足；保持当前媒体源并等待缓冲恢复。');
  } else if (stallDurationMs >= thresholds.stallAfterMs && metrics.readyState >= 3) {
    health = 'stalled';
    recommendations.push('播放时间长时间未前进；可提示用户手动重试，不自动切源。');
  } else if (droppedFrameRatio !== null && droppedFrameRatio >= thresholds.droppedFrameRatio) {
    health = 'degraded';
    recommendations.push('检测到较高丢帧比例；采集设备与解码信息后再决定是否调整画质。');
  } else if (metrics.bufferedAheadSeconds !== null && metrics.bufferedAheadSeconds < thresholds.lowBufferSeconds) {
    health = 'low-buffer';
    recommendations.push('可用缓冲偏低；优先观察网络吞吐与分片请求耗时。');
  } else if (metrics.readyState >= 3) {
    health = 'healthy';
  }

  return {
    health,
    bufferedAheadSeconds: metrics.bufferedAheadSeconds,
    stallDurationMs,
    droppedFrameRatio,
    shouldShowBuffering: health === 'buffering' || health === 'stalled' || health === 'low-buffer',
    shouldOfferRetry: health === 'stalled' || health === 'offline',
    recommendations,
  };
}

/** Exponential backoff with a hard cap and deterministic output for tests. */
export function getPlaybackRetryDelayMs(
  attempt: number,
  baseDelayMs = 500,
  maxDelayMs = 8000,
): number {
  if (!Number.isFinite(attempt) || attempt < 0 || !Number.isInteger(attempt)) return baseDelayMs;
  const safeBase = Math.max(0, baseDelayMs);
  const safeMax = Math.max(safeBase, maxDelayMs);
  return Math.min(safeMax, safeBase * (2 ** Math.min(attempt, 20)));
}

/** Safely reads buffered-ahead time from a TimeRanges-like object. */
export function getBufferedAheadSeconds(
  buffered: Pick<TimeRanges, 'length' | 'start' | 'end'> | null | undefined,
  currentTime: number,
): number | null {
  if (!buffered || !Number.isFinite(currentTime)) return null;
  try {
    for (let index = 0; index < buffered.length; index += 1) {
      const start = buffered.start(index);
      const end = buffered.end(index);
      if (currentTime >= start && currentTime <= end) return Math.max(0, end - currentTime);
    }
  } catch {
    return null;
  }
  return 0;
}


/** Starts a measured buffering window once; duplicate waiting events do not reset it. */
export function beginStallWindow(startedAtMs: number | null, nowMs: number): number | null {
  if (!Number.isFinite(nowMs)) return startedAtMs;
  return startedAtMs ?? nowMs;
}

/** Closes a measured buffering window and returns its non-negative duration. */
export function endStallWindow(startedAtMs: number | null, nowMs: number): number {
  if (startedAtMs === null || !Number.isFinite(nowMs)) return 0;
  return Math.max(0, nowMs - startedAtMs);
}
