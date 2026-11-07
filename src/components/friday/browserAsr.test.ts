import { afterEach, describe, expect, it, vi } from "vitest";
import { getBrowserAsrConstructor } from "./browserAsr";

describe("browser ASR capability adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns null outside a browser or when Web Speech is unavailable", () => {
    vi.stubGlobal("window", undefined);
    expect(getBrowserAsrConstructor()).toBeNull();
    vi.stubGlobal("window", {});
    expect(getBrowserAsrConstructor()).toBeNull();
  });

  it("prefers the standard SpeechRecognition constructor", () => {
    class StandardRecognition {}
    class WebkitRecognition {}
    vi.stubGlobal("window", {
      SpeechRecognition: StandardRecognition,
      webkitSpeechRecognition: WebkitRecognition,
    });
    expect(getBrowserAsrConstructor()).toBe(StandardRecognition);
  });

  it("supports the WebKit-prefixed Safari constructor", () => {
    class WebkitRecognition {}
    vi.stubGlobal("window", { webkitSpeechRecognition: WebkitRecognition });
    expect(getBrowserAsrConstructor()).toBe(WebkitRecognition);
  });
});
