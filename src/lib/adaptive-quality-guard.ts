export type AdaptiveQualityMode = 'auto' | 'manual';

export type AdaptiveQualityDecision =
  | { action: 'cap'; capLevel: number; nextLevel: number }
  | { action: 'restore' }
  | { action: 'none' };

export interface BufferedFragmentEvidence {
  mode: AdaptiveQualityMode;
  bufferAheadSeconds: number;
  throughputKbps: number;
  mediaBitrateKbps: number;
}

/**
 * A conservative, auto-mode-only guard around hls.js ABR.
 *
 * A waiting event temporarily caps the maximum rendition one step below the
 * current level. The cap is released only after several buffered fragments
 * arrive with both healthy buffer headroom and sustainable measured throughput.
 * Manual quality choices are never overridden.
 */
export class AdaptiveQualityGuard {
  private capLevel = -1;
  private stableFragments = 0;

  get activeCapLevel(): number | null {
    return this.capLevel >= 0 ? this.capLevel : null;
  }

  onStall(input: {
    mode: AdaptiveQualityMode;
    currentLevel: number;
    levelCount: number;
  }): AdaptiveQualityDecision {
    if (input.mode !== 'auto' || input.levelCount < 2 || input.currentLevel <= 0) {
      return { action: 'none' };
    }

    const nextCap = Math.max(0, input.currentLevel - 1);
    const capLevel = this.capLevel < 0 ? nextCap : Math.min(this.capLevel, nextCap);
    if (capLevel === this.capLevel) return { action: 'none' };

    this.capLevel = capLevel;
    this.stableFragments = 0;
    return { action: 'cap', capLevel, nextLevel: capLevel };
  }

  onBufferedFragment(input: BufferedFragmentEvidence): AdaptiveQualityDecision {
    if (input.mode !== 'auto' || this.capLevel < 0) return { action: 'none' };

    const sustainable =
      Number.isFinite(input.bufferAheadSeconds) &&
      input.bufferAheadSeconds >= 12 &&
      Number.isFinite(input.throughputKbps) &&
      Number.isFinite(input.mediaBitrateKbps) &&
      input.mediaBitrateKbps > 0 &&
      input.throughputKbps >= input.mediaBitrateKbps * 1.5;

    this.stableFragments = sustainable ? this.stableFragments + 1 : 0;
    if (this.stableFragments < 3) return { action: 'none' };

    this.reset();
    return { action: 'restore' };
  }

  reset(): void {
    this.capLevel = -1;
    this.stableFragments = 0;
  }
}
