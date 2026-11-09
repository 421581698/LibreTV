import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchWithSafeRedirects: vi.fn(),
  rewriteM3u8: vi.fn((text: string) => text),
}));

vi.mock("@/lib/api-guard", () => ({
  guardRequest: () => null,
  jsonError: (message: string, status: number) =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox",
      },
    }),
}));

vi.mock("@/lib/ssrf", () => ({
  checkLiveUrlAllowed: vi.fn(async () => ({ ok: true })),
  isBlockedByDNS: vi.fn(async () => false),
  isValidProxyUrl: vi.fn(() => true),
}));

vi.mock("@/lib/fetch-utils", () => ({
  fetchWithSafeRedirects: mocks.fetchWithSafeRedirects,
}));

vi.mock("@/lib/m3u8", () => ({
  LIVE_STREAM_BASE: "/api/live/stream",
  rewriteM3u8: mocks.rewriteM3u8,
}));

import { handleLiveStreamRequest, handleProxyRequest } from "./proxy-handlers";

describe("media proxy response safety", () => {
  beforeEach(() => {
    mocks.fetchWithSafeRedirects.mockReset();
    mocks.rewriteM3u8.mockClear();
  });

  it("rejects HTML from the generic proxy instead of serving it on the LibreTV origin", async () => {
    mocks.fetchWithSafeRedirects.mockResolvedValue({
      res: new Response("<script>window.compromised = true</script>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
      finalUrl: "https://attacker.example/payload.html",
    });

    const response = await handleProxyRequest(
      new Request("https://libretv.example/api/proxy"),
      "https://attacker.example/payload.html",
    );

    expect(response.status).toBe(415);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("sandbox");
    expect(await response.text()).toContain("不允许");
  });

  it("rejects JSON and active SVG responses from the generic proxy", async () => {
    for (const contentType of ["application/json", "image/svg+xml"]) {
      mocks.fetchWithSafeRedirects.mockResolvedValue({
        res: new Response("{}", { headers: { "content-type": contentType } }),
        finalUrl: "https://attacker.example/response",
      });

      const response = await handleProxyRequest(
        new Request("https://libretv.example/api/proxy"),
        "https://attacker.example/response",
      );
      expect(response.status).toBe(415);
    }
  });

  it("rejects HTML disguised as an HLS playlist", async () => {
    mocks.fetchWithSafeRedirects.mockResolvedValue({
      res: new Response("<html>not a playlist</html>", {
        headers: { "content-type": "text/html" },
      }),
      finalUrl: "https://attacker.example/fake.m3u8",
    });

    const response = await handleProxyRequest(
      new Request("https://libretv.example/api/proxy"),
      "https://attacker.example/fake.m3u8",
    );

    expect(response.status).toBe(502);
    expect(mocks.rewriteM3u8).not.toHaveBeenCalled();
  });

  it("accepts a valid BOM-prefixed HLS playlist and marks it nosniff", async () => {
    mocks.fetchWithSafeRedirects.mockResolvedValue({
      res: new Response("\uFEFF#EXTM3U\n#EXT-X-ENDLIST\n", {
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      }),
      finalUrl: "https://media.example/master.m3u8",
    });

    const response = await handleProxyRequest(
      new Request("https://libretv.example/api/proxy"),
      "https://media.example/master.m3u8",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/vnd.apple.mpegurl");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mocks.rewriteM3u8).toHaveBeenCalledTimes(1);
  });

  it("rejects HTML from the live-stream proxy", async () => {
    mocks.fetchWithSafeRedirects.mockResolvedValue({
      res: new Response("<html>error</html>", {
        headers: { "content-type": "text/html" },
      }),
      finalUrl: "https://attacker.example/stream.mp4",
    });

    const response = await handleLiveStreamRequest(
      new Request("https://libretv.example/api/live/stream"),
      "https://attacker.example/stream.mp4",
    );

    expect(response.status).toBe(415);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("sandbox");
  });

  it("rejects oversized HLS manifests before rewriting", async () => {
    mocks.fetchWithSafeRedirects.mockResolvedValue({
      res: new Response("#EXTM3U", {
        headers: {
          "content-type": "application/vnd.apple.mpegurl",
          "content-length": String(2 * 1024 * 1024),
        },
      }),
      finalUrl: "https://media.example/large.m3u8",
    });

    const response = await handleLiveStreamRequest(
      new Request("https://libretv.example/api/live/stream"),
      "https://media.example/large.m3u8",
    );

    expect(response.status).toBe(502);
    expect(mocks.rewriteM3u8).not.toHaveBeenCalled();
  });
});
