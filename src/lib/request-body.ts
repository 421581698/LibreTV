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

/**
 * Parse JSON without buffering an unbounded request body.
 * Content-Length is an early rejection hint only; the streamed byte count is
 * always enforced because clients may omit or falsify the header.
 */
export async function readJsonLimited<T = unknown>(
  request: Request,
  maxBytes: number,
): Promise<T> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("maxBytes must be a positive safe integer");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      throw new RequestBodyError("INVALID_CONTENT_LENGTH");
    }
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength)) {
      throw new RequestBodyError("INVALID_CONTENT_LENGTH");
    }
    if (declaredLength > maxBytes) {
      throw new RequestBodyError("BODY_TOO_LARGE");
    }
  }

  if (!request.body) throw new RequestBodyError("EMPTY_BODY");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RequestBodyError("BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
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
  return error instanceof RequestBodyError && error.code === "BODY_TOO_LARGE"
    ? 413
    : 400;
}
