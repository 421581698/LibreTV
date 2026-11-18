'use client';

import { usePathname } from 'next/navigation';
import { MobileTabBar } from '@/components/home/header/MobileTabBar';

/**
 * Keeps the shared global navigation outside the dedicated iPad Edition route.
 * The iPad route owns its own navigation and must not inherit the global dock.
 */
export function GlobalChromeBoundary() {
  const pathname = usePathname() || '/';
  if (pathname === '/ipad-edition' || pathname.startsWith('/ipad-edition/')) return null;
  return <MobileTabBar />;
}
