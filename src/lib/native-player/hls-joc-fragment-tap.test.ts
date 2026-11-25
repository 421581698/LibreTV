import { describe, expect, it, vi } from 'vitest';
import { HlsJocFragmentTap, type HlsFragmentLoadedLike } from './hls-joc-fragment-tap';

function loaded(
  sn: number | string,
  type: string = 'main',
  payload: Uint8Array = new Uint8Array([1, 2, 3]),
): HlsFragmentLoadedLike {
  return { frag: { sn, type, level: 0 }, payload };
}

describe('HlsJocFragmentTap', () => {
  it('forwards init and media payloads for main/audio tracks', () => {
    const onFragment = vi.fn();
    const tap = new HlsJocFragmentTap({ isCurrent: () => true, onFragment });
    tap.handle('frag-loaded', loaded('initSegment'));
    tap.handle('frag-loaded', loaded(7, 'audio'));
    expect(onFragment).toHaveBeenCalledTimes(2);
    expect(onFragment.mock.calls[0][0]).toMatchObject({ kind: 'init', trackType: 'main', sequence: 'initSegment' });
    expect(onFragment.mock.calls[1][0]).toMatchObject({ kind: 'media', trackType: 'audio', sequence: 7 });
  });

  it('ignores non-audio/video fragment types and stale generations', () => {
    const onFragment = vi.fn();
    const tap = new HlsJocFragmentTap({ isCurrent: () => false, onFragment });
    tap.handle('frag-loaded', loaded(1));
    expect(onFragment).not.toHaveBeenCalled();
    const currentTap = new HlsJocFragmentTap({ isCurrent: () => true, onFragment });
    currentTap.handle('frag-loaded', loaded(2, 'subtitle'));
    expect(onFragment).not.toHaveBeenCalled();
  });

  it('rejects missing metadata, missing payload, empty payload and oversized payload', () => {
    const onFragment = vi.fn();
    const onRejected = vi.fn();
    const tap = new HlsJocFragmentTap({ isCurrent: () => true, onFragment, onRejected, maxFragmentBytes: 4 });
    tap.handle('frag-loaded', {});
    tap.handle('frag-loaded', { frag: { type: 'main', level: 0, sn: 1 } });
    tap.handle('frag-loaded', loaded(2, 'main', new Uint8Array()));
    tap.handle('frag-loaded', loaded(3, 'main', new Uint8Array(5)));
    expect(onFragment).not.toHaveBeenCalled();
    expect(onRejected).toHaveBeenCalledTimes(4);
  });

  it('copies payload bytes and stops forwarding after dispose', () => {
    const onFragment = vi.fn();
    const payload = new Uint8Array([4, 5, 6]);
    const tap = new HlsJocFragmentTap({ isCurrent: () => true, onFragment });
    tap.handle('frag-loaded', loaded(1, 'main', payload));
    payload[0] = 99;
    expect(onFragment.mock.calls[0][0].bytes[0]).toBe(4);
    tap.dispose();
    tap.handle('frag-loaded', loaded(2));
    expect(onFragment).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid byte limits', () => {
    expect(() => new HlsJocFragmentTap({ isCurrent: () => true, onFragment: vi.fn(), maxFragmentBytes: 0 }))
      .toThrow('positive integer');
  });
});
