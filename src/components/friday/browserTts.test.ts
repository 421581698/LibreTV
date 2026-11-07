import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFridayTtsProvider } from "./browserTts";

class MockUtterance {
  lang = "";
  rate = 1;
  pitch = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

class MockAudio {
  static instances: MockAudio[] = [];
  static playImplementation: () => Promise<void> = async () => {};
  preload = "";
  onplay: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  pause = vi.fn();
  removeAttribute = vi.fn();
  load = vi.fn();
  play = vi.fn(() => MockAudio.playImplementation());

  constructor(public src: string) {
    MockAudio.instances.push(this);
  }
}

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const successfulAudioResponse = () => ({
  ok: true,
  headers: { get: () => "audio/mpeg" },
  blob: async () => new Blob(["audio"]),
});

describe("Friday TTS provider lifecycle", () => {
  beforeEach(() => {
    MockAudio.instances = [];
    MockAudio.playImplementation = async () => {};
    vi.stubGlobal("Audio", MockAudio);
    vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:friday-audio"),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal("window", {
      speechSynthesis: { speak: vi.fn(), cancel: vi.fn() },
    });
    vi.stubGlobal("fetch", vi.fn());
  });

  it("aborts an in-flight Edge TTS request when playback is cancelled", async () => {
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }));

    const provider = createFridayTtsProvider("zh");
    expect(provider).not.toBeNull();
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const onError = vi.fn();
    const playback = provider!.speak("你好", { onStart, onEnd, onError });

    playback.cancel();
    await flushPromises();

    expect(requestSignal?.aborted).toBe(true);
    expect(MockAudio.instances).toHaveLength(0);
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("falls back to browser speech when the Edge TTS request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));

    const provider = createFridayTtsProvider("zh");
    const events = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };
    provider!.speak("测试回退", events);
    await flushPromises();

    expect(window.speechSynthesis.speak).toHaveBeenCalledTimes(1);
    const utterance = (window.speechSynthesis.speak as ReturnType<typeof vi.fn>).mock.calls[0][0] as MockUtterance;
    expect(utterance.text).toBe("测试回退");
    expect(utterance.lang).toBe("zh-CN");
  });

  it("falls back exactly once when HTML audio playback rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => successfulAudioResponse()));
    MockAudio.playImplementation = async () => {
      throw new Error("Autoplay was blocked");
    };

    const provider = createFridayTtsProvider("zh");
    const events = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };
    provider!.speak("播放失败", events);
    await vi.waitFor(() => {
      expect(window.speechSynthesis.speak).toHaveBeenCalledTimes(1);
    });

    expect(window.speechSynthesis.speak).toHaveBeenCalledTimes(1);
    expect(MockAudio.instances).toHaveLength(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("does not emit onStart twice if Edge audio starts before falling back", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => successfulAudioResponse()));

    const provider = createFridayTtsProvider("zh");
    const events = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };
    provider!.speak("测试重复开始", events);
    await flushPromises();

    const audio = MockAudio.instances[0];
    audio.onplay?.();
    audio.onerror?.();
    await flushPromises();

    expect(events.onStart).toHaveBeenCalledTimes(1);
    const fallbackUtterance = (window.speechSynthesis.speak as ReturnType<typeof vi.fn>).mock.calls[0][0] as MockUtterance;
    fallbackUtterance.onstart?.();
    expect(events.onStart).toHaveBeenCalledTimes(1);
    expect(window.speechSynthesis.speak).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("cleans up audio and ignores late playback events after cancellation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => successfulAudioResponse()));

    const provider = createFridayTtsProvider("en");
    const events = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };
    const playback = provider!.speak("Hello", events);
    await flushPromises();

    const audio = MockAudio.instances[0];
    expect(audio).toBeDefined();
    expect(audio.play).toHaveBeenCalledTimes(1);

    playback.cancel();

    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(audio.removeAttribute).toHaveBeenCalledWith("src");
    expect(audio.onended).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:friday-audio");
    expect(events.onEnd).not.toHaveBeenCalled();
    expect(events.onError).not.toHaveBeenCalled();
  });
});
