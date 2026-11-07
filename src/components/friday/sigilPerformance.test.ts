import { describe, expect, it } from "vitest";
import { getSigilFrameInterval, getSigilParticleCount } from "./sigilPerformance";

describe("Friday sigil rendering budget", () => {
  it("uses a small particle budget for the floating 32px orb", () => {
    expect(getSigilParticleCount(32)).toBe(80);
  });

  it("reduces particle count on mobile while retaining richer desktop detail", () => {
    expect(getSigilParticleCount(390)).toBe(240);
    expect(getSigilParticleCount(800)).toBe(520);
  });

  it("caps mobile rendering at 30fps and desktop at 45fps", () => {
    expect(getSigilFrameInterval(390, false)).toBeCloseTo(1000 / 30);
    expect(getSigilFrameInterval(800, false)).toBeCloseTo(1000 / 45);
  });

  it("uses a slower frame cadence when reduced motion is enabled", () => {
    expect(getSigilFrameInterval(800, true)).toBe(100);
  });
});
