'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import {
  applyAttributes,
  attachImageAuditRuntime,
  attachPageLifecycle,
  createSession,
  isIpadClassDevice,
  parseRoute,
  projectAttributes,
  reconcilePlayerRoute,
  resolveCinemaActivation,
  setActivation,
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
    };

    apply();
    const imageAudit = attachImageAuditRuntime({
      root: document,
      onIssue: issue => document.dispatchEvent(new CustomEvent('ipad-cinema:image-audit-issue', { detail: issue })),
    });
    const lifecycle = attachPageLifecycle(window, transition => {
      if (transition === 'to-background' || transition === 'offline') imageAudit.setLive(false);
      else imageAudit.setLive(true);
    });
    window.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('resize', apply);
      lifecycle.detach();
      imageAudit.detach();
    };
  }, [pathname]);

  return null;
}
