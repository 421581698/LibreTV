'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import LiquidGlass from 'liquid-glass-react';

const sidebarNavigation = [
  { label: '首页', href: '/ipad-edition', icon: 'house' },
  { label: '电影', href: '/ipad-edition/movies', icon: 'film' },
  { label: '电视剧', href: '/ipad-edition/series', icon: 'tv' },
  { label: '动漫', href: '/ipad-edition/anime', icon: 'sparkles' },
  { label: '资料库', href: '/ipad-edition/library', icon: 'square-stack' },
] as const;

function NavigationIcon({ name, className = 'ipad-edition__top-icon' }: { name: 'house' | 'film' | 'tv' | 'sparkles' | 'square-stack' | 'search' | 'user'; className?: string }) {
  const common = {
    viewBox: '0 0 24 24',
    className,
    'aria-hidden': true as const,
    focusable: false as const,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (name === 'house') {
    return <svg {...common}><path d="M3.8 10.4 12 3.7l8.2 6.7v9a.9.9 0 0 1-.9.9h-5.1v-6.1H9.8v6.1H4.7a.9.9 0 0 1-.9-.9z" /></svg>;
  }
  if (name === 'film') {
    return <svg {...common}><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M7 5v14M17 5v14M3.5 9h3.5M17 9h3.5M3.5 15h3.5M17 15h3.5" /></svg>;
  }
  if (name === 'tv') {
    return <svg {...common}><rect x="3" y="4.5" width="18" height="13" rx="2" /><path d="M8 21h8M12 17.5V21" /></svg>;
  }
  if (name === 'square-stack') {
    return <svg {...common}><rect x="5" y="6" width="14" height="15" rx="2" /><path d="M8 3h11a2 2 0 0 1 2 2v12M9 10h6M9 14h6" /></svg>;
  }
  if (name === 'sparkles') {
    return <svg {...common}><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15ZM5 2l.7 2.3L8 5l-2.3.7L5 8l-.7-2.3L2 5l2.3-.7L5 2Z" /></svg>;
  }
  if (name === 'search') {
    return <svg {...common}><circle cx="10.7" cy="10.7" r="6.4" /><path d="m15.4 15.4 4.6 4.6" /></svg>;
  }
  return <svg {...common}><circle cx="12" cy="8" r="3.5" /><path d="M4.6 20c.6-3.5 3.1-5.3 7.4-5.3s6.8 1.8 7.4 5.3" /></svg>;
}

function SettingsIcon() {
  return <svg className="ipad-edition__sidebar-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h9m4 0h3M4 17h3m4 0h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></svg>;
}

function SidebarPanelIcon() {
  return <svg className="ipad-edition__top-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2.5" width="16" height="19" rx="3" /><path d="M9.5 5.5h5M10 18.5h4" /></svg>;
}

export function IpadEditionShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [glassReady, setGlassReady] = useState(false);

  // liquid-glass-react reads navigator during render, so mount it only after hydration.
  useEffect(() => { setGlassReady(true); }, []);

  useEffect(() => { setSidebarOpen(false); }, [pathname]);
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setSidebarOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sidebarOpen]);

  const homeActive = pathname === '/ipad-edition';
  const searchActive = pathname.startsWith('/ipad-edition/search');
  const myActive = pathname.startsWith('/ipad-edition/library') || pathname.startsWith('/ipad-edition/settings');
  const isPlayerRoute = pathname === '/ipad-edition/watch' || pathname.startsWith('/ipad-edition/watch/');

  return (
    <div className="ipad-edition" data-ipad-edition="true" data-ipad-player={isPlayerRoute ? "true" : undefined} data-sidebar-open={sidebarOpen ? "true" : "false"}>
      {!isPlayerRoute && sidebarOpen && <button className="ipad-edition__backdrop" type="button" aria-label="关闭导航菜单" onClick={() => setSidebarOpen(false)} />}
      {!isPlayerRoute && <aside className={"ipad-edition__sidebar" + (sidebarOpen ? " is-open" : "")} id="ipad-edition-sidebar" aria-label="主导航" aria-hidden={!sidebarOpen}>
        <div className="ipad-edition__brand"><span className="ipad-edition__brand-mark">L</span><span>LibreTV</span><small>IPAD EDITION</small></div>
        <p className="ipad-edition__nav-label">浏览</p>
        <nav className="ipad-edition__nav">
          {sidebarNavigation.map((item) => <Link key={item.href} href={item.href} tabIndex={sidebarOpen ? 0 : -1} className={pathname === item.href ? 'is-active' : ''}><NavigationIcon name={item.icon} className="ipad-edition__sidebar-icon" />{item.label}</Link>)}
        </nav>
        <div className="ipad-edition__sidebar-footer">
          <Link href="/ipad-edition/search" tabIndex={sidebarOpen ? 0 : -1}><NavigationIcon name="search" className="ipad-edition__sidebar-icon" />搜索影片</Link>
          <Link href="/ipad-edition/settings" tabIndex={sidebarOpen ? 0 : -1}><SettingsIcon />设置</Link>
        </div>
      </aside>}
      <main className="ipad-edition__main">
        {!isPlayerRoute && <header className="ipad-edition__topbar">
          {glassReady && (
            <LiquidGlass
              className="ipad-edition__liquid-glass-host"
              style={{ position: 'absolute', top: '50%', left: '50%', zIndex: 0, pointerEvents: 'none' }}
              displacementScale={22}
              blurAmount={0.8}
              saturation={180}
              aberrationIntensity={0.45}
              elasticity={0}
              cornerRadius={22}
              padding="0"
              mode="standard"
              globalMousePos={{ x: 0, y: 0 }}
              mouseOffset={{ x: 0, y: 0 }}
            >
              <span className="ipad-edition__liquid-glass-surface" aria-hidden="true" />
            </LiquidGlass>
          )}
          <nav className="ipad-edition__top-links" aria-label="主导航">
            <button className="ipad-edition__nav-button ipad-edition__sidebar-toggle" type="button" aria-label={sidebarOpen ? "关闭侧边栏" : "打开侧边栏"} aria-expanded={sidebarOpen} aria-controls="ipad-edition-sidebar" onClick={() => setSidebarOpen((open) => !open)}>
              <SidebarPanelIcon />
            </button>
            <Link href="/ipad-edition" className={homeActive ? 'is-active' : ''} aria-label="首页" aria-current={homeActive ? 'page' : undefined}><NavigationIcon name="house" /><span className="ipad-edition__top-label">首页</span></Link>
            <Link href="/ipad-edition/movies" className={pathname.startsWith('/ipad-edition/movies') ? 'is-active' : ''} aria-label="影视" aria-current={pathname.startsWith('/ipad-edition/movies') ? 'page' : undefined}><NavigationIcon name="film" /><span className="ipad-edition__top-label">影视</span></Link>
            <Link href="/ipad-edition/anime" className={pathname.startsWith('/ipad-edition/anime') ? 'is-active' : ''} aria-label="动漫" aria-current={pathname.startsWith('/ipad-edition/anime') ? 'page' : undefined}><NavigationIcon name="sparkles" /><span className="ipad-edition__top-label">动漫</span></Link>
            <Link href="/ipad-edition/search" className={searchActive ? 'is-active' : ''} aria-label="搜索" aria-current={searchActive ? 'page' : undefined}><NavigationIcon name="search" /><span className="ipad-edition__top-label">搜索</span></Link>
            <Link href="/ipad-edition/library" className={myActive ? 'is-active' : ''} aria-label="我的" aria-current={myActive ? 'page' : undefined}><NavigationIcon name="user" /><span className="ipad-edition__top-label">我的</span></Link>
          </nav>
        </header>}
        {children}
      </main>
    </div>
  );
}
