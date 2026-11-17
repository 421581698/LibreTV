import { describe, expect, it } from 'vitest';
import { hasTouchGestureMoved } from './touch-gesture';

describe('hasTouchGestureMoved', () => {
  it('keeps a stationary press eligible for long-press behavior', () => {
    expect(hasTouchGestureMoved(10, 20, 15, 24)).toBe(false);
  });

  it('cancels long-press behavior after a meaningful horizontal or vertical move', () => {
    expect(hasTouchGestureMoved(10, 20, 24, 20)).toBe(true);
    expect(hasTouchGestureMoved(10, 20, 10, 34)).toBe(true);
  });

  it('uses a strict threshold and supports a custom tolerance', () => {
    expect(hasTouchGestureMoved(0, 0, 12, 0)).toBe(false);
    expect(hasTouchGestureMoved(0, 0, 13, 0)).toBe(true);
    expect(hasTouchGestureMoved(0, 0, 6, 0, 5)).toBe(true);
  });
});
