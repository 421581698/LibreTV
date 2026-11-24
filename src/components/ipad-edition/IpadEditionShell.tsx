'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { LiquidGlassSurface } from '@/components/ui/liquid-glass';
import { attachEnvironmentEngine } from '@/lib/ipad-edition/environment-engine';
import { resolveIpadNavigationLayout } from '@/lib/ipad-edition/container';
import { detectRenderCapabilities, selectRenderPolicy } from '@/lib/ipad-edition/render-engine';
import { IpadLayoutDiagnostics } from '@/components/ipad-edition/IpadLayoutDiagnostics';

const primaryNavigation = [
  { label: '首页', href: '/ipad-edition', icon: 'house' },
  { label: '电影', href: '/ipad-edition/movies', icon: 'clapperboard' },
  { label: '电视剧', href: '/ipad-edition/series', icon: 'tv' },
  { label: '动漫', href: '/ipad-edition/anime', icon: 'drama' },
] as const;

const personalNavigation = [
  { label: '搜索', href: '/ipad-edition/search', icon: 'search' },
  { label: '我的', href: '/ipad-edition/library', icon: 'user-round' },
  { label: '设置', href: '/ipad-edition/settings', icon: 'settings' },
] as const;

type NavigationIconName = 'house' | 'user-round' | 'search' | 'panel-left' | 'x' | 'settings' | 'clapperboard' | 'tv' | 'drama';

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
  if (name === 'user-round') {
    return <svg {...common}><circle cx="12" cy="8" r="3.4" /><path d="M4.7 20c.6-3.5 3.1-5.3 7.3-5.3s6.7 1.8 7.3 5.3" /></svg>;
  }
  if (name === 'settings') {
    return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.1 1.9-1.7 2.9-2.2-.5a7.8 7.8 0 0 1-1.7 1l-.7 2.1h-3.4l-.7-2.1a7.8 7.8 0 0 1-1.7-1l-2.2.5-1.7-2.9 1.1-1.9a7.5 7.5 0 0 1 0-2l-1.1-1.9 1.7-2.9 2.2.5a7.8 7.8 0 0 1 1.7-1l.7-2.1h3.4l.7 2.1a7.8 7.8 0 0 1 1.7 1l2.2-.5 1.7 2.9-1.1 1.9a7.5 7.5 0 0 1 0 2Z" transform="translate(-1 -1) scale(1.08)" /></svg>;
  }
  if (name === 'search') {
    return <svg {...common}><circle cx="10.7" cy="10.7" r="6.4" /><path d="m15.4 15.4 4.6 4.6" /></svg>;
  }
  if (name === 'panel-left') {
    return <svg {...common}><rect x="3.5" y="4" width="17" height="16" rx="2.2" /><path d="M9 4v16" /></svg>;
  }
  if (name === 'x') {
    return <svg {...common}><path d="m18 6-12 12M6 6l12 12" /></svg>;
  }
  if (name === 'clapperboard') {
    return <svg {...common}><path d="M4 8h16v12H4zM4 8l2-4h14l-2 4M9 4l3 4m3-4 3 4" /></svg>;
  }
  if (name === 'tv') {
    return <svg {...common}><rect x="3" y="6" width="18" height="13" rx="2" /><path d="m8 3 4 3 4-3M9 22h6" /></svg>;
  }
  if (name === 'drama') {
    return <svg {...common}><path d="M4 5.5 12 3l8 2.5v10L12 18l-8-2.5z" /><path d="M4 5.5 12 8l8-2.5M12 8v10M8 10l-2 2m10-2 2 2" /></svg>;
  }
  return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.1 1.9-1.7 2.9-2.2-.5a7.8 7.8 0 0 1-1.7 1l-.7 2.1h-3.4l-.7-2.1a7.8 7.8 0 0 1-1.7-1l-2.2.5-1.7-2.9 1.1-1.9a7.5 7.5 0 0 1 0-2l-1.1-1.9 1.7-2.9 2.2.5a7.8 7.8 0 0 1 1.7-1l.7-2.1h3.4l.7 2.1a7.8 7.8 0 0 1 1.7 1l2.2-.5 1.7 2.9-1.1 1.9a7.5 7.5 0 0 1 0 2Z" transform="translate(-1 -1) scale(1.08)" /></svg>;
}

export function IpadEditionShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '/ipad-edition';
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarDragOffset, setSidebarDragOffset] = useState(0);
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const [cinemaScrolled, setCinemaScrolled] = useState(false);
  const [wideLayout, setWideLayout] = useState(false);
  const [navigationCollapsed, setNavigationCollapsed] = useState(true);
  const gestureRef = useRef<{ pointerId: number; startX: number; lastX: number; lastAt: number; width: number; wasOpen: boolean } | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const environmentRootRef = useRef<HTMLDivElement | null>(null);
  const wideLayoutRef = useRef(false);

  useEffect(() => {
    const root = environmentRootRef.current;
    if (!root) return;
    const updateLayout = () => {
      const expanded = resolveIpadNavigationLayout(root.getBoundingClientRect().width) === 'expanded';
      const wasWide = wideLayoutRef.current;
      wideLayoutRef.current = expanded;
      setWideLayout(expanded);
      if (!expanded) {
        setNavigationCollapsed(false);
        setSidebarOpen(false);
      } else if (!wasWide) {
        setNavigationCollapsed(true);
        setSidebarOpen(false);
      }
    };
    updateLayout();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateLayout) : null;
    observer?.observe(root);
    window.addEventListener('resize', updateLayout, { passive: true });
    const detachEnvironment = attachEnvironmentEngine(root);
    const renderPolicy = selectRenderPolicy(detectRenderCapabilities());
    root.dataset.renderBackend = renderPolicy.backend;
    root.dataset.renderDisplacement = renderPolicy.allowDisplacement ? 'enabled' : 'disabled';
    root.dataset.renderMotion = renderPolicy.allowContinuousAnimation ? 'enabled' : 'reduced';
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateLayout);
      detachEnvironment();
      delete root.dataset.renderBackend;
      delete root.dataset.renderDisplacement;
      delete root.dataset.renderMotion;
    };
  }, []);

  useEffect(() => {
    if (pathname !== '/ipad-edition') {
      setCinemaScrolled(false);
      return;
    }
    const updateScrollState = () => setCinemaScrolled(window.scrollY > 200);
    updateScrollState();
    window.addEventListener('scroll', updateScrollState, { passive: true });
    return () => window.removeEventListener('scroll', updateScrollState);
  }, [pathname]);

  useEffect(() => {
    setSidebarOpen(false);
    setSidebarDragOffset(0);
  }, [pathname]);
  useEffect(() => {
    if (!sidebarOpen && !(wideLayout && !navigationCollapsed)) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const sidebar = document.getElementById('ipad-edition-sidebar');
    const focusable = () => Array.from(sidebar?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? []).filter((element) => element.offsetParent !== null);
    focusable()[0]?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSidebarOpen(false);
        if (wideLayout) setNavigationCollapsed(true);
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (!elements.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !sidebar?.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !sidebar?.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      menuButtonRef.current?.focus({ preventScroll: true });
    };
  }, [sidebarOpen, wideLayout, navigationCollapsed]);

  const beginSidebarGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' || !event.isPrimary || isChromeHidden || (wideLayout && !navigationCollapsed)) return;
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
  const isChromeHidden = isPlayerRoute;
  const isExpandedSidebar = wideLayout && !navigationCollapsed && !isChromeHidden;
  const allNavigation = [...primaryNavigation, ...personalNavigation];
  const activeHref = allNavigation.find((item) => item.href !== '/ipad-edition' && pathname.startsWith(item.href))?.href
    ?? (pathname === '/ipad-edition' ? '/ipad-edition' : '');

  return (
    <div
      ref={environmentRootRef}
      className="ipad-edition"
      data-ipad-edition="true"
      data-ipad-player={isPlayerRoute ? 'true' : undefined}
      data-ipad-detail={isDetailRoute ? 'true' : undefined}
      data-ipad-home={pathname === '/ipad-edition' ? 'true' : undefined}
      data-ipad-scrolled={cinemaScrolled ? 'true' : 'false'}
      data-ipad-sidebar-open={sidebarOpen || isExpandedSidebar ? 'true' : 'false'}
      data-ipad-layout={wideLayout ? 'expanded' : 'compact'}
      data-ipad-sidebar-dragging={sidebarDragging ? 'true' : 'false'}
      onPointerDown={beginSidebarGesture}
      onPointerMove={moveSidebarGesture}
      onPointerUp={finishSidebarGesture}
      onPointerCancel={cancelSidebarGesture}
      style={{ '--ipad-sidebar-drag': `${sidebarDragOffset}px` } as CSSProperties}
    >
      {!isChromeHidden && !isExpandedSidebar && <div className="ipad-nav__edge-swipe-zone" aria-hidden="true" />}

      {!isChromeHidden && sidebarOpen && !isExpandedSidebar && (
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
          disableEngine
          variant="panel"
          cornerRadius={0}
          className={`ipad-nav__sidebar${sidebarOpen || isExpandedSidebar ? ' is-open' : ''}`}
          id="ipad-edition-sidebar"
          aria-label="主导航"
          aria-hidden={!sidebarOpen && !isExpandedSidebar}
          inert={!sidebarOpen && !isExpandedSidebar}
        >
          <Link className="ipad-nav__brand" href="/ipad-edition" tabIndex={sidebarOpen || isExpandedSidebar ? 0 : -1}>
            <span className="ipad-nav__brand-mark">L</span>
            <span className="ipad-nav__brand-copy">
              <strong>LibreTV</strong>
              <small>YOUR CINEMA</small>
            </span>
          </Link>
          <button
            type="button"
            className="ipad-nav__collapse-button"
            aria-label="关闭侧边栏"
            title="关闭侧边栏"
            onClick={() => {
              setSidebarOpen(false);
              setNavigationCollapsed(true);
            }}
          >
            <NavigationIcon name="x" />
            <span>关闭</span>
          </button>

          <p className="ipad-nav__section-label">主导航</p>
          <nav className="ipad-nav__links" aria-label="主要内容">
            {primaryNavigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                tabIndex={sidebarOpen || isExpandedSidebar ? 0 : -1}
                className={activeHref === item.href ? 'is-active' : ''}
                aria-current={activeHref === item.href ? 'page' : undefined}
              >
                <NavigationIcon name={item.icon} />
                <span>{item.label}</span>
                {activeHref === item.href && <i aria-hidden="true" />}
              </Link>
            ))}
          </nav>

          <p className="ipad-nav__section-label ipad-nav__section-label--tools">个人与工具</p>
          <nav className="ipad-nav__links" aria-label="个人与工具">
            {personalNavigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                tabIndex={sidebarOpen || isExpandedSidebar ? 0 : -1}
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
        {!isChromeHidden && !isExpandedSidebar && (
          <header className="ipad-nav__topbar">
            <LiquidGlassSurface as="div" disableEngine variant="panel" cornerRadius={999} className="ipad-nav__topbar-inner">
              <button
                ref={menuButtonRef}
                className={`ipad-nav__capsule-action ipad-nav__menu-button${sidebarOpen ? ' is-active' : ''}`}
                type="button"
                aria-label={sidebarOpen ? '收起侧边栏' : '展开侧边栏'}
                aria-expanded={sidebarOpen}
                aria-controls="ipad-edition-sidebar"
                onClick={() => {
                  if (wideLayout) {
                    setNavigationCollapsed((collapsed) => !collapsed);
                    setSidebarOpen(false);
                  } else {
                    setSidebarOpen((open) => !open);
                  }
                }}
              >
                <NavigationIcon name="panel-left" />
              </button>

              <Link
                className={`ipad-nav__capsule-action${activeHref === '/ipad-edition' ? ' is-active' : ''}`}
                href="/ipad-edition"
                aria-label="首页"
                aria-current={activeHref === '/ipad-edition' ? 'page' : undefined}
              >
                <NavigationIcon name="house" />
              </Link>
              <Link
                className={`ipad-nav__capsule-action${activeHref === '/ipad-edition/search' ? ' is-active' : ''}`}
                href="/ipad-edition/search"
                aria-label="搜索"
                aria-current={activeHref === '/ipad-edition/search' ? 'page' : undefined}
              >
                <NavigationIcon name="search" />
              </Link>
              <Link
                className={`ipad-nav__capsule-action${activeHref === '/ipad-edition/library' ? ' is-active' : ''}`}
                href="/ipad-edition/library"
                aria-label="我的"
                aria-current={activeHref === '/ipad-edition/library' ? 'page' : undefined}
              >
                <NavigationIcon name="user-round" />
              </Link>
            </LiquidGlassSurface>
          </header>
        )}
        {children}
      </main>
      {!isChromeHidden && <IpadLayoutDiagnostics />}
    </div>
  );
}
