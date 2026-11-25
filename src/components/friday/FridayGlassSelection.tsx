'use client';

import { useLayoutEffect, useRef } from 'react';
import { useFridayGlass } from './FridayGlassProvider';

/** Moves one decorative highlight between native navigation targets. */
export function FridayGlassSelection({ selection }: { selection: string }) {
  const marker = useRef<HTMLSpanElement>(null);
  const last = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const { reducedMotion } = useFridayGlass();

  useLayoutEffect(() => {
    const layer = marker.current;
    const group = layer?.parentElement;
    if (!layer || !group) return;
    const current = group.querySelector<HTMLElement>('[aria-expanded="true"], [aria-current="page"]');
    if (!current) {
      layer.hidden = true;
      last.current = null;
      return;
    }

    let movement: Animation | undefined;
    const position = (animate: boolean) => {
      const previous = last.current;
      const next = {
        x: current.offsetLeft,
        y: current.offsetTop,
        width: current.offsetWidth,
        height: current.offsetHeight,
      };
      layer.hidden = !next.width || !next.height;
      layer.style.transform = `translate(${next.x}px, ${next.y}px)`;
      layer.style.width = `${next.width}px`;
      layer.style.height = `${next.height}px`;
      last.current = next;
      if (!animate || reducedMotion || !previous || layer.hidden ||
          (previous.x === next.x && previous.y === next.y) || typeof layer.animate !== 'function') return;

      movement = layer.animate([
        { transform: `translate(${previous.x}px, ${previous.y}px) scaleX(${previous.width / next.width})` },
        { transform: `translate(${next.x}px, ${next.y}px) scaleX(1.12)`, offset: .74 },
        { transform: `translate(${next.x}px, ${next.y}px)` },
      ], { duration: 280, easing: 'cubic-bezier(.22,.8,.32,1)' });
    };

    position(true);
    if (typeof ResizeObserver === 'undefined') return () => movement?.cancel();
    const observer = new ResizeObserver(() => position(false));
    observer.observe(group);
    observer.observe(current);
    return () => {
      movement?.cancel();
      observer.disconnect();
    };
  }, [selection, reducedMotion]);

  return <span ref={marker} hidden className="friday-glass-selection" aria-hidden="true" />;
}
