'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import {
  applyAttributes,
  attachImageAuditRuntime,
  attachPageLifecycle,
  attachVoiceOverRuntime,
  decideAfterInterruption,
  createSession,
  isIpadClassDevice,
  parseRoute,
  projectAttributes,
  reconcilePlayerRoute,
  resolveCinemaActivation,
  setActivation,
  setVoiceOverState,
  type ExperienceSession,
} from '@/lib/ipad-cinema';

/**
 * Sole writer of iPad cinema navigation attributes.
 * iPhone and desktop never match the device check, so their chrome is left alone.
 * This pass does not hide the existing dock: the capsule visual lands with the homepage.
 */
export function IpadCinemaContract() {
  const pathname = usePathname() || '/';
  const sessionRef = useRef<ExperienceSession>(createSession());

  useEffect(() => {
    let imageAudit: ReturnType<typeof attachImageAuditRuntime> | null = null;
    const apply = () => {
      const activation = resolveCinemaActivation(
        isIpadClassDevice({
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          maxTouchPoints: navigator.maxTouchPoints || 0,
        }),
        document.documentElement.clientWidth,
      );
      const route = parseRoute(pathname, window.location.search);
      let session = setActivation(sessionRef.current, activation).session;
      session = reconcilePlayerRoute(session, route).session;
      sessionRef.current = session;
      applyAttributes(document.documentElement, projectAttributes(session, route));
      imageAudit?.audit();
    };

    apply();
    imageAudit = attachImageAuditRuntime({
      root: document,
      isLive: () => sessionRef.current.activation !== 'inactive' && document.visibilityState === 'visible' && navigator.onLine !== false,
      onIssue: issue => document.dispatchEvent(new CustomEvent('ipad-cinema:image-audit-issue', { detail: issue })),
    });
    const voiceOver = attachVoiceOverRuntime({
      resolveElement: focusId => Array.from(document.querySelectorAll<HTMLElement>('[data-ipad-focus-id]'))
        .find(element => element.dataset.ipadFocusId === focusId) ?? null,
      onState: state => { sessionRef.current = setVoiceOverState(sessionRef.current, state).session; },
      onFocus: focusId => document.dispatchEvent(new CustomEvent('ipad-cinema:voiceover-focus', { detail: { focusId } })),
    });
    const onFocusRequest = (event: Event) => {
      const focusId = (event as CustomEvent<{ focusId?: string }>).detail?.focusId;
      if (!focusId) return;
      void voiceOver.moveFocus(focusId).then(result => document.dispatchEvent(
        new CustomEvent('ipad-cinema:focus-result', { detail: { focusId, ...result } }),
      ));
    };
    const onInterruption = (event: Event) => {
      const detail = (event as CustomEvent<{
        kind: 'incoming-call' | 'audio-route-change' | 'app-background' | 'system-modal';
        resource: { valid: boolean; positionResumable: boolean };
      }>).detail;
      if (!detail?.kind || !detail.resource) return;
      const decision = decideAfterInterruption(detail.kind, detail.resource);
      document.dispatchEvent(new CustomEvent('ipad-cinema:resume-decision', { detail: { kind: detail.kind, decision } }));
    };
    document.addEventListener('ipad-cinema:focus-request', onFocusRequest);
    document.addEventListener('ipad-cinema:system-interruption', onInterruption);
    const lifecycle = attachPageLifecycle(window, transition => {
      imageAudit?.setLive(
        sessionRef.current.activation !== 'inactive'
        && document.visibilityState === 'visible'
        && navigator.onLine !== false
        && transition !== 'to-background'
        && transition !== 'offline',
      );
    });
    window.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('resize', apply);
      lifecycle.detach();
      imageAudit?.detach();
      voiceOver.detach();
      document.removeEventListener('ipad-cinema:focus-request', onFocusRequest);
      document.removeEventListener('ipad-cinema:system-interruption', onInterruption);
    };
  }, [pathname]);

  return null;
}
