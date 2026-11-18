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
  if (name === 'house') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 10.5 12 3.8l8.5 6.7v9.2h-6v-6h-5v6h-6z" /></svg>;
  }
  if (name === 'search') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.6" /><path d="m15.7 15.7 4.5 4.5" /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.6" /><path d="M4.8 20c.7-3.7 3.1-5.6 7.2-5.6s6.5 1.9 7.2 5.6" /></svg>;
}

function SidebarPanelIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="1.2" /><path d="M10 4v16M6.5 8h1.2M6.5 11h1.2M13 8h4.5M13 11h4.5" /></svg>;
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
              <SidebarPanelIcon />
            </button>
            <Link href="/ipad-edition" className={homeActive ? 'is-active' : ''} aria-label="首页" aria-current={homeActive ? 'page' : undefined}><NavigationIcon name="house" /></Link>
            <Link href="/ipad-edition/search" className={searchActive ? 'is-active' : ''} aria-label="搜索" aria-current={searchActive ? 'page' : undefined}><NavigationIcon name="search" /></Link>
            <Link href="/ipad-edition/library" className={myActive ? 'is-active' : ''} aria-label="我的" aria-current={myActive ? 'page' : undefined}><NavigationIcon name="user" /></Link>
          </nav>
        </header>
        {children}
      </main>
    </div>
  );
}
