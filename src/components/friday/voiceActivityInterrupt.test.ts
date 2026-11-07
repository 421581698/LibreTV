import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createVoiceActivityInterruptController,
} from "./voiceActivityInterrupt";

function createFakeCapture() {
  let emit: ((event: { type: "speechstart" | "speechend"; at: number }) => void) | null = null;
  const capture = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    isRunning: vi.fn(() => true),
  };
  const createCapture = vi.fn((options: {
    onEvent: (event: { type: "speechstart" | "speechend"; at: number }) => void;
  }) => {
    emit = options.onEvent;
    return capture;
  });
  return {
    capture,
    createCapture,
    emit(event: { type: "speechstart" | "speechend"; at: number }) {
      emit?.(event);
    },
  };
}

describe("VAD speech interruption coordinator", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("arms only with an already-granted microphone permission", async () => {
    const fake = createFakeCapture();
    vi.stubGlobal("navigator", {
      permissions: {
        query: vi.fn(async () => ({ state: "granted" })),
      },
    });
    const onInterrupt = vi.fn();
    const controller = createVoiceActivityInterruptController({
      onInterrupt,
      createCapture: fake.createCapture as any,
    });

    await expect(controller.start()).resolves.toBe(true);
    expect(controller.isArmed()).toBe(true);
    expect(fake.capture.start).toHaveBeenCalledTimes(1);
    expect(onInterrupt).not.toHaveBeenCalled();
  });

  it("stops capture before interrupting and handles speech onset once", async () => {
    const fake = createFakeCapture();
    vi.stubGlobal("navigator", {
      permissions: {
        query: vi.fn(async () => ({ state: "granted" })),
      },
    });
    const order: string[] = [];
    fake.capture.stop.mockImplementation(async () => {
      order.push("capture-stopped");
    });
    const onInterrupt = vi.fn(() => {
      order.push("tts-interrupted");
    });
    const controller = createVoiceActivityInterruptController({
      onInterrupt,
      createCapture: fake.createCapture as any,
    });

    await controller.start();
    fake.emit({ type: "speechstart", at: 10 });
    fake.emit({ type: "speechstart", at: 20 });
    await Promise.resolve();
    await Promise.resolve();

    expect(fake.capture.stop).toHaveBeenCalledTimes(1);
    expect(onInterrupt).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["capture-stopped", "tts-interrupted"]);
    expect(controller.isArmed()).toBe(false);
  });

  it("does not request permission or start capture when permission is not granted", async () => {
    const fake = createFakeCapture();
    vi.stubGlobal("navigator", {
      permissions: {
        query: vi.fn(async () => ({ state: "prompt" })),
      },
    });
    const controller = createVoiceActivityInterruptController({
      onInterrupt: vi.fn(),
      createCapture: fake.createCapture as any,
    });

    await expect(controller.start()).resolves.toBe(false);
    expect(fake.createCapture).not.toHaveBeenCalled();
    expect(fake.capture.start).not.toHaveBeenCalled();
  });

  it("disarms safely when stopped before speech onset", async () => {
    const fake = createFakeCapture();
    vi.stubGlobal("navigator", {
      permissions: {
        query: vi.fn(async () => ({ state: "granted" })),
      },
    });
    const onInterrupt = vi.fn();
    const controller = createVoiceActivityInterruptController({
      onInterrupt,
      createCapture: fake.createCapture as any,
    });

    await controller.start();
    await controller.stop();
    fake.emit({ type: "speechstart", at: 10 });
    expect(controller.isArmed()).toBe(false);
    expect(fake.capture.stop).toHaveBeenCalledTimes(1);
    expect(onInterrupt).not.toHaveBeenCalled();
  });

  it("does not arm after a pending permission check is cancelled", async () => {
    const fake = createFakeCapture();
    let resolvePermission!: (status: PermissionStatus) => void;
    const query = vi.fn(() => new Promise<PermissionStatus>((resolve) => {
      resolvePermission = resolve;
    }));
    vi.stubGlobal("navigator", { permissions: { query } });
    const controller = createVoiceActivityInterruptController({
      onInterrupt: vi.fn(),
      createCapture: fake.createCapture as any,
    });

    const starting = controller.start();
    await controller.stop();
    resolvePermission({ state: "granted" } as PermissionStatus);

    await expect(starting).resolves.toBe(false);
    expect(fake.createCapture).not.toHaveBeenCalled();
    expect(controller.isArmed()).toBe(false);
  });

  it("shares one pending start instead of opening duplicate microphone streams", async () => {
    const fake = createFakeCapture();
    let resolvePermission!: (status: PermissionStatus) => void;
    const query = vi.fn(() => new Promise<PermissionStatus>((resolve) => {
      resolvePermission = resolve;
    }));
    vi.stubGlobal("navigator", { permissions: { query } });
    const controller = createVoiceActivityInterruptController({
      onInterrupt: vi.fn(),
      createCapture: fake.createCapture as any,
    });

    const first = controller.start();
    const second = controller.start();
    resolvePermission({ state: "granted" } as PermissionStatus);

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(fake.createCapture).toHaveBeenCalledTimes(1);
    expect(fake.capture.start).toHaveBeenCalledTimes(1);
  });

  it("uses a previously confirmed ASR microphone grant when Permissions API is absent", async () => {
    const fake = createFakeCapture();
    vi.stubGlobal("navigator", {});
    const controller = createVoiceActivityInterruptController({
      onInterrupt: vi.fn(),
      hasPriorMicGrant: () => true,
      createCapture: fake.createCapture as any,
    });

    await expect(controller.start()).resolves.toBe(true);
    expect(fake.createCapture).toHaveBeenCalledTimes(1);
    expect(fake.capture.start).toHaveBeenCalledTimes(1);
  });

  it("stays disabled when the browser cannot query microphone permission", async () => {
    vi.stubGlobal("navigator", {});
    const createCapture = vi.fn();
    const controller = createVoiceActivityInterruptController({
      onInterrupt: vi.fn(),
      createCapture: createCapture as any,
    });

    await expect(controller.start()).resolves.toBe(false);
    expect(createCapture).not.toHaveBeenCalled();
  });
});
