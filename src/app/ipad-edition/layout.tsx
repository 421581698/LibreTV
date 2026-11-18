import type { ReactNode } from 'react';
import { IpadEditionShell } from '@/components/ipad-edition/IpadEditionShell';
import './ipad-edition.css';

export const metadata = {
  title: 'LibreTV iPad Edition',
  description: 'LibreTV iPad 独立影院体验',
};

export default function IpadEditionLayout({ children }: { children: ReactNode }) {
  return <IpadEditionShell>{children}</IpadEditionShell>;
}
