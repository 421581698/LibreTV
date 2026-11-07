import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  slots: [] as Array<any>,
  index: 0,
  pendingEffects: [] as Array<() => void>,
  playbackEvents: null as null | { onStart: () => void; onEnd: () => void; onError: () => void },
  playbackHandle: null as null | { cancel: ReturnType<typeof vi.fn> },
  interruptOptions: null as null | { onInterrupt: () => void | Promise<void> },
  interruptHandle: null as null | { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> },
}));

vi.mock("react", () => ({
  useState<T>(initial: T | (() => T)) {
    const index = harness.index++;
    if (!(index in harness.slots)) {
      harness.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
    }
    return [
      harness.slots[index] as T,
      (next: T | ((current: T) => T)) => {
        harness.slots[index] = typeof next === "function"
          ? (next as (current: T) => T)(harness.slots[index] as T)
          : next;
      },
    ];
  },
  useRef<T>(initial: T) {
    const index = harness.index++;
    if (!(index in harness.slots)) harness.slots[index] = { current: initial };
    return harness.slots[index] as { current: T };
  },
  useCallback<T extends (...args: any[]) => any>(callback: T) {
    harness.index++;
    return callback;
  },
  useEffect(effect: () => void | (() => void), dependencies?: unknown[]) {
    const index = harness.index++;
    const previous = harness.slots[index] as
      | { dependencies?: unknown[]; cleanup?: () => void }
      | undefined;
    const changed = !previous
      || !dependencies
      || !previous.dependencies
      || dependencies.length !== previous.dependencies.length
      || dependencies.some((value, item) => !Object.is(value, previous.dependencies?.[item]));
    if (changed) {
      previous?.cleanup?.();
      harness.slots[index] = { dependencies, cleanup: undefined };
      harness.pendingEffects.push(() => {
        const cleanup = effect();
        (harness.slots[index] as { cleanup?: () => void }).cleanup =
          typeof cleanup === "function" ? cleanup : undefined;
      });
    }
  },
}));

vi.mock("./voiceActivityInterrupt", () => ({
  createVoiceActivityInterruptController: (options: typeof harness.interruptOptions) => {
    harness.interruptOptions = options;
    harness.interruptHandle = {
      start: vi.fn(async () => true),
      stop: vi.fn(async () => {}),
    };
    return harness.interruptHandle;
  },
}));

vi.mock("./browserTts", () => ({
  createFridayTtsProvider: () => ({
    speak: (_text: string, events: typeof harness.playbackEvents) => {
      harness.playbackEvents = events;
      harness.playbackHandle = { cancel: vi.fn() };
      return harness.playbackHandle;
    },
  }),
}));

import {
  getSpeechErrorMessage,
  shouldEndVoiceSession,
  useFridayVoiceController,
} from "./useFridayVoiceController";

class MockRecognition {
  static instances: MockRecognition[] = [];
  static startImplementation: (() => void) | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  start = vi.fn(() => MockRecognition.startImplementation?.());
  stop = vi.fn();
  abort = vi.fn();

  constructor() {
    MockRecognition.instances.push(this);
  }

  result(transcript: string, isFinal = true) {
    this.onresult?.({
      results: [{ 0: { transcript }, isFinal }],
    } as any);
  }

  startEvent() {
    this.onstart?.();
  }

  endEvent() {
    this.onend?.();
  }

  errorEvent(error: string) {
    this.onerror?.({ error } as any);
  }
}

function renderController(wakeWordEnabled = false) {
  harness.index = 0;
  harness.pendingEffects = [];
  const sent = vi.fn(async (_text?: string, _keepVoiceSession?: boolean) => {});
  const dispatch = vi.fn();
  const input = vi.fn();
  const options = {
    busyRef: { current: false },
    openRef: { current: true },
    closingRef: { current: false },
    dispatchMachine: dispatch,
    setInput: input,
    handleSendRef: { current: sent },
    language: "zh" as const,
    assistantId: "friday" as const,
    wakeWordEnabled,
  };
  // This deterministic hook harness invokes the hook with mocked React primitives.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const controller = useFridayVoiceController(options);
  for (const effect of harness.pendingEffects) effect();
  return {
    controller,
    options,
    sent,
    dispatch,
    input,
    unmount() {
      for (const slot of harness.slots) {
        if (slot && typeof slot === "object" && typeof slot.cleanup === "function") {
          const cleanup = slot.cleanup;
          slot.cleanup = undefined;
          cleanup();
        }
      }
    },
  };
}

describe("Friday speech recognition errors", () => {
  it("explains denied microphone permissions", () => {
    expect(getSpeechErrorMessage("not-allowed")).toContain("麦克风权限被拒绝");
    expect(getSpeechErrorMessage("service-not-allowed")).toContain("麦克风权限被拒绝");
  });

  it("explains missing audio hardware and network failures", () => {
    expect(getSpeechErrorMessage("audio-capture")).toContain("没有检测到可用的麦克风");
    expect(getSpeechErrorMessage("network")).toContain("网络连接异常");
  });

  it("provides a retry hint when no speech is detected", () => {
    expect(getSpeechErrorMessage("no-speech")).toContain("点击麦克风重新聆听");
  });

  it("falls back to keyboard input for unsupported language or unknown errors", () => {
    expect(getSpeechErrorMessage("language-not-supported")).toContain("键盘输入");
    expect(getSpeechErrorMessage("unknown")).toContain("改用键盘输入");
  });

  it("does not show an error for an intentional abort", () => {
    expect(getSpeechErrorMessage("aborted")).toBe("");
  });
});

describe("Friday voice session recovery", () => {
  beforeEach(() => {
    harness.slots = [];
    harness.index = 0;
    harness.pendingEffects = [];
    harness.playbackEvents = null;
    harness.playbackHandle = null;
    harness.interruptOptions = null;
    harness.interruptHandle = null;
    MockRecognition.instances = [];
    MockRecognition.startImplementation = null;
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      isSecureContext: true,
      setTimeout,
      clearTimeout,
      SpeechRecognition: MockRecognition,
    });
  });

  it("ends the current session after terminal recognition errors", () => {
    for (const error of ["not-allowed", "service-not-allowed", "audio-capture", "network", "language-not-supported", "unknown"]) {
      expect(shouldEndVoiceSession(error)).toBe(true);
    }
  });

  it("keeps the session available for a manual retry after no-speech", () => {
    expect(shouldEndVoiceSession("no-speech")).toBe(false);
  });

  it("automatically retries no-speech twice, then waits for a manual tap", async () => {
    const { controller } = renderController();
    controller.toggleListening();

    const first = MockRecognition.instances[0];
    first.errorEvent("no-speech");
    first.endEvent();
    await vi.advanceTimersByTimeAsync(700);
    expect(MockRecognition.instances).toHaveLength(2);

    const second = MockRecognition.instances[1];
    second.errorEvent("no-speech");
    second.endEvent();
    await vi.advanceTimersByTimeAsync(700);
    expect(MockRecognition.instances).toHaveLength(3);

    const third = MockRecognition.instances[2];
    third.errorEvent("no-speech");
    third.endEvent();
    await vi.advanceTimersByTimeAsync(1400);
    expect(MockRecognition.instances).toHaveLength(3);

    controller.toggleListening();
    expect(MockRecognition.instances).toHaveLength(4);
    expect(MockRecognition.instances[3].start).toHaveBeenCalledTimes(1);
  });

  it("resets the no-speech retry budget after receiving speech", async () => {
    const { controller } = renderController();
    controller.toggleListening();

    const first = MockRecognition.instances[0];
    first.errorEvent("no-speech");
    first.endEvent();
    await vi.advanceTimersByTimeAsync(700);

    const second = MockRecognition.instances[1];
    second.result("你好", false);
    second.errorEvent("no-speech");
    second.endEvent();
    await vi.advanceTimersByTimeAsync(700);

    expect(MockRecognition.instances).toHaveLength(3);
    const third = MockRecognition.instances[2];
    third.errorEvent("no-speech");
    third.endEvent();
    await vi.advanceTimersByTimeAsync(700);
    expect(MockRecognition.instances).toHaveLength(4);
  });

  it("requires and strips the configured foreground wake phrase", () => {
    const { controller, sent } = renderController(true);
    controller.toggleListening();
    const first = MockRecognition.instances[0];
    first.result("帮我搜索星际穿越");
    first.endEvent();
    expect(sent).not.toHaveBeenCalled();

    controller.toggleListening();
    const second = MockRecognition.instances[1];
    second.result("嘿 Friday，帮我搜索星际穿越");
    second.endEvent();
    expect(sent).toHaveBeenCalledWith("帮我搜索星际穿越", true);
  });

  it("does not treat an intentional abort as a terminal error", () => {
    expect(shouldEndVoiceSession("aborted")).toBe(false);
    expect(shouldEndVoiceSession(undefined)).toBe(false);
  });

  it("creates only one recognition instance while startup is pending", () => {
    const { controller } = renderController();
    controller.toggleListening();
    controller.startListeningRef.current(false);
    controller.startListeningRef.current(false);

    expect(MockRecognition.instances).toHaveLength(1);
    expect(MockRecognition.instances[0].start).toHaveBeenCalledTimes(1);
  });

  it("handles a synchronous microphone permission rejection and allows retry", () => {
    const { controller, dispatch } = renderController();
    MockRecognition.startImplementation = () => {
      throw new DOMException("Permission denied", "NotAllowedError");
    };
    controller.toggleListening();
    const denied = MockRecognition.instances[0];
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "VOICE_FAILED",
      code: "start-failed",
    }));
    expect(denied.abort).not.toHaveBeenCalled();
    expect(denied.start).toHaveBeenCalledTimes(1);

    MockRecognition.startImplementation = null;
    controller.toggleListening();
    expect(MockRecognition.instances).toHaveLength(2);
    expect(MockRecognition.instances[1].start).toHaveBeenCalledTimes(1);
  });

  it("releases a permission-denied recognizer so a later tap can retry", () => {
    const { controller } = renderController();
    controller.toggleListening();
    const denied = MockRecognition.instances[0];

    denied.errorEvent("not-allowed");
    denied.endEvent();
    controller.toggleListening();

    expect(denied.abort).not.toHaveBeenCalled();
    expect(MockRecognition.instances).toHaveLength(2);
    expect(MockRecognition.instances[1].start).toHaveBeenCalledTimes(1);
  });

  it("releases a failed recognizer when the browser omits the end event", async () => {
    const { controller } = renderController();
    controller.toggleListening();
    const failed = MockRecognition.instances[0];

    failed.errorEvent("not-allowed");
    await vi.advanceTimersByTimeAsync(1500);

    expect(failed.abort).toHaveBeenCalledTimes(1);
    controller.toggleListening();
    expect(MockRecognition.instances).toHaveLength(1);
    // Wait for the Safari release watchdog and the 200ms hand-off buffer.
    await vi.advanceTimersByTimeAsync(1100);
    expect(MockRecognition.instances).toHaveLength(2);
    expect(MockRecognition.instances[1].start).toHaveBeenCalledTimes(1);
  });

  it("keeps final recognition text when the user manually stops listening", () => {
    const { controller, sent } = renderController();
    controller.toggleListening();
    const recognition = MockRecognition.instances[0];
    recognition.startEvent();

    controller.toggleListening();
    recognition.result("帮我找一部科幻电影", true);
    recognition.endEvent();

    expect(sent).toHaveBeenCalledWith("帮我找一部科幻电影", false);
  });

  it("interrupts active TTS when the user starts speaking again", () => {
    const { controller } = renderController();
    controller.toggleListening();
    const first = MockRecognition.instances[0];
    first.startEvent();
    first.endEvent();

    controller.speakText("正在播报的内容", "message-interrupt-by-user");
    const playback = harness.playbackHandle;
    expect(playback).not.toBeNull();

    controller.toggleListening();

    expect(playback?.cancel).toHaveBeenCalledTimes(1);
    expect(MockRecognition.instances).toHaveLength(2);
    expect(MockRecognition.instances[1].start).toHaveBeenCalledTimes(1);
  });

  it("interrupts TTS on acoustic speech onset and hands the mic back to ASR", async () => {
    const { controller } = renderController();
    controller.toggleListening();
    const first = MockRecognition.instances[0];
    first.startEvent();
    first.endEvent();

    controller.speakText("正在播报的内容", "message-acoustic-interrupt");
    harness.playbackEvents?.onStart();
    await Promise.resolve();

    const playback = harness.playbackHandle;
    expect(harness.interruptHandle?.start).toHaveBeenCalledTimes(1);
    expect(harness.interruptOptions).not.toBeNull();

    void harness.interruptOptions?.onInterrupt();
    expect(playback?.cancel).toHaveBeenCalledTimes(1);
    expect(MockRecognition.instances).toHaveLength(2);
    expect(MockRecognition.instances[1].start).toHaveBeenCalledTimes(1);
  });

  it("sends one request for a final transcript and ignores late duplicate events", () => {
    const { controller, sent } = renderController();
    controller.toggleListening();
    const recognition = MockRecognition.instances[0];
    recognition.startEvent();
    recognition.result("只处理一次", true);
    recognition.endEvent();
    recognition.result("重复的迟到文本", true);
    recognition.endEvent();

    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent).toHaveBeenCalledWith("只处理一次", true);
  });

  it("resumes listening after speech playback ends", async () => {
    const { controller } = renderController();
    controller.toggleListening();
    const first = MockRecognition.instances[0];
    first.startEvent();
    first.endEvent();

    controller.speakText("已经为你找到影片", "message-1");
    expect(harness.playbackEvents).not.toBeNull();
    harness.playbackEvents?.onStart();
    harness.playbackEvents?.onEnd();

    await vi.advanceTimersByTimeAsync(700);
    expect(MockRecognition.instances).toHaveLength(2);
    expect(MockRecognition.instances[1].start).toHaveBeenCalledTimes(1);
  });

  it("ignores late events from a replaced recognition instance", () => {
    const { controller, input, sent } = renderController();
    controller.toggleListening();
    const oldRecognition = MockRecognition.instances[0];
    oldRecognition.startEvent();
    oldRecognition.endEvent();

    controller.startListeningRef.current(false);
    const currentRecognition = MockRecognition.instances[1];
    expect(currentRecognition).toBeDefined();

    oldRecognition.result("过期的旧会话文本", true);
    oldRecognition.endEvent();

    expect(input).not.toHaveBeenCalledWith("过期的旧会话文本");
    expect(sent).not.toHaveBeenCalled();
    expect(currentRecognition.start).toHaveBeenCalledTimes(1);
  });

  it("releases active recognition and cancels pending playback when the panel closes", () => {
    const { controller } = renderController();
    controller.toggleListening();
    const recognition = MockRecognition.instances[0];
    recognition.startEvent();

    controller.speakText("正在播报", "message-close");
    const playback = harness.playbackHandle;
    expect(playback).not.toBeNull();

    controller.stopAllVoice();

    expect(recognition.abort).toHaveBeenCalledTimes(1);
    expect(playback?.cancel).toHaveBeenCalledTimes(1);
  });

  it("releases recognition, cancels playback, and clears resume timers on unmount", async () => {
    const { controller, unmount } = renderController();
    controller.toggleListening();
    const recognition = MockRecognition.instances[0];
    recognition.startEvent();

    controller.speakText("正在播报", "message-unmount");
    const playback = harness.playbackHandle;
    controller.scheduleVoiceResume();

    unmount();

    expect(recognition.abort).toHaveBeenCalledTimes(1);
    expect(playback?.cancel).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(MockRecognition.instances).toHaveLength(1);
  });

  it("does not resume twice when speech playback is interrupted", async () => {
    const { controller } = renderController();
    controller.toggleListening();
    const first = MockRecognition.instances[0];
    first.startEvent();
    first.endEvent();

    controller.speakText("正在播报", "message-interrupt");
    const playback = harness.playbackEvents;
    controller.stopSpeechAndResume();
    playback?.onEnd();

    await vi.advanceTimersByTimeAsync(700);
    expect(MockRecognition.instances).toHaveLength(2);
    expect(MockRecognition.instances[1].start).toHaveBeenCalledTimes(1);
  });

  it("does not restart listening after the panel closes", async () => {
    const { controller, options } = renderController();
    controller.toggleListening();
    const first = MockRecognition.instances[0];
    first.startEvent();
    first.endEvent();

    controller.speakText("正在播报", "message-2");
    harness.playbackEvents?.onEnd();
    options.openRef.current = false;
    options.closingRef.current = true;
    controller.stopAllVoice();

    await vi.advanceTimersByTimeAsync(1000);
    expect(MockRecognition.instances).toHaveLength(1);
  });
});
