import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  slots: [] as Array<any>,
  index: 0,
  pendingEffects: [] as Array<() => void>,
  playbackEvents: null as null | { onStart: () => void; onEnd: () => void; onError: () => void },
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

vi.mock("./browserTts", () => ({
  createFridayTtsProvider: () => ({
    speak: (_text: string, events: typeof harness.playbackEvents) => {
      harness.playbackEvents = events;
      return { cancel: vi.fn() };
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
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  start = vi.fn();
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

function renderController() {
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
  };
  const controller = useFridayVoiceController(options);
  for (const effect of harness.pendingEffects) effect();
  return { controller, options, sent, dispatch, input };
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
    MockRecognition.instances = [];
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

  it("does not restart listening after the panel closes", async () => {
    const { controller } = renderController();
    controller.toggleListening();
    const first = MockRecognition.instances[0];
    first.startEvent();
    first.endEvent();

    controller.speakText("正在播报", "message-2");
    harness.playbackEvents?.onEnd();
    controller.stopAllVoice();

    await vi.advanceTimersByTimeAsync(1000);
    expect(MockRecognition.instances).toHaveLength(1);
  });
});
