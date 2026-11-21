import { describe, expect, it } from 'vitest';
import { isCurrentHlsCallback } from './hls-mse-backend';
import { createPlaybackSessionIdentity } from './session-identity';
import type Hls from 'hls.js';

describe('HLS callback generation guard', () => {
  const firstIdentity = createPlaybackSessionIdentity('session', 1);
  const secondIdentity = createPlaybackSessionIdentity('session', 2);
  const firstInstance = {} as Hls;
  const secondInstance = {} as Hls;

  it('accepts callbacks from the active instance and exact active identity', () => {
    expect(isCurrentHlsCallback(firstInstance, firstInstance, firstIdentity, firstIdentity, false)).toBe(true);
  });

  it('rejects callbacks from an HLS instance that has been replaced', () => {
    expect(isCurrentHlsCallback(secondInstance, firstInstance, secondIdentity, firstIdentity, false)).toBe(false);
  });

  it('rejects callbacks from an earlier source generation', () => {
    expect(isCurrentHlsCallback(secondInstance, secondInstance, secondIdentity, firstIdentity, false)).toBe(false);
  });

  it('rejects callbacks after backend disposal', () => {
    expect(isCurrentHlsCallback(firstInstance, firstInstance, firstIdentity, firstIdentity, true)).toBe(false);
  });

  it('rejects callbacks when there is no active HLS instance', () => {
    expect(isCurrentHlsCallback(null, firstInstance, firstIdentity, firstIdentity, false)).toBe(false);
  });
});
