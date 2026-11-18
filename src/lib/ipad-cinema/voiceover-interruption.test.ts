import { describe, expect, it, vi } from 'vitest';
import { parseFocusId, requestAccessibilityFocus } from './voiceover';
import { attachInterruptionLifecycle, decideAfterInterruption } from './interruption';
describe('VoiceOver focus bridge', () => {
  it('parses stable region focus identifiers', () => {
    expect(parseFocusId('region:poster-rail:index:3')).toEqual({ regionId: 'poster-rail', index: 3 });
    expect(parseFocusId('region:poster-rail:index:-1')).toBeNull();
  });
  it('distinguishes confirmed bridge focus from DOM fallback', async () => {
    await expect(requestAccessibilityFocus({ focusId: 'x', bridge: { moveFocus: () => true } }))
      .resolves.toEqual({ delivered: true, via: 'bridge', confirmed: true });
    const focus = vi.fn();
    await expect(requestAccessibilityFocus({ focusId: 'x', resolveElement: () => ({ focus }) }))
      .resolves.toEqual({ delivered: true, via: 'dom', confirmed: false });
    expect(focus).toHaveBeenCalledOnce();
  });
});
describe('interruption lifecycle', () => {
  it('emits unmount exactly once even when detached repeatedly', () => {
    const listener = vi.fn();
    const onEvent = vi.fn();
    const lifecycle = attachInterruptionLifecycle({ subscribe: cb => { listener.mockImplementation(cb); return vi.fn(); }, onEvent });
    lifecycle.detach(); lifecycle.detach();
    expect(onEvent).toHaveBeenCalledTimes(1);
    listener('incoming-call');
    expect(onEvent).toHaveBeenCalledTimes(1);
  });
  it('requires confirmation for a valid resource after an incoming call', () => {
    expect(decideAfterInterruption('incoming-call', { valid: true, positionResumable: true })).toBe('ask-user');
  });
  it('reloads only when a resumable position exists but the resource is invalid', () => {
    expect(decideAfterInterruption('incoming-call', { valid: false, positionResumable: true })).toBe('reload-then-resume');
    expect(decideAfterInterruption('incoming-call', { valid: false, positionResumable: false })).toBe('none');
  });
});
