import { describe, expect, it } from 'vitest';
import {
  activePointerSignals,
  chromeForPage,
  IPAD_EDITION_TOKENS,
  isIpadEditionDevice,
  minimumScrollDelta,
  moveIndex,
  preserveIndex,
  resolveCinemaActivation,
  resolvedFocusAxis,
  tokensWithinLimits,
} from './index';

describe('LibreTV iPad Edition foundation', () => {
  it('recognizes iPadOS including desktop mode, without classifying unrelated devices', () => {
    expect(isIpadEditionDevice({ userAgent: 'iPad', platform: 'iPad', maxTouchPoints: 5 })).toBe(true);
    expect(isIpadEditionDevice({ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(isIpadEditionDevice({ userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 5 })).toBe(false);
    expect(isIpadEditionDevice({ userAgent: 'Windows', platform: 'Win32', maxTouchPoints: 10 })).toBe(false);
  });

  it('uses the agreed compact and stage width thresholds', () => {
    expect(resolveCinemaActivation(true, 699)).toBe('inactive');
    expect(resolveCinemaActivation(true, 700)).toBe('compact');
    expect(resolveCinemaActivation(true, 1023)).toBe('compact');
    expect(resolveCinemaActivation(true, 1024)).toBe('stage');
    expect(resolveCinemaActivation(true, 1600)).toBe('stage');
    expect(resolveCinemaActivation(false, 1600)).toBe('inactive');
  });

  it('keeps the V4.2 sidebar and floating capsule behavior', () => {
    expect(chromeForPage('home', 'stage', 'baseline-visible')).toEqual({
      sidebar: 'visible', capsule: 'visible', back: 'hidden',
    });
    expect(chromeForPage('home', 'compact', 'baseline-visible')).toEqual({
      sidebar: 'hidden', capsule: 'visible', back: 'hidden',
    });
    expect(chromeForPage('detail', 'stage', 'baseline-visible')).toEqual({
      sidebar: 'hidden', capsule: 'visible', back: 'independent',
    });
  });

  it('preserves focus positions and scrolls only by the overflow', () => {
    expect(preserveIndex(5, 3)).toBe(2);
    expect(moveIndex(2, 1, 3)).toBe(2);
    expect(minimumScrollDelta({ viewportStart: 0, viewportSize: 300, itemStart: 280, itemSize: 80 })).toBe(60);
    expect(resolvedFocusAxis('compact', 'horizontal')).toBe('vertical');
    expect(resolvedFocusAxis('stage', 'horizontal')).toBe('horizontal');
  });

  it('keeps pointer signals independent and tokens inside the frozen acceptance range', () => {
    expect(activePointerSignals({ touch: true, hover: false, focus: true, pressed: false })).toEqual(['touch', 'focus']);
    expect(tokensWithinLimits()).toBe(true);
    expect(IPAD_EDITION_TOKENS.focusScale).toBe(1.06);
    expect(IPAD_EDITION_TOKENS.glassBlurPx).toBe(24);
  });
});
