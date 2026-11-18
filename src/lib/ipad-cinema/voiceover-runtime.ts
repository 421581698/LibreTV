import { requestAccessibilityFocus, type VoiceOverBridge, type VoiceOverState } from './voiceover';

export function attachVoiceOverRuntime(args: {
  bridge?: VoiceOverBridge | null;
  resolveElement?: (focusId: string) => { focus?: () => void } | null;
  onState?: (state: VoiceOverState) => void;
  onFocus?: (focusId: string) => void;
}) {
  let detached = false;
  let state: VoiceOverState = 'unknown';
  const setState = (next: VoiceOverState) => {
    if (!detached && state !== next) {
      state = next;
      args.onState?.(next);
    }
  };

  try {
    const result = args.bridge?.isRunning?.();
    if (typeof result === 'boolean') setState(result ? 'running' : 'stopped');
    else if (result && typeof (result as Promise<boolean>).then === 'function') {
      void (result as Promise<boolean>)
        .then(value => setState(value ? 'running' : 'stopped'))
        .catch(() => setState('unknown'));
    }
  } catch {
    setState('unknown');
  }

  let unsubscribe: (() => void) | void;
  try {
    unsubscribe = args.bridge?.subscribe?.(event => {
      if (detached) return;
      if (event.type === 'running') setState(event.running ? 'running' : 'stopped');
      else args.onFocus?.(event.focusId);
    });
  } catch {
    unsubscribe = undefined;
  }

  return {
    getState: () => state,
    async moveFocus(focusId: string) {
      if (detached) return { delivered: false, via: 'none' as const, confirmed: false };
      return requestAccessibilityFocus({
        focusId,
        bridge: args.bridge,
        resolveElement: args.resolveElement,
      });
    },
    detach() {
      if (detached) return;
      detached = true;
      try {
        if (typeof unsubscribe === 'function') unsubscribe();
      } catch {
        // A faulty native bridge must not prevent the host from cleaning up.
      }
    },
  };
}
