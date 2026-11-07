import { describe, expect, it } from "vitest";

import { isCompletedFridayRequestTransition } from "./useFridayResponseController";

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
