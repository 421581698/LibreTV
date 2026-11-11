import { describe, expect, it } from "vitest";
import {
  readResponseBytesLimited,
  readResponseJsonLimited,
  readResponseTextLimited,
  ResponseBodyError,
} from "./response-body";

describe("bounded upstream response readers", () => {
  it("reads UTF-8 text within the byte limit", async () => {
    const response = new Response("海报", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
    await expect(readResponseTextLimited(response, 16)).resolves.toBe("海报");
  });

  it("rejects oversized bodies using the streamed byte count", async () => {
    const response = new Response("123456789");
    await expect(readResponseBytesLimited(response, 8))
      .rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
  });

  it("rejects oversized declared bodies before reading", async () => {
    const response = new Response("{}", {
      headers: { "content-length": "100" },
    });
    await expect(readResponseTextLimited(response, 8))
      .rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
  });

  it("parses JSON within the byte limit", async () => {
    const response = new Response('{"ok":true}');
    await expect(readResponseJsonLimited(response, 32)).resolves.toEqual({ ok: true });
  });

  it("rejects malformed JSON with a typed error", async () => {
    const response = new Response("{");
    await expect(readResponseJsonLimited(response, 8))
      .rejects.toBeInstanceOf(ResponseBodyError);
  });
});
