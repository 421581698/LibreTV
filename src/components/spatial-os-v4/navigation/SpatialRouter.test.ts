import { describe, expect, it } from "vitest";
import { isSpatialSpace, resolveSpatialSpace, SPATIAL_SPACES } from "./SpatialRouter";

describe("SpatialRouter", () => {
  it("exposes exactly the four V4 spaces in product order", () => {
    expect(SPATIAL_SPACES).toEqual(["cinematic", "intelligence", "resources", "identity"]);
  });

  it("accepts each known space without requiring route navigation", () => {
    for (const space of SPATIAL_SPACES) expect(isSpatialSpace(space)).toBe(true);
  });

  it("falls back safely for unknown persisted or external values", () => {
    expect(isSpatialSpace("admin")).toBe(false);
    expect(resolveSpatialSpace("admin")).toBe("cinematic");
    expect(resolveSpatialSpace(null, "identity")).toBe("identity");
  });
});
