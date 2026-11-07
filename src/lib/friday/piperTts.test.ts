import { afterEach, describe, expect, it, vi } from "vitest";
import { createPiperTtsResponse } from "./piperTts";

describe("createPiperTtsResponse", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends authenticated bounded text to the configured HTTPS JARVIS service", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([82, 73, 70, 70]), {
      status: 200,
      headers: { "content-type": "audio/wav" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await createPiperTtsResponse({
      text: "Hello Friday",
      baseUrl: "https://voice.example.com",
      token: "test-secret",
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://voice.example.com/v1/tts"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-secret",
          "Content-Type": "application/json",
          Accept: "audio/wav",
        }),
        body: JSON.stringify({ text: "Hello Friday" }),
        cache: "no-store",
      }),
    );
  });

  it("requires both service URL and token", async () => {
    await expect(createPiperTtsResponse({
      text: "Hello",
      baseUrl: "https://voice.example.com",
      token: "",
    })).rejects.toThrow("JARVIS TTS is not configured.");
  });

  it("rejects insecure non-local service URLs", async () => {
    await expect(createPiperTtsResponse({
      text: "Hello",
      baseUrl: "http://voice.example.com",
      token: "test-secret",
    })).rejects.toThrow("JARVIS TTS must use HTTPS.");
  });

  it("rejects an upstream response that is not WAV audio", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not audio", {
      status: 200,
      headers: { "content-type": "text/plain" },
    })));

    await expect(createPiperTtsResponse({
      text: "Hello",
      baseUrl: "https://voice.example.com",
      token: "test-secret",
    })).rejects.toThrow("JARVIS TTS returned an unsupported audio format.");
  });

  it("rejects upstream HTTP errors without exposing response content", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("private upstream detail", { status: 503 })));

    await expect(createPiperTtsResponse({
      text: "Hello",
      baseUrl: "https://voice.example.com",
      token: "test-secret",
    })).rejects.toThrow("JARVIS TTS request failed: 503");
  });
});
