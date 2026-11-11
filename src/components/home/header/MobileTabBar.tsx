'use client';
import Link from 'next/link';
import { LiquidGlassSurface } from '@/components/ui/liquid-glass';
import { usePathname } from 'next/navigation';

const tabs = [
  { href: '/', label: '首页', icon: 'home' },
  { href: '/categories', label: '分类', icon: 'grid' },
  { href: '/me', label: '我的', icon: 'user' },
] as const;

function TabIcon({ name, active }: { name: (typeof tabs)[number]['icon']; active: boolean }) {
  if (name === 'home') return <svg className={active ? 'is-filled' : ''} viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" /></svg>;
  if (name === 'grid') return <svg className={active ? 'is-filled' : ''} viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>;
  return <svg className={active ? 'is-filled' : ''} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M4.5 21c.6-4 3.1-6 7.5-6s6.9 2 7.5 6" /></svg>;
}

export function MobileTabBar() {
  const pathname = usePathname();
  const normalized = !pathname || pathname === '/' ? '/' : pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const activeTab =
    normalized === '/' ? '/' :
    normalized === '/categories' || normalized.startsWith('/categories/') ? '/categories' :
    normalized === '/me' || normalized.startsWith('/me/') ||
    normalized === '/settings' || normalized.startsWith('/settings/') ||
    normalized === '/resources' || normalized.startsWith('/resources/') ? '/me' : '';

  return (
    <LiquidGlassSurface as="nav" interactive className="v4-mobile-tabbar" aria-label="底部导航">
      {tabs.map((tab) => {
        const active = tab.href === activeTab;
        return (
          <Link key={tab.href} href={tab.href} className={active ? 'is-active' : ''} aria-current={active ? 'page' : undefined}>
            <TabIcon name={tab.icon} active={active} />
            <span>{tab.label}</span>
            {active && <i aria-hidden="true" />}
          </Link>
        );
      })}
    </LiquidGlassSurface>
  );
}
