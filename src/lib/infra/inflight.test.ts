import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelInflight,
  registerInflight,
  unregisterInflight,
} from "./inflight";

describe("inflight cancellation registry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies a cancellation that arrives just before request registration", () => {
    const requestId = "race-before-register";
    expect(cancelInflight(requestId, "user-a")).toBe("pending");

    const controller = new AbortController();
    expect(registerInflight(requestId, "user-a", controller)).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    unregisterInflight(requestId);
  });

  it("does not apply another user's pending cancellation", () => {
    const requestId = "race-wrong-owner";
    expect(cancelInflight(requestId, "user-a")).toBe("pending");

    const controller = new AbortController();
    expect(registerInflight(requestId, "user-b", controller)).toBe(true);
    expect(controller.signal.aborted).toBe(false);
    unregisterInflight(requestId);
  });

  it("expires unmatched cancellation placeholders", () => {
    vi.useFakeTimers();
    const requestId = "race-expired";
    expect(cancelInflight(requestId, "user-a")).toBe("pending");
    vi.advanceTimersByTime(5_001);

    const controller = new AbortController();
    expect(registerInflight(requestId, "user-a", controller)).toBe(true);
    expect(controller.signal.aborted).toBe(false);
    unregisterInflight(requestId);
  });

  it("bounds the number of unmatched cancellation placeholders", () => {
    for (let index = 0; index < 1_001; index += 1) {
      expect(cancelInflight(`pending-${index}`, "user-a")).toBe("pending");
    }

    const oldest = new AbortController();
    registerInflight("pending-0", "user-a", oldest);
    expect(oldest.signal.aborted).toBe(false);
    unregisterInflight("pending-0");

    const newest = new AbortController();
    registerInflight("pending-1000", "user-a", newest);
    expect(newest.signal.aborted).toBe(true);
    unregisterInflight("pending-1000");
  });

  it("only lets the owning user cancel an active request", () => {
    const controller = new AbortController();
    registerInflight("active-request", "user-a", controller);

    expect(cancelInflight("active-request", "user-b")).toBe("forbidden");
    expect(controller.signal.aborted).toBe(false);
    expect(cancelInflight("active-request", "user-a")).toBe("ok");
    expect(controller.signal.aborted).toBe(true);
    unregisterInflight("active-request");
  });
});
