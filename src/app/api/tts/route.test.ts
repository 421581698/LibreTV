import { beforeEach, describe, expect, it, vi } from "vitest";

const { guardRequest, createEdgeTtsStream, createPiperTtsResponse } = vi.hoisted(() => ({
  guardRequest: vi.fn(),
  createEdgeTtsStream: vi.fn(),
  createPiperTtsResponse: vi.fn(),
}));

vi.mock("@/lib/api-guard", () => ({ guardRequest }));
vi.mock("@/lib/friday/edgeTts", () => ({ createEdgeTtsStream }));
vi.mock("@/lib/friday/piperTts", () => ({ createPiperTtsResponse }));

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
    createEdgeTtsStream.mockImplementation(() => Promise.resolve(audioStream()));
    createPiperTtsResponse.mockImplementation(() => Promise.resolve(new Response(audioStream(), {
      status: 200,
      headers: { "content-type": "audio/wav" },
    })));
    vi.stubEnv("JARVIS_TTS_URL", "https://voice.example.com");
    vi.stubEnv("JARVIS_TTS_TOKEN", "test-secret");
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

  it("selects the Xiaoxiao voice for Chinese requests", async () => {
    const response = await POST(makeRequest({ text: "你好，Friday。" }));

    expect(response.status).toBe(200);
    expect(createEdgeTtsStream).toHaveBeenCalledWith(expect.objectContaining({
      text: "你好，Friday。",
      voice: "zh-CN-XiaoxiaoNeural",
    }));
  });

  it("uses Piper JARVIS for English when configured", async () => {
    const response = await POST(makeRequest({ text: "Hello Friday", language: "en" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/wav");
    expect(response.headers.get("x-friday-tts-engine")).toBe("piper-jarvis");
    expect(createPiperTtsResponse).toHaveBeenCalledWith(expect.objectContaining({
      text: "Hello Friday",
    }));
    expect(createEdgeTtsStream).not.toHaveBeenCalled();
  });

  it("keeps Chinese on Microsoft Edge even when Piper is configured", async () => {
    const response = await POST(makeRequest({ text: "你好", language: "zh" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("x-friday-tts-engine")).toBe("microsoft-edge");
    expect(createPiperTtsResponse).not.toHaveBeenCalled();
    expect(createEdgeTtsStream).toHaveBeenCalledWith(expect.objectContaining({
      voice: "zh-CN-XiaoxiaoNeural",
    }));
  });

  it("falls back to Microsoft Edge when optional Piper JARVIS fails", async () => {
    createPiperTtsResponse.mockRejectedValueOnce(new Error("Piper unavailable"));

    const response = await POST(makeRequest({ text: "Hello Friday", language: "en" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("x-friday-tts-engine")).toBe("microsoft-edge");
    expect(createEdgeTtsStream).toHaveBeenCalledWith(expect.objectContaining({
      voice: "en-US-AvaMultilingualNeural",
    }));
  });

  it("rejects an upstream stream that completes without audio", async () => {
    createEdgeTtsStream.mockResolvedValue(new ReadableStream<Uint8Array>({
      start(controller) { controller.close(); },
    }));

    const response = await POST(makeRequest({ text: "你好" }));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "Friday voice synthesis is temporarily unavailable.",
    });
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
