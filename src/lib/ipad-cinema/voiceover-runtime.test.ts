import { describe, expect, it, vi } from 'vitest';
import { attachVoiceOverRuntime } from './voiceover-runtime';

describe('VoiceOver runtime lifecycle', () => {
  it('does not deliver focus after detach', async () => {
    const moveFocus = vi.fn(() => true);
    const focus = vi.fn();
    const runtime = attachVoiceOverRuntime({
      bridge: { moveFocus },
      resolveElement: () => ({ focus }),
    });
    runtime.detach();
    await expect(runtime.moveFocus('region:rail:index:0')).resolves.toEqual({
      delivered: false,
      via: 'none',
      confirmed: false,
    });
    expect(moveFocus).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });

  it('contains bridge unsubscribe failures during idempotent teardown', () => {
    const runtime = attachVoiceOverRuntime({
      bridge: { subscribe: () => () => { throw new Error('bridge closed'); } },
    });
    expect(() => runtime.detach()).not.toThrow();
    expect(() => runtime.detach()).not.toThrow();
  });

  it('ignores late asynchronous VoiceOver state after detach', async () => {
    let resolveState!: (running: boolean) => void;
    const isRunning = vi.fn(() => new Promise<boolean>(resolve => { resolveState = resolve; }));
    const onState = vi.fn();
    const runtime = attachVoiceOverRuntime({ bridge: { isRunning }, onState });
    runtime.detach();
    resolveState(true);
    await Promise.resolve();
    expect(onState).not.toHaveBeenCalled();
    expect(runtime.getState()).toBe('unknown');
  });
});
