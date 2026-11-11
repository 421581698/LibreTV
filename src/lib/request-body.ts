export type RequestBodyErrorCode =
  | "BODY_TOO_LARGE"
  | "INVALID_CONTENT_LENGTH"
  | "EMPTY_BODY"
  | "INVALID_UTF8"
  | "INVALID_JSON";

export class RequestBodyError extends Error {
  constructor(public readonly code: RequestBodyErrorCode) {
    super(code);
    this.name = "RequestBodyError";
  }
}

/** Parse JSON with a strict streamed byte ceiling; Content-Length is only an early hint. */
export async function readJsonLimited<T = unknown>(request: Request, maxBytes: number): Promise<T> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("maxBytes must be a positive safe integer");
  }

  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) throw new RequestBodyError("INVALID_CONTENT_LENGTH");
    const length = Number(declared);
    if (!Number.isSafeInteger(length)) throw new RequestBodyError("INVALID_CONTENT_LENGTH");
    if (length > maxBytes) throw new RequestBodyError("BODY_TOO_LARGE");
  }

  if (!request.body) throw new RequestBodyError("EMPTY_BODY");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch { /* best effort */ }
        throw new RequestBodyError("BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* stream may already be cancelled */ }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RequestBodyError("INVALID_UTF8");
  }
  try {
    return JSON.parse(source) as T;
  } catch {
    throw new RequestBodyError("INVALID_JSON");
  }
}

export function requestBodyErrorStatus(error: unknown): 400 | 413 {
  return error instanceof RequestBodyError && error.code === "BODY_TOO_LARGE" ? 413 : 400;
}
