import { requestAccessibilityFocus, type VoiceOverBridge, type VoiceOverState } from './voiceover';
export function attachVoiceOverRuntime(args: {
  bridge?: VoiceOverBridge | null;
  resolveElement?: (focusId: string) => { focus?: () => void } | null;
  onState?: (state: VoiceOverState) => void;
  onFocus?: (focusId: string) => void;
}) {
  let detached = false;
  let state: VoiceOverState = 'unknown';
  const setState = (next: VoiceOverState) => { if (!detached && state !== next) { state = next; args.onState?.(next); } };
  try {
    const result = args.bridge?.isRunning?.();
    if (typeof result === 'boolean') setState(result ? 'running' : 'stopped');
    else if (result && typeof (result as Promise<boolean>).then === 'function') {
      void (result as Promise<boolean>).then(v => setState(v ? 'running' : 'stopped')).catch(() => setState('unknown'));
    }
  } catch { setState('unknown'); }
  const unsubscribe = args.bridge?.subscribe?.(event => {
    if (detached) return;
    if (event.type === 'running') setState(event.running ? 'running' : 'stopped');
    else args.onFocus?.(event.focusId);
  });
  return {
    getState: () => state,
    moveFocus: (focusId: string) => requestAccessibilityFocus({ focusId, bridge: args.bridge, resolveElement: args.resolveElement }),
    detach() { if (detached) return; detached = true; if (typeof unsubscribe === 'function') unsubscribe(); },
  };
}
