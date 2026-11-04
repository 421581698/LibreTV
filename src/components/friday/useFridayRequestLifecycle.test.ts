import { describe, expect, it } from "vitest";
import { shouldStopRequest } from "./useFridayRequestLifecycle";

describe("Friday request cancellation timing", () => {
  it("stops the transport when React has already reported the request as busy", () => {
    expect(shouldStopRequest(true, false)).toBe(true);
  });

  it("stops the transport when a request was synchronously registered before busy rerendered", () => {
    expect(shouldStopRequest(false, true)).toBe(true);
  });

  it("does not stop an idle transport when there is no active request", () => {
    expect(shouldStopRequest(false, false)).toBe(false);
  });

  it("still stops when both busy state and active request are present", () => {
    expect(shouldStopRequest(true, true)).toBe(true);
  });
});
