'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Delay below-the-fold recommendation requests until a section is near view.
 * The observer disconnects after the first intersection because the query
 * cache owns subsequent refreshes; this hook only controls first activation.
 */
export function useCinemaLobbyVisibility<T extends HTMLElement>(enabled = true) {
  const ref = useRef<T | null>(null);
  const [isNearViewport, setIsNearViewport] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    const element = ref.current;
    if (!element) return;

    if (typeof IntersectionObserver === 'undefined') {
      setIsNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setIsNearViewport(true);
        observer.disconnect();
      },
      { rootMargin: '480px 0px' },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled]);

  return { ref, isNearViewport };
}
