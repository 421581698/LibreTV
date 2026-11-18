'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';

const navigation = [
  { label: '首页', href: '/ipad-edition', icon: 'house' },
  { label: '电影', href: '/ipad-edition/movies', icon: 'film' },
  { label: '电视剧', href: '/ipad-edition/series', icon: 'tv' },
  { label: '动漫', href: '/ipad-edition/anime', icon: 'sparkles' },
  { label: '资料库', href: '/ipad-edition/library', icon: 'square-stack' },
];

export function IpadEditionShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="ipad-edition" data-ipad-edition="true">
      {sidebarOpen ? <button className="ipad-edition__backdrop" type="button" aria-label="关闭导航" onClick={() => setSidebarOpen(false)} /> : null}
      <aside className={'ipad-edition__sidebar' + (sidebarOpen ? ' is-open' : '')} aria-label="iPad 影院导航">
        <Link className="ipad-edition__brand" href="/ipad-edition"><span className="ipad-edition__brand-mark" aria-hidden="true">L</span><span>LibreTV</span><small>IPAD EDITION</small></Link>
        <p className="ipad-edition__nav-label">影院</p>
        <nav className="ipad-edition__nav">
          {navigation.map((item) => {
            const active = item.href === '/ipad-edition' ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + '/');
            return <Link key={item.href} href={item.href} className={active ? 'is-active' : ''} aria-current={active ? 'page' : undefined} onClick={() => setSidebarOpen(false)}><span className={"ipad-edition__nav-icon icon-" + item.icon} aria-hidden="true" />{item.label}</Link>;
          })}
        </nav>
        <div className="ipad-edition__sidebar-footer">
          <Link href="/ipad-edition/search" onClick={() => setSidebarOpen(false)}><span className="ipad-edition__nav-icon icon-search" aria-hidden="true" /> <span>搜索影片</span></Link>
          <Link href="/ipad-edition/settings" onClick={() => setSidebarOpen(false)}><span className="ipad-edition__nav-icon icon-settings" aria-hidden="true" /> <span>设置</span></Link>
        </div>
      </aside>
      <main className="ipad-edition__main">
        <header className="ipad-edition__topbar">
          <button className="ipad-edition__menu" type="button" aria-label="打开导航" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((open) => !open)}>☰</button>
          <nav className="ipad-edition__top-links" aria-label="快捷导航">
            {navigation.slice(0, 4).map((item) => <Link key={item.href} href={item.href} className={(pathname === item.href ? 'is-active' : '')}>{item.label}</Link>)}
          </nav>
          <div className="ipad-edition__top-actions"><Link href="/ipad-edition/search" aria-label="搜索"><span className="ipad-edition__nav-icon icon-search" /></Link><Link href="/ipad-edition/settings" aria-label="设置"><span className="ipad-edition__nav-icon icon-settings" /></Link></div>
        </header>
        {children}
      </main>
    </div>
  );
}
