'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode } from 'react';

const navigation = [
  { label: '首页', href: '/ipad-edition', icon: 'house' },
  { label: '电影', href: '/ipad-edition/movies', icon: 'film' },
  { label: '电视剧', href: '/ipad-edition/series', icon: 'tv' },
  { label: '动漫', href: '/ipad-edition/anime', icon: 'sparkles' },
  { label: '资料库', href: '/ipad-edition/library', icon: 'square-stack' },
];

export function IpadEditionShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="ipad-edition" data-ipad-edition="true">
      <main className="ipad-edition__main">
        <header className="ipad-edition__topbar">
          
          <nav className="ipad-edition__top-links" aria-label="主导航">
            {navigation.slice(0, 4).map((item) => <Link key={item.href} href={item.href} className={(pathname === item.href ? 'is-active' : '')}>{item.label}</Link>)}<Link href="/ipad-edition/search" aria-label="搜索影片"><span className="ipad-edition__nav-icon icon-search" /></Link><Link href="/ipad-edition/settings" aria-label="设置"><span className="ipad-edition__nav-icon icon-settings" /></Link>
          </nav>
        </header>
        {children}
      </main>
    </div>
  );
}
