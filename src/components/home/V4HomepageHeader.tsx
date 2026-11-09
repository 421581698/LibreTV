'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Icon } from '@/components/icon';
import { GlassButton } from '@/components/ui/glass';
import { SourceManagerDrawer } from '@/components/source-manager';
import { HistoryPanel } from '@/components/history-panel';
import AIFloatingBall from '@/components/AIFloatingBall';
import { SearchHistoryDropdown, useSearchHistory } from '@/components/search-history';

const NAV_ITEMS = [
  { label: '首页', href: '/' },
  { label: '影视', href: '/movies' },
  { label: '动漫', href: '/anime' },
  { label: '直播', href: '/live' },
  { label: '资源', href: '/resources' },
  { label: '我的', href: '/me' },
];

export function V4HomepageHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchHistory = useSearchHistory(query);

  useEffect(() => {
    const openSourceManager = () => setSettingsOpen(true);
    window.addEventListener('libretv:open-source-manager', openSourceManager);
    return () => window.removeEventListener('libretv:open-source-manager', openSourceManager);
  }, []);

  const submitSearch = (value: string) => {
    const q = value.trim().slice(0, 100);
    if (!q) return;
    searchHistory.close();
    searchHistory.record(q);
    router.push(`/?s=${encodeURIComponent(q)}`, { scroll: false });
  };

  const pickHistory = (value: string) => {
    setQuery(value);
    submitSearch(value);
  };

  return (
    <>
      <header className="v4-header">
        <div className="v4-header-inner">
          <Link href="/" className="v4-brand" aria-label="LibreTV 首页">
            <img src="/icons/icon-512.png" alt="" />
            <span>LibreTV</span>
          </Link>

          <nav
            className="v4-primary-nav"
            aria-label="主导航"
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>('a'));
              const current = links.indexOf(document.activeElement as HTMLAnchorElement);
              if (current < 0 || links.length < 2) return;
              event.preventDefault();
              const delta = event.key === 'ArrowRight' ? 1 : -1;
              links[(current + delta + links.length) % links.length]?.focus();
            }}
          >
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={pathname === item.href ? 'v4-nav-link is-active' : 'v4-nav-link'}
                aria-current={pathname === item.href ? 'page' : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="v4-header-actions">
            <form
              className="v4-search"
              role="search"
              onSubmit={(event) => {
                event.preventDefault();
                submitSearch(query);
              }}
            >
              <Icon name="search" />
              <div className="v4-search-field" ref={searchHistory.containerRef}>
                <input
                  aria-label="搜索电影、电视剧"
                  placeholder="搜索电影、电视剧..."
                  value={query}
                  maxLength={100}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    searchHistory.resetActive();
                  }}
                  onFocus={searchHistory.onFocus}
                  onKeyDown={(event) => searchHistory.onKeyDown(event, pickHistory)}
                  role="combobox"
                  aria-expanded={searchHistory.visible}
                  aria-controls="v4-header-search-history"
                  aria-autocomplete="list"
                />
                {searchHistory.visible && (
                  <SearchHistoryDropdown
                    id="v4-header-search-history"
                    matches={searchHistory.matches}
                    activeIndex={searchHistory.activeIndex}
                    onPick={pickHistory}
                    onRemove={searchHistory.remove}
                    onClearAll={searchHistory.clearAll}
                  />
                )}
              </div>
            </form>

            <GlassButton className="v4-header-icon" aria-label="观看历史" title="观看历史" onClick={() => setHistoryOpen(true)}>
              <Icon name="clock" />
            </GlassButton>
            <GlassButton className="v4-header-icon" aria-label="设置" title="设置" onClick={() => {
                if (pathname === '/settings') setSettingsOpen(true);
                else router.push('/settings');
              }}>
              <Icon name="gear" />
            </GlassButton>
            <GlassButton
              className="v4-avatar"
              aria-label="我的观看记录"
              title="我的观看记录"
              onClick={() => {
                if (pathname === '/') {
                  document.getElementById('my-library')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                } else {
                  router.push('/me');
                }
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M4.8 20c.7-3.4 3.1-5.2 7.2-5.2s6.5 1.8 7.2 5.2" /></svg>
            </GlassButton>
          </div>
        </div>
      </header>

      <AIFloatingBall showFab inlineMode={false} />
      <SourceManagerDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <HistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </>
  );
}
