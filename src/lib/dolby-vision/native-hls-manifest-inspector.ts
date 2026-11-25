import { inspectDolbyVisionFormat, type DolbyVisionFormatReport } from './format-inspector';

/**
 * Safari can play cross-origin native HLS without exposing its manifest to
 * JavaScript. This best-effort probe improves diagnostics when CORS permits
 * reading the master playlist; failure never blocks playback and is not
 * interpreted as proof that Dolby Vision is absent.
 */
export async function inspectNativeHlsDolbyVisionManifest(
  url: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<DolbyVisionFormatReport> {
  const base = () => inspectDolbyVisionFormat({
    url,
    mimeType: 'application/vnd.apple.mpegurl',
  });

  try {
    const response = await fetcher(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      mode: 'cors',
      signal,
    });
    if (!response.ok) {
      const report = base();
      return {
        ...report,
        notes: [...report.notes, `原生 HLS 清单读取失败（HTTP ${response.status}）；Safari 仍可能正常播放，Dolby Vision 状态保持未知。`],
      };
    }

    const manifest = await response.text();
    if (!manifest.trimStart().startsWith('#EXTM3U')) {
      const report = base();
      return {
        ...report,
        notes: [...report.notes, '返回内容不是有效的 HLS 播放列表；未据此判断 Dolby Vision 是否存在。'],
      };
    }

    const report = inspectDolbyVisionFormat({
      url,
      mimeType: 'application/vnd.apple.mpegurl',
      manifest,
    });
    return {
      ...report,
      notes: [
        ...report.notes,
        report.detected
          ? '已从 Safari 原生 HLS 可读取的清单中发现 Dolby Vision codec 声明；仍未验证媒体分片 RPU 或实际解码输出。'
          : '已读取 Safari 原生 HLS 清单，但未发现 Dolby Vision codec 声明；媒体分片仍未进行 RPU 分析。',
      ],
    };
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
    const report = base();
    return {
      ...report,
      notes: [...report.notes, '浏览器无法读取原生 HLS 清单（常见原因是跨域 CORS 限制）；Safari 可能仍可播放，Dolby Vision 状态保持未知。'],
    };
  }
}
