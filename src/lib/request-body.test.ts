import { describe, expect, it } from "vitest";
import { readJsonLimited, RequestBodyError } from "./request-body";

function request(body: string, headers?: HeadersInit): Request {
  return new Request("https://local.test/api/test", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

describe("readJsonLimited", () => {
  it("parses valid JSON within the byte limit", async () => {
    await expect(readJsonLimited(request('{"ok":true}'), 32)).resolves.toEqual({ ok: true });
  });
  it("rejects oversized streamed bodies even without Content-Length", async () => {
    await expect(readJsonLimited(request('{"value":"1234567890"}'), 8))
      .rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
  });
  it("rejects oversized declared Content-Length", async () => {
    await expect(readJsonLimited(request("{}", { "content-length": "100" }), 8))
      .rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
  });
  it("rejects malformed Content-Length", async () => {
    await expect(readJsonLimited(request("{}", { "content-length": "unknown" }), 8))
      .rejects.toMatchObject({ code: "INVALID_CONTENT_LENGTH" });
  });
  it("rejects malformed JSON with a typed error", async () => {
    await expect(readJsonLimited(request("{"), 8)).rejects.toBeInstanceOf(RequestBodyError);
  });
});
