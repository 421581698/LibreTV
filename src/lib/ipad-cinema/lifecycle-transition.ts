export type LifecycleTransition = 'to-background' | 'to-foreground' | 'offline' | 'online';
/** Deduplicates paired browser signals for one physical transition, while allowing the next cycle. */
export function createLifecycleTransitionDeduper(onTransition: (transition: LifecycleTransition) => void) {
  let last: LifecycleTransition | null = null;
  let detached = false;
  return {
    dispatch(transition: LifecycleTransition) {
      if (detached || last === transition) return false;
      last = transition;
      onTransition(transition);
      return true;
    },
    reset() { last = null; },
    detach() { detached = true; last = null; },
  };
}
export function attachPageLifecycle(target: Window, onTransition: (transition: LifecycleTransition) => void) {
  const deduper = createLifecycleTransitionDeduper(onTransition);
  const visibility = () => deduper.dispatch(target.document.visibilityState === 'hidden' ? 'to-background' : 'to-foreground');
  const pagehide = () => deduper.dispatch('to-background');
  const pageshow = () => deduper.dispatch('to-foreground');
  const offline = () => deduper.dispatch('offline');
  const online = () => deduper.dispatch('online');
  target.document.addEventListener('visibilitychange', visibility);
  target.addEventListener('pagehide', pagehide);
  target.addEventListener('pageshow', pageshow);
  target.addEventListener('offline', offline);
  target.addEventListener('online', online);
  return { detach() {
    target.document.removeEventListener('visibilitychange', visibility);
    target.removeEventListener('pagehide', pagehide);
    target.removeEventListener('pageshow', pageshow);
    target.removeEventListener('offline', offline);
    target.removeEventListener('online', online);
    deduper.detach();
  } };
}
