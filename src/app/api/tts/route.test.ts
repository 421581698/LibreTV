import { beforeEach, describe, expect, it, vi } from "vitest";

const { guardRequest, createEdgeTtsStream } = vi.hoisted(() => ({
  guardRequest: vi.fn(),
  createEdgeTtsStream: vi.fn(),
}));

vi.mock("@/lib/api-guard", () => ({ guardRequest }));
vi.mock("@/lib/friday/edgeTts", () => ({ createEdgeTtsStream }));

import { POST } from "./route";

function makeRequest(
  body: unknown,
  options: { ip?: string; contentType?: string; rawBody?: string } = {},
) {
  return new Request("https://example.test/api/tts", {
    method: "POST",
    headers: {
      "content-type": options.contentType ?? "application/json",
      "cf-connecting-ip": options.ip ?? crypto.randomUUID(),
    },
    body: options.rawBody ?? JSON.stringify(body),
  });
}

function audioStream() {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
}

describe("POST /api/tts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guardRequest.mockReturnValue(null);
    createEdgeTtsStream.mockResolvedValue(audioStream());
  });

  it("rejects unauthenticated requests before parsing or synthesis", async () => {
    const denied = Response.json({ error: "Unauthorized" }, { status: 401 });
    guardRequest.mockReturnValue(denied);

    const response = await POST(makeRequest({ text: "你好" }));

    expect(response.status).toBe(401);
    expect(createEdgeTtsStream).not.toHaveBeenCalled();
  });

  it("validates JSON content type and request payload", async () => {
    const unsupported = await POST(makeRequest({ text: "你好" }, { contentType: "text/plain" }));
    const invalid = await POST(makeRequest({ text: " " }));

    expect(unsupported.status).toBe(415);
    expect(invalid.status).toBe(400);
    expect(createEdgeTtsStream).not.toHaveBeenCalled();
  });

  it("streams MP3 audio and selects the requested voice", async () => {
    const response = await POST(makeRequest({ text: "Hello Friday", language: "en" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(createEdgeTtsStream).toHaveBeenCalledWith(expect.objectContaining({
      text: "Hello Friday",
      voice: "en-US-AvaMultilingualNeural",
    }));
  });

  it("returns a safe gateway error when upstream synthesis fails", async () => {
    createEdgeTtsStream.mockRejectedValue(new Error("upstream details must not leak"));

    const response = await POST(makeRequest({ text: "你好" }));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "Friday voice synthesis is temporarily unavailable.",
    });
  });

  it("rate limits a client after twenty requests in one minute", async () => {
    const ip = "198.51.100.42";
    const responses = [];
    for (let index = 0; index < 21; index += 1) {
      responses.push(await POST(makeRequest({ text: "你好" }, { ip })));
    }

    expect(responses.slice(0, 20).every((response) => response.status === 200)).toBe(true);
    expect(responses[20].status).toBe(429);
    expect(createEdgeTtsStream).toHaveBeenCalledTimes(20);
  });
});
