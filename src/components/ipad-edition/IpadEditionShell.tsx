'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

const navigation = [
  { label: '首页', href: '/ipad-edition', icon: 'house' },
  { label: '电影', href: '/ipad-edition/movies', icon: 'film' },
  { label: '电视剧', href: '/ipad-edition/series', icon: 'tv' },
  { label: '动漫', href: '/ipad-edition/anime', icon: 'sparkles' },
  { label: '资料库', href: '/ipad-edition/library', icon: 'square-stack' },
];

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

  return (
    <div className="ipad-edition" data-ipad-edition="true">
      {sidebarOpen && <button className="ipad-edition__backdrop" type="button" aria-label="关闭导航菜单" onClick={() => setSidebarOpen(false)} />}
      <aside className={"ipad-edition__sidebar" + (sidebarOpen ? " is-open" : "")} id="ipad-edition-sidebar" aria-label="主导航" aria-hidden={!sidebarOpen}>
        <div className="ipad-edition__brand"><span className="ipad-edition__brand-mark">L</span><span>LibreTV</span><small>IPAD EDITION</small></div>
        <p className="ipad-edition__nav-label">浏览</p>
        <nav className="ipad-edition__nav">
          {navigation.map((item) => <Link key={item.href} href={item.href} tabIndex={sidebarOpen ? 0 : -1} className={pathname === item.href ? 'is-active' : ''}><span className={"ipad-edition__nav-icon icon-" + item.icon} aria-hidden="true" />{item.label}</Link>)}
        </nav>
        <div className="ipad-edition__sidebar-footer">
          <Link href="/ipad-edition/search" tabIndex={sidebarOpen ? 0 : -1}><span className="ipad-edition__nav-icon icon-search" />搜索影片</Link>
          <Link href="/ipad-edition/settings" tabIndex={sidebarOpen ? 0 : -1}><span className="ipad-edition__nav-icon icon-settings" />设置</Link>
        </div>
      </aside>
      <main className="ipad-edition__main">
        <header className="ipad-edition__topbar">
          <button className="ipad-edition__sidebar-toggle" type="button" aria-label={sidebarOpen ? "关闭侧边栏" : "打开侧边栏"} aria-expanded={sidebarOpen} aria-controls="ipad-edition-sidebar" onClick={() => setSidebarOpen((open) => !open)}><span /><span /><span /></button>
          <nav className="ipad-edition__top-links" aria-label="主导航">
            {navigation.slice(0, 4).map((item) => <Link key={item.href} href={item.href} className={(pathname === item.href ? 'is-active' : '')}>{item.label}</Link>)}<Link href="/ipad-edition/search" aria-label="搜索影片"><span className="ipad-edition__nav-icon icon-search" /></Link><Link href="/ipad-edition/settings" aria-label="设置"><span className="ipad-edition__nav-icon icon-settings" /></Link>
          </nav>
        </header>
        {children}
      </main>
    </div>
  );
}
