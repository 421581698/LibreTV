'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/components/icon';
import { GlassButton } from '@/components/ui/glass';
import { SearchHistoryDropdown, useSearchHistory } from '@/components/search-history';

type PathProps = { pathname: string | null };
const normalized = (value: string | null) => !value || value === '/' ? '/' : value.replace(/\\/+$/, '');
function NavItem({ pathname, href, label }: PathProps & { href: string; label: string }) {
  const current = normalized(pathname);
  const active = href === '/' ? current === '/' : current === href || current.startsWith(href + '/');
  return <Link href={href} className={active ? 'v4-nav-link is-active' : 'v4-nav-link'} aria-current={active ? 'page' : undefined}>{label}</Link>;
}
export function BrandModule() {
  return <Link href="/" className="v4-brand" aria-label="LibreTV 首页"><svg className="v4-brand-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.4 5.6c0-1 1.1-1.6 2-1.1l9 6.4c.8.6.8 1.7 0 2.3l-9 6.4c-.9.6-2 0-2-1.1z" fill="#F1A63A" /></svg><span>LibreTV</span></Link>;
}
export function HomeNavModule(p: PathProps) { return <NavItem {...p} href="/" label="首页" />; }
export function MoviesNavModule(p: PathProps) { return <NavItem {...p} href="/movies" label="电影" />; }
export function TvNavModule(p: PathProps) { return <NavItem {...p} href="/tv" label="电视剧" />; }
export function OverseasNavModule(p: PathProps) { return <NavItem {...p} href="/overseas" label="海外剧" />; }
export function AnimeNavModule(p: PathProps) { return <NavItem {...p} href="/anime" label="动漫" />; }
export function VarietyNavModule(p: PathProps) { return <NavItem {...p} href="/variety" label="综艺" />; }
export function LiveNavModule(p: PathProps) { return <NavItem {...p} href="/live" label="直播" />; }

export function SearchModule() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const history = useSearchHistory(query);
  const submit = (value: string) => {
    const q = value.trim().slice(0, 100);
    if (!q) return;
    history.close(); setMobileOpen(false); history.record(q);
    router.push('/?s=' + encodeURIComponent(q), { scroll: false });
  };
  const pick = (value: string) => { setQuery(value); submit(value); };
  return <>
    <form id="v4-header-search" className={mobileOpen ? 'v4-search is-open' : 'v4-search'} role="search" onSubmit={(e) => { e.preventDefault(); submit(query); }}>
      <Icon name="search" />
      <div className="v4-search-field" ref={history.containerRef}>
        <input aria-label="搜索电影、电视剧" placeholder="搜索电影、电视剧..." autoFocus={mobileOpen} value={query} maxLength={100}
          onChange={(e) => { setQuery(e.target.value); history.resetActive(); }} onFocus={history.onFocus}
          onKeyDown={(e) => { if (e.key === 'Escape' && mobileOpen) { e.preventDefault(); setMobileOpen(false); e.currentTarget.blur(); return; } history.onKeyDown(e, pick); }}
          role="combobox" aria-expanded={history.visible} aria-controls="v4-header-search-history" aria-autocomplete="list" />
        {history.visible && <SearchHistoryDropdown id="v4-header-search-history" matches={history.matches} activeIndex={history.activeIndex} onPick={pick} onRemove={history.remove} onClearAll={history.clearAll} />}
      </div>
    </form>
    <button type="button" className="v4-mobile-search-toggle" aria-label={mobileOpen ? '关闭搜索' : '打开搜索'} aria-expanded={mobileOpen} aria-controls="v4-header-search" onClick={() => setMobileOpen((v) => !v)}><Icon name="search" /></button>
  </>;
}
export function HistoryModule({ onOpen }: { onOpen: () => void }) { return <GlassButton className="v4-header-icon" aria-label="观看历史" title="观看历史" onClick={onOpen}><Icon name="clock" /></GlassButton>; }
export function SettingsModule({ onOpen }: { onOpen: () => void }) { return <GlassButton className="v4-header-icon" aria-label="设置" title="设置" onClick={onOpen}><Icon name="gear" /></GlassButton>; }
export function AvatarModule({ pathname }: PathProps) {
  const router = useRouter();
  return <GlassButton className="v4-avatar" aria-label="打开我的个人空间" title="我的个人空间" onClick={() => pathname === '/me' ? window.scrollTo({ top: 0, behavior: 'smooth' }) : router.push('/me')}>
    <svg className="v4-avatar-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M4.8 20c.7-3.4 3.1-5.2 7.2-5.2s6.5 1.8 7.2 5.2" /></svg>
  </GlassButton>;
}
