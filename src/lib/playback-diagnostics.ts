/**
 * Small, browser-safe playback diagnostics helpers.
 *
 * These helpers observe the native video element only. They never alter the
 * media pipeline, request quality changes, or retain media URLs.
 */

export interface PlaybackQualityCounters {
  totalFrames: number;
  droppedFrames: number;
}

export interface BufferedRangesLike {
  length: number;
  start(index: number): number;
  end(index: number): number;
}

/** Seconds of already-buffered media ahead of the current playhead. */
export function getBufferedAheadSeconds(
  buffered: BufferedRangesLike | null | undefined,
  currentTime: number,
): number {
  if (!buffered || !Number.isFinite(currentTime) || currentTime < 0) return 0;

  for (let index = 0; index < buffered.length; index += 1) {
    try {
      const start = buffered.start(index);
      const end = buffered.end(index);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
      // A small tolerance handles floating-point gaps at a range boundary.
      if (currentTime >= start - 0.25 && currentTime <= end + 0.25) {
        return Math.max(0, end - currentTime);
      }
    } catch {
      // TimeRanges can change between reading length and an indexed range.
    }
  }

  return 0;
}

interface VideoQualityLike {
  getVideoPlaybackQuality?: () => {
    totalVideoFrames?: number;
    droppedVideoFrames?: number;
  };
  webkitDecodedFrameCount?: number;
  webkitDroppedFrameCount?: number;
}

function finiteCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/**
 * Read browser-reported frame counters where available. Safari/WebKit's
 * prefixed counters are retained as a fallback for older implementations.
 */
export function readPlaybackQualityCounters(
  video: VideoQualityLike | null | undefined,
): PlaybackQualityCounters | undefined {
  if (!video) return undefined;

  try {
    const quality = video.getVideoPlaybackQuality?.();
    const totalFrames = finiteCount(quality?.totalVideoFrames)
      ?? finiteCount(video.webkitDecodedFrameCount);
    const droppedFrames = finiteCount(quality?.droppedVideoFrames)
      ?? finiteCount(video.webkitDroppedFrameCount);

    if (totalFrames === undefined && droppedFrames === undefined) return undefined;
    return {
      totalFrames: totalFrames ?? 0,
      droppedFrames: droppedFrames ?? 0,
    };
  } catch {
    return undefined;
  }
}
