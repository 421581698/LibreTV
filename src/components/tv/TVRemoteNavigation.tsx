'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

type Direction = 'left' | 'right' | 'up' | 'down';

const TV_USER_AGENT = /(?:SMART-TV|SmartTV|Tizen|Web0S|webOS|NetCast|HbbTV|BRAVIA|AFT[A-Z0-9]*|Roku|AppleTV|Android TV|GoogleTV|Viera|PhilipsTV)/i;
const MOBILE_OR_TABLET = /(?:iPhone|iPad|iPod|Android(?!.*TV))/i;
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[role="button"]:not([aria-disabled="true"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function isTelevision(): boolean {
  const ua = navigator.userAgent || '';
  if (TV_USER_AGENT.test(ua)) return true;
  if (MOBILE_OR_TABLET.test(ua)) return false;
  return window.matchMedia('(min-width: 1600px) and (hover: none)').matches;
}

function visibleFocusableElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => {
    if (element.closest('[aria-hidden="true"], [inert]')) return false;
    if (element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true') return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  });
}

export function findDirectionalFocusTarget(
  current: HTMLElement,
  candidates: HTMLElement[],
  direction: Direction,
): HTMLElement | null {
  const origin = current.getBoundingClientRect();
  const ox = origin.left + origin.width / 2;
  const oy = origin.top + origin.height / 2;
  let winner: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (candidate === current) continue;
    const rect = candidate.getBoundingClientRect();
    const dx = rect.left + rect.width / 2 - ox;
    const dy = rect.top + rect.height / 2 - oy;
    const primary = direction === 'left' ? -dx
      : direction === 'right' ? dx
      : direction === 'up' ? -dy : dy;
    if (primary <= 1) continue;
    const secondary = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
    const score = primary + secondary * 1.65 + secondary * secondary / Math.max(primary, 1) * 0.12;
    if (score < bestScore) {
      bestScore = score;
      winner = candidate;
    }
  }
  return winner;
}

export function TVRemoteNavigation() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isTelevision()) return;
    const root = document.documentElement;
    root.classList.add('tv-device');

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const editing = Boolean(target?.closest('input, textarea, select, [contenteditable="true"]'));

      const directions: Record<string, Direction> = {
        ArrowLeft: 'left',
        ArrowRight: 'right',
        ArrowUp: 'up',
        ArrowDown: 'down',
      };
      const direction = directions[event.key];
      if (direction) {
        if (editing) return;
        const candidates = visibleFocusableElements();
        const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const current = active && active !== document.body ? active : null;
        const next = current
          ? findDirectionalFocusTarget(current, candidates, direction)
          : candidates[0] ?? null;
        if (!next) return;
        event.preventDefault();
        next.focus({ preventScroll: true });
        next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        return;
      }

      if (event.key === 'Back' || event.key === 'BrowserBack' || event.key === 'GoBack') {
        if (editing) return;
        event.preventDefault();
        if (pathname !== '/') router.back();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      root.classList.remove('tv-device');
    };
  }, [pathname, router]);

  return null;
}
