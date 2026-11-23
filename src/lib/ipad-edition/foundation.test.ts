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
  resolveEnvironmentProfile,
  selectRenderPolicy,
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

  it('adapts the shared environment profile to appearance, contrast and backdrop luminance', () => {
    const dark = resolveEnvironmentProfile({
      appearance: 'system', systemDark: true, contrast: 'normal',
      reducedTransparency: false, reducedMotion: false, backdropLuminance: 0.8,
    });
    expect(dark.colorScheme).toBe('dark');
    expect(dark.scrimOpacity).toBeGreaterThan(0.2);
    expect(dark.motionEnabled).toBe(true);
    const accessible = resolveEnvironmentProfile({
      appearance: 'light', systemDark: false, contrast: 'more',
      reducedTransparency: true, reducedMotion: true, ambientLux: 12,
    });
    expect(accessible.contrast).toBe('high');
    expect(accessible.blurPx).toBe(0);
    expect(accessible.glassOpacity).toBeGreaterThan(0.9);
    expect(accessible.motionEnabled).toBe(false);
    expect(accessible.ambientClass).toBe('dim');
  });

  it('selects a capable renderer and safely degrades for low-power/accessibility modes', () => {
    expect(selectRenderPolicy({
      css: true, svg: true, canvas2d: true, webgl: true,
      reducedMotion: false, reducedTransparency: false, lowPower: false,
    }).backend).toBe('webgl');
    const fallback = selectRenderPolicy({
      css: true, svg: true, canvas2d: true, webgl: true,
      reducedMotion: true, reducedTransparency: true, lowPower: true,
    });
    expect(fallback.backend).toBe('svg');
    expect(fallback.allowDisplacement).toBe(false);
    expect(fallback.allowContinuousAnimation).toBe(false);
  });

  it('keeps pointer signals independent and tokens inside the frozen acceptance range', () => {
    expect(activePointerSignals({ touch: true, hover: false, focus: true, pressed: false })).toEqual(['touch', 'focus']);
    expect(tokensWithinLimits()).toBe(true);
    expect(IPAD_EDITION_TOKENS.focusScale).toBe(1.06);
    expect(IPAD_EDITION_TOKENS.glassBlurPx).toBe(24);
  });
});
