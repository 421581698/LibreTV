import { describe, expect, it } from "vitest";

import { isCompletedFridayRequestTransition, shouldSpeakFridayResponse } from "./useFridayResponseController";

describe("isCompletedFridayRequestTransition", () => {
  it("accepts a submitted request that becomes ready", () => {
    expect(isCompletedFridayRequestTransition("submitted", "ready")).toBe(true);
  });

  it("accepts a streaming request that becomes ready", () => {
    expect(isCompletedFridayRequestTransition("streaming", "ready")).toBe(true);
  });

  it("does not treat an already-ready session as a new response", () => {
    expect(isCompletedFridayRequestTransition("ready", "ready")).toBe(false);
  });

  it("does not treat a cancelled or errored request as completed", () => {
    expect(isCompletedFridayRequestTransition("submitted", "error")).toBe(false);
    expect(isCompletedFridayRequestTransition("streaming", "error")).toBe(false);
  });

  it("does not treat a request that is still streaming as completed", () => {
    expect(isCompletedFridayRequestTransition("submitted", "streaming")).toBe(false);
  });
});

describe("shouldSpeakFridayResponse", () => {
  it("speaks a completed response for a homepage voice session with the panel closed", () => {
    expect(shouldSpeakFridayResponse("streaming", "ready", false, true)).toBe(true);
  });

  it("does not speak when the panel is closed and no voice session is active", () => {
    expect(shouldSpeakFridayResponse("streaming", "ready", false, false)).toBe(false);
  });

  it("keeps response playback enabled for an open panel", () => {
    expect(shouldSpeakFridayResponse("submitted", "ready", true, false)).toBe(true);
  });

  it("does not replay a response without a new completion transition", () => {
    expect(shouldSpeakFridayResponse("ready", "ready", true, true)).toBe(false);
  });
});
