/**
 * Conservative browser-side AC-3 / E-AC-3 recognition. Codec declarations are
 * routing hints, not evidence of decoded Dolby audio or Atmos speaker output.
 */
export function isDolbyAudioCodec(value: string): boolean {
  return value.trim().toLowerCase().split(',').some((item) =>
    /^(?:ac-3|ec-3)$/.test(item.trim()));
}

/** Inspect the master playlist without downloading media or sending user files. */
export async function inspectNativeHlsDolbyAudioCodecs(
  url: string, signal?: AbortSignal, fetcher: typeof fetch = fetch,
): Promise<string[]> {
  try {
    const response = await fetcher(url, { method: 'GET', cache: 'no-store',
      credentials: 'omit', mode: 'cors', signal });
    if (!response.ok || !response.body) return [];
    const limit = 512 * 1024;
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > limit) return [];
    const reader = response.body.getReader();
    let total = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > limit) { await reader.cancel(); return []; }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const text = new TextDecoder().decode(Uint8Array.from(chunks.flatMap((b) => Array.from(b))));
    if (!text.trimStart().startsWith('#EXTM3U')) return [];
    const codecs = new Set<string>();
    for (const line of text.split(/\r?\n/)) {
      if (!/^#EXT-X-(?:STREAM-INF|MEDIA):/.test(line)) continue;
      const match = /(?:^|,)\s*CODECS="([^"]+)"/i.exec(line.slice(line.indexOf(':') + 1));
      if (!match) continue;
      for (const codec of match[1].split(',')) {
        const normalized = codec.trim().toLowerCase();
        if (isDolbyAudioCodec(normalized)) codecs.add(normalized);
      }
    }
    return [...codecs];
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
    return [];
  }
}
