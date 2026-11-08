import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createThrottledStorage,
  flushPendingPersist,
  getLastPersistError,
} from "./persist-storage";

describe("throttled persistence error reporting", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("emits a persistence error when localStorage rejects a write", () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal("localStorage", {
      setItem: () => { throw new DOMException("quota exceeded", "QuotaExceededError"); },
      getItem: () => null,
      removeItem: () => undefined,
    });

    const storage = createThrottledStorage();
    storage.setItem("libretv-settings", JSON.stringify({ state: { theme: "dark" } }));
    flushPendingPersist();

    expect(getLastPersistError()).toContain("quota exceeded");
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "libretv:persistence-error",
      detail: expect.objectContaining({ store: "localStorage" }),
    }));
  });

  it("clears the last persistence error after a successful write", () => {
    const dispatchEvent = vi.fn();
    const values = new Map<string, string>();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal("localStorage", {
      setItem: (key: string, value: string) => { values.set(key, value); },
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => { values.delete(key); },
    });

    const storage = createThrottledStorage();
    storage.setItem("libretv-settings", "ok");
    flushPendingPersist();

    expect(getLastPersistError()).toBeNull();
    expect(values.get("libretv-settings")).toBe("ok");
  });
});
