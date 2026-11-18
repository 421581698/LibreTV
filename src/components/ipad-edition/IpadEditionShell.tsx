'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { LiquidGlassSurface } from '@/components/ui/liquid-glass';

const sidebarNavigation = [
  { label: '主页', href: '/ipad-edition', icon: 'house' },
  { label: '我的', href: '/ipad-edition/library', icon: 'user' },
  { label: '搜索', href: '/ipad-edition/search', icon: 'search' },
] as const;

type NavigationIconName = 'house' | 'user' | 'search' | 'menu' | 'close';

function NavigationIcon({ name }: { name: NavigationIconName }) {
  const common = {
    viewBox: '0 0 24 24',
    className: 'ipad-nav__icon',
    'aria-hidden': true as const,
    focusable: false as const,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  if (name === 'house') {
    return <svg {...common}><path d="m3.5 10 8.5-6.8 8.5 6.8v9.2a1 1 0 0 1-1 1h-5.2v-6.1H9.2v6.1H4.5a1 1 0 0 1-1-1z" /></svg>;
  }
  if (name === 'user') {
    return <svg {...common}><circle cx="12" cy="8" r="3.4" /><path d="M4.7 20c.6-3.5 3.1-5.3 7.3-5.3s6.7 1.8 7.3 5.3" /></svg>;
  }
  if (name === 'search') {
    return <svg {...common}><circle cx="10.7" cy="10.7" r="6.4" /><path d="m15.4 15.4 4.6 4.6" /></svg>;
  }
  if (name === 'close') {
    return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
  }
  return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
}

export function IpadEditionShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '/ipad-edition';
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarDragOffset, setSidebarDragOffset] = useState(0);
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const gestureRef = useRef<{ pointerId: number; startX: number; lastX: number; lastAt: number; width: number; wasOpen: boolean } | null>(null);

  useEffect(() => {
    setSidebarOpen(false);
    setSidebarDragOffset(0);
  }, [pathname]);
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sidebarOpen]);

  const beginSidebarGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' || !event.isPrimary || isChromeHidden) return;
    const sidebar = document.querySelector<HTMLElement>('.ipad-nav__sidebar');
    const width = sidebar?.getBoundingClientRect().width ?? 280;
    const target = event.target as HTMLElement;
    const startedOnSidebar = Boolean(target.closest('.ipad-nav__sidebar'));
    const startedAtEdge = event.clientX <= 24;
    if (sidebarOpen ? !startedOnSidebar : !startedAtEdge) return;
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      lastX: event.clientX,
      lastAt: event.timeStamp,
      width,
      wasOpen: sidebarOpen,
    };
    setSidebarDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveSidebarGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const delta = event.clientX - gesture.startX;
    const offset = gesture.wasOpen ? Math.min(0, Math.max(-gesture.width, delta)) : Math.max(0, Math.min(gesture.width, delta));
    gesture.lastX = event.clientX;
    gesture.lastAt = event.timeStamp;
    setSidebarDragOffset(offset);
    event.preventDefault();
  };

  const finishSidebarGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const delta = event.clientX - gesture.startX;
    const elapsed = Math.max(1, event.timeStamp - gesture.lastAt);
    const velocity = (event.clientX - gesture.lastX) / elapsed;
    const threshold = gesture.width * 0.28;
    const shouldOpen = gesture.wasOpen
      ? !(delta < -threshold || velocity < -0.45)
      : delta > threshold || velocity > 0.45;
    setSidebarOpen(shouldOpen);
    setSidebarDragOffset(0);
    setSidebarDragging(false);
    gestureRef.current = null;
  };

  const cancelSidebarGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (gestureRef.current?.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    setSidebarDragOffset(0);
    setSidebarDragging(false);
  };

  const isPlayerRoute = pathname === '/ipad-edition/watch' || pathname.startsWith('/ipad-edition/watch/');
  const isDetailRoute = pathname === '/ipad-edition/detail' || pathname.startsWith('/ipad-edition/detail/');
  const isChromeHidden = isPlayerRoute || isDetailRoute;
  const activeHref = pathname.startsWith('/ipad-edition/search')
    ? '/ipad-edition/search'
    : pathname.startsWith('/ipad-edition/library') || pathname.startsWith('/ipad-edition/settings')
      ? '/ipad-edition/library'
      : '/ipad-edition';

  return (
    <div
      className="ipad-edition"
      data-ipad-edition="true"
      data-ipad-player={isPlayerRoute ? 'true' : undefined}
      data-ipad-detail={isDetailRoute ? 'true' : undefined}
      data-ipad-sidebar-open={sidebarOpen ? 'true' : 'false'}
      data-ipad-sidebar-dragging={sidebarDragging ? 'true' : 'false'}
      onPointerDown={beginSidebarGesture}
      onPointerMove={moveSidebarGesture}
      onPointerUp={finishSidebarGesture}
      onPointerCancel={cancelSidebarGesture}
      style={{ '--ipad-sidebar-drag': `${sidebarDragOffset}px` } as CSSProperties}
    >
      {!isChromeHidden && sidebarOpen && (
        <button
          className="ipad-nav__scrim"
          type="button"
          aria-label="关闭侧边栏"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {!isChromeHidden && (
        <LiquidGlassSurface
          as="aside"
          variant="panel"
          cornerRadius={0}
          className={`ipad-nav__sidebar${sidebarOpen ? ' is-open' : ''}`}
          id="ipad-edition-sidebar"
          aria-label="主导航"
          aria-hidden={!sidebarOpen}
          inert={!sidebarOpen}
        >
          <Link className="ipad-nav__brand" href="/ipad-edition" tabIndex={sidebarOpen ? 0 : -1}>
            <span className="ipad-nav__brand-mark">L</span>
            <span className="ipad-nav__brand-copy">
              <strong>LibreTV</strong>
              <small>YOUR CINEMA</small>
            </span>
          </Link>

          <p className="ipad-nav__section-label">导航</p>
          <nav className="ipad-nav__links" aria-label="主导航">
            {sidebarNavigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                tabIndex={sidebarOpen ? 0 : -1}
                className={activeHref === item.href ? 'is-active' : ''}
                aria-current={activeHref === item.href ? 'page' : undefined}
              >
                <NavigationIcon name={item.icon} />
                <span>{item.label}</span>
                {activeHref === item.href && <i aria-hidden="true" />}
              </Link>
            ))}
          </nav>

          <div className="ipad-nav__sidebar-foot">
            <span>LIBRETV · IPAD EDITION</span>
          </div>
        </LiquidGlassSurface>
      )}

      <main className="ipad-edition__main">
        {!isChromeHidden && (
          <header className="ipad-nav__topbar">
            <LiquidGlassSurface as="div" variant="panel" cornerRadius={18} className="ipad-nav__topbar-inner">
              <button
                className="ipad-nav__menu-button"
                type="button"
                aria-label={sidebarOpen ? '关闭导航菜单' : '打开导航菜单'}
                aria-expanded={sidebarOpen}
                aria-controls="ipad-edition-sidebar"
                onClick={() => setSidebarOpen((open) => !open)}
              >
                <NavigationIcon name={sidebarOpen ? 'close' : 'menu'} />
              </button>

              <Link className="ipad-nav__wordmark" href="/ipad-edition" aria-label="LibreTV 主页">
                <span className="ipad-nav__wordmark-mark">L</span>
                <span>LibreTV</span>
                <small>影院</small>
              </Link>

              <div className="ipad-nav__topbar-spacer" />
              <Link
                className={`ipad-nav__quick-search${activeHref === '/ipad-edition/search' ? ' is-active' : ''}`}
                href="/ipad-edition/search"
                aria-label="搜索影片"
              >
                <NavigationIcon name="search" />
                <span>搜索影片</span>
              </Link>
            </LiquidGlassSurface>
          </header>
        )}
        {children}
      </main>
    </div>
  );
}
