import { describe, expect, it } from "vitest";

import { isActiveFridayRequest } from "./useFridayRequestLifecycle";

describe("isActiveFridayRequest", () => {
  it("accepts the currently active request", () => {
    expect(isActiveFridayRequest(12, 12)).toBe(true);
  });

  it("rejects a late failure from a superseded request", () => {
    expect(isActiveFridayRequest(12, 13)).toBe(false);
  });

  it("rejects an empty request identity", () => {
    expect(isActiveFridayRequest(0, 0)).toBe(false);
  });
});
