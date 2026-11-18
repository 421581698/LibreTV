export type InterruptionKind = 'incoming-call' | 'audio-route-change' | 'app-background' | 'system-modal';
export type ResourceFacts = { readonly valid: boolean; readonly positionResumable: boolean };
export type ResumeDecision = 'none' | 'ask-user' | 'reload-then-resume' | 'resume';
export function decideAfterInterruption(kind: InterruptionKind, resource: ResourceFacts): ResumeDecision {
  if (kind === 'incoming-call') return resource.valid ? 'ask-user' : resource.positionResumable ? 'reload-then-resume' : 'none';
  if (kind === 'audio-route-change') return resource.valid ? 'resume' : 'none';
  if (kind === 'app-background' || kind === 'system-modal') return resource.valid ? 'resume' : resource.positionResumable ? 'reload-then-resume' : 'none';
  return 'none';
}
export type InterruptionEvent = { readonly type: 'component-unmount' } | { readonly type: 'interruption'; readonly kind: InterruptionKind };
/** Idempotent lifecycle adapter: teardown and unmount notification happen once. */
export function attachInterruptionLifecycle(args: {
  subscribe: (listener: (kind: InterruptionKind) => void) => (() => void);
  onEvent: (event: InterruptionEvent) => void;
}) {
  let detached = false;
  const unsubscribe = args.subscribe(kind => { if (!detached) args.onEvent({ type: 'interruption', kind }); });
  return { detach() {
    if (detached) return;
    detached = true;
    try { unsubscribe(); } finally { args.onEvent({ type: 'component-unmount' }); }
  } };
}
