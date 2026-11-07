import { describe, expect, it } from "vitest";
import { smoothFridayEnergy } from "./friday-orb-core.js";

describe("FridayOrb audio energy smoothing", () => {
  it("ramps up smoothly instead of snapping to a noisy input sample", () => {
    const next = smoothFridayEnergy(0, 1, 1 / 30);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(0.5);
  });

  it("releases more slowly than it attacks to avoid visual flicker", () => {
    const attack = smoothFridayEnergy(0, 1, 1 / 30);
    const release = smoothFridayEnergy(1, 0, 1 / 30);
    expect(1 - release).toBeLessThan(attack);
    expect(release).toBeGreaterThan(0);
  });

  it("clamps invalid time steps and energy targets", () => {
    expect(smoothFridayEnergy(0.4, 4, 1)).toBeLessThan(1);
    expect(smoothFridayEnergy(0.4, -1, -1)).toBe(0.4);
  });
});
