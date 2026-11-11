export type ResponseBodyErrorCode = "BODY_TOO_LARGE" | "INVALID_UTF8" | "INVALID_JSON";

export class ResponseBodyError extends Error {
  constructor(public readonly code: ResponseBodyErrorCode) {
    super(code);
    this.name = "ResponseBodyError";
  }
}

/**
 * Read an upstream body with a strict byte ceiling.
 * Content-Length is checked early, but the streamed byte count is authoritative.
 */
export async function readResponseBytesLimited(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("maxBytes must be a positive safe integer");
  }

  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && /^\d+$/.test(declaredLength)) {
    const length = Number(declaredLength);
    if (Number.isSafeInteger(length) && length > maxBytes) {
      try { await response.body?.cancel(); } catch { /* ignore */ }
      throw new ResponseBodyError("BODY_TOO_LARGE");
    }
  }

  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try { await reader.cancel(); } catch { /* ignore */ }
        throw new ResponseBodyError("BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readResponseTextLimited(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const bytes = await readResponseBytesLimited(response, maxBytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ResponseBodyError("INVALID_UTF8");
  }
}

export async function readResponseJsonLimited<T = unknown>(
  response: Response,
  maxBytes: number,
): Promise<T> {
  const text = await readResponseTextLimited(response, maxBytes);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ResponseBodyError("INVALID_JSON");
  }
}
