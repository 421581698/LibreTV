import { describe, expect, it } from "vitest";
import {
  readResponseBytesLimited,
  readResponseJsonLimited,
  readResponseTextLimited,
  ResponseBodyError,
} from "./response-body";

describe("bounded upstream response readers", () => {
  it("reads UTF-8 text within the byte limit", async () => {
    await expect(readResponseTextLimited(new Response("海报"), 16)).resolves.toBe("海报");
  });
  it("rejects oversized streamed bodies", async () => {
    await expect(readResponseBytesLimited(new Response("123456789"), 8))
      .rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
  });
  it("rejects oversized declared bodies before reading", async () => {
    await expect(readResponseTextLimited(new Response("{}", { headers: { "content-length": "100" } }), 8))
      .rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
  });
  it("parses JSON within the byte limit", async () => {
    await expect(readResponseJsonLimited(new Response('{"ok":true}'), 32)).resolves.toEqual({ ok: true });
  });
  it("rejects malformed JSON with a typed error", async () => {
    await expect(readResponseJsonLimited(new Response("{"), 8)).rejects.toBeInstanceOf(ResponseBodyError);
  });
});
