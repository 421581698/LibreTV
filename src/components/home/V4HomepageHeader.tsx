'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { SourceManagerDrawer } from '@/components/source-manager';
import { HistoryPanel } from '@/components/history-panel';
import AIFloatingBall from '@/components/AIFloatingBall';
import { BrandModule } from './header/BrandModule';
import { SearchModule } from './header/SearchModule';
import { AvatarModule } from './header/AvatarModule';
import { MobileTabBar } from './header/MobileTabBar';

export function V4HomepageHeader({ overlay = false }: { overlay?: boolean }) {
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInstance, setSettingsInstance] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    if (!overlay) {
      setIsScrolled(false);
      return;
    }
    const update = () => setIsScrolled(window.scrollY > 48);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [overlay]);

  useEffect(() => {
    const open = () => {
      setSettingsInstance((value) => value + 1);
      setSettingsOpen(true);
    };
    window.addEventListener('libretv:open-source-manager', open);
    return () => window.removeEventListener('libretv:open-source-manager', open);
  }, []);

  useEffect(() => {
    const open = () => setHistoryOpen(true);
    window.addEventListener('libretv:open-history-panel', open);
    return () => window.removeEventListener('libretv:open-history-panel', open);
  }, []);

  return (
    <>
      <header className={'v4-header' + (overlay ? ' is-overlay' : '') + (overlay && isScrolled ? ' is-scrolled' : '')}>
        <div className="v4-header-inner">
          <BrandModule />
          <div className="v4-header-actions">
            <SearchModule />
            <AvatarModule pathname={pathname} />
          </div>
        </div>
      </header>
      <MobileTabBar />
      <AIFloatingBall showFab inlineMode={false} />
      <SourceManagerDrawer
        key={settingsInstance}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      <HistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </>
  );
}
