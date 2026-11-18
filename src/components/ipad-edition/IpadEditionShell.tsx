'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

const sidebarNavigation = [
  { label: '首页', href: '/ipad-edition', icon: 'house' },
  { label: '电影', href: '/ipad-edition/movies', icon: 'film' },
  { label: '电视剧', href: '/ipad-edition/series', icon: 'tv' },
  { label: '动漫', href: '/ipad-edition/anime', icon: 'sparkles' },
  { label: '资料库', href: '/ipad-edition/library', icon: 'square-stack' },
];

function NavigationIcon({ name }: { name: 'house' | 'search' | 'user' }) {
  const common = {
    viewBox: '0 0 24 24',
    className: 'ipad-edition__top-icon',
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
  if (name === 'search') {
    return <svg {...common}><circle cx="10.7" cy="10.7" r="6.4" /><path d="m15.4 15.4 4.6 4.6" /></svg>;
  }
  return <svg {...common}><circle cx="12" cy="8" r="3.5" /><path d="M4.6 20c.6-3.5 3.1-5.3 7.4-5.3s6.8 1.8 7.4 5.3" /></svg>;
}

function SidebarPanelIcon() {
  return <svg className="ipad-edition__top-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="4" width="17" height="16" rx="2" /><path d="M9.5 4v16M6.5 8h.1M6.5 12h.1M12.5 8h4.5M12.5 12h4.5" /></svg>;
}

export function IpadEditionShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

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

  return (
    <div className="ipad-edition" data-ipad-edition="true">
      {sidebarOpen && <button className="ipad-edition__backdrop" type="button" aria-label="关闭导航菜单" onClick={() => setSidebarOpen(false)} />}
      <aside className={"ipad-edition__sidebar" + (sidebarOpen ? " is-open" : "")} id="ipad-edition-sidebar" aria-label="主导航" aria-hidden={!sidebarOpen}>
        <div className="ipad-edition__brand"><span className="ipad-edition__brand-mark">L</span><span>LibreTV</span><small>IPAD EDITION</small></div>
        <p className="ipad-edition__nav-label">浏览</p>
        <nav className="ipad-edition__nav">
          {sidebarNavigation.map((item) => <Link key={item.href} href={item.href} tabIndex={sidebarOpen ? 0 : -1} className={pathname === item.href ? 'is-active' : ''}><span className={"ipad-edition__nav-icon icon-" + item.icon} aria-hidden="true" />{item.label}</Link>)}
        </nav>
        <div className="ipad-edition__sidebar-footer">
          <Link href="/ipad-edition/search" tabIndex={sidebarOpen ? 0 : -1}><span className="ipad-edition__nav-icon icon-search" />搜索影片</Link>
          <Link href="/ipad-edition/settings" tabIndex={sidebarOpen ? 0 : -1}><span className="ipad-edition__nav-icon icon-settings" />设置</Link>
        </div>
      </aside>
      <main className="ipad-edition__main">
        <header className="ipad-edition__topbar">
          <nav className="ipad-edition__top-links" aria-label="主导航">
            <button className="ipad-edition__nav-button ipad-edition__sidebar-toggle" type="button" aria-label={sidebarOpen ? "关闭侧边栏" : "打开侧边栏"} aria-expanded={sidebarOpen} aria-controls="ipad-edition-sidebar" onClick={() => setSidebarOpen((open) => !open)}>
              <SidebarPanelIcon /><span className="ipad-edition__top-label">菜单</span>
            </button>
            <Link href="/ipad-edition" className={homeActive ? 'is-active' : ''} aria-label="首页" aria-current={homeActive ? 'page' : undefined}><NavigationIcon name="house" /><span className="ipad-edition__top-label">首页</span></Link>
            <Link href="/ipad-edition/search" className={searchActive ? 'is-active' : ''} aria-label="搜索" aria-current={searchActive ? 'page' : undefined}><NavigationIcon name="search" /><span className="ipad-edition__top-label">搜索</span></Link>
            <Link href="/ipad-edition/library" className={myActive ? 'is-active' : ''} aria-label="我的" aria-current={myActive ? 'page' : undefined}><NavigationIcon name="user" /><span className="ipad-edition__top-label">我的</span></Link>
          </nav>
        </header>
        {children}
      </main>
    </div>
  );
}
