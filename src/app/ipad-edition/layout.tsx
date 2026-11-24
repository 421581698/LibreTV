import type { ReactNode } from 'react';
import type { Viewport } from 'next';
import { IpadEditionShell } from '@/components/ipad-edition/IpadEditionShell';
import './ipad-edition.css';
import './poster-engine.css';
import './responsive-system.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#000000',
};

export const metadata = {
  title: 'LibreTV iPad Edition',
  description: 'LibreTV iPad 独立影院体验',
  manifest: '/ipad-edition/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'LibreTV' },
};

export default function IpadEditionLayout({ children }: { children: ReactNode }) {
  return <IpadEditionShell>{children}</IpadEditionShell>;
}
