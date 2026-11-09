'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs = [
  { href: '/', label: '首页', icon: 'home' },
  { href: '/movies', label: '电影', icon: 'film' },
  { href: '/tv', label: '电视剧', icon: 'tv' },
  { href: '/me', label: '我的', icon: 'user' },
] as const;

function TabIcon({ name }: { name: (typeof tabs)[number]['icon'] }) {
  if (name === 'home') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" /></svg>;
  if (name === 'film') return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 3v18M17 3v18M3 8h4m-4 8h4m10-8h4m-4 8h4" /></svg>;
  if (name === 'tv') return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M8 22h8m-4-4v4" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M4.5 21c.6-4 3.1-6 7.5-6s6.9 2 7.5 6" /></svg>;
}

export function MobileTabBar() {
  const pathname = usePathname();
  const [portalReady, setPortalReady] = useState(false);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  const normalized = !pathname || pathname === '/' ? '/' : pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const navigation = (
    <nav className="v4-mobile-tabbar" aria-label="底部导航">
      {tabs.map(tab => {
        const active = tab.href === '/' ? normalized === '/' : normalized === tab.href || normalized.startsWith(tab.href + '/');
        return <Link key={tab.href} href={tab.href} className={active ? 'is-active' : ''} aria-current={active ? 'page' : undefined}>
          <TabIcon name={tab.icon} />
          <span>{tab.label}</span>
          {active && <i aria-hidden="true" />}
        </Link>;
      })}
    </nav>
  );

  // Keep the fixed dock outside transformed/filtered page containers.
  // On iOS Safari, those ancestors can become the containing block for
  // position: fixed and make the dock scroll into the middle of the page.
  return portalReady ? createPortal(navigation, document.body) : null;
}
