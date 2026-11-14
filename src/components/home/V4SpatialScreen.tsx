'use client';

import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { V4HomepageHeader } from '@/components/home/V4HomepageHeader';
import { HomeInlinePlayer } from '@/components/home/HomeInlinePlayer';
import { requestShowDownloadManager } from '@/components/download-manager';
import { AnimeRecommendationSection, RecommendSection } from '@/components/douban-section';
import { DoubanCard } from '@/components/video-card';
import { GlassPanel } from '@/components/ui/glass';
import { SmartImage } from '@/components/smart-image';
import { db, removeFavorite, type FavoriteEntry, type HistoryEntry } from '@/lib/db';
import { isInDisabledSubscription, isSourceDisabled, resolveSource, useAppStore } from '@/lib/store';
import type { DoubanItem, SearchResultItem, SourceConfig } from '@/lib/types';
import { api } from '@/lib/client-api';
import { validateSourceUrl } from '@/lib/utils';
import { buildWatchUrl, formatTime } from '@/lib/utils';

type Screen = 'movies' | 'tv' | 'anime' | 'variety' | 'overseas' | 'resources' | 'me' | 'settings';
const COPY: Record<Screen, { eyebrow: string; title: string; subtitle: string }> = {
  movies: { eyebrow: 'LIBRARY / MOVIES', title: '电影', subtitle: '发现热门、新片与高分电影。' },
  tv: { eyebrow: 'LIBRARY / TV SERIES', title: '电视剧', subtitle: '浏览热门电视剧与不同地区的剧集推荐。' },
  variety: { eyebrow: 'LIBRARY / VARIETY', title: '综艺', subtitle: '浏览真实综艺推荐与热门节目。' },
  overseas: { eyebrow: 'LIBRARY / OVERSEAS DRAMA', title: '海外剧', subtitle: '按美剧、英剧、韩剧、日剧等分类发现海外剧集。' },
  anime: { eyebrow: 'LIBRARY / ANIME', title: '动漫', subtitle: '按星期查看 Bangumi 当季放送，追踪正在更新的新番。' },
  resources: { eyebrow: 'LIBRARY / SOURCES', title: '资源', subtitle: '管理真实接入的点播源、订阅和源健康状态，不展示虚构网盘结果。' },
  me: { eyebrow: 'PERSONAL / LIBRARY', title: '我的', subtitle: '本机观看记录与播放进度保存在你的设备上。' },
  settings: { eyebrow: '', title: '设置', subtitle: '播放、外观、网络、语音与数据选项沿用现有设置模块。' },
};

export function V4SpatialScreen({ screen }: { screen: Screen }) {
  const copy = COPY[screen];
  const selectedKeys = useAppStore((s) => s.selectedKeys);
  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const yellowFilter = useAppStore((s) => s.yellowFilter);
  const sourceHealth = useAppStore((s) => s.sourceHealth);
  const subscriptions = useAppStore((s) => s.subscriptions);
  const [quickPlayItem, setQuickPlayItem] = useState<SearchResultItem | null>(null);
  const [playbackError, setPlaybackError] = useState('');
  const selectedSources = selectedKeys
    .map((key) => resolveSource({ customAPIs, envSources }, key))
    .filter((source): source is SourceConfig => Boolean(
      source && validateSourceUrl(source.url) &&
      !isSourceDisabled({ sourceHealth }, source.key) &&
      !isInDisabledSubscription({ subscriptions }, source.key)
    ));
  const openRecommendation = async (movie: DoubanItem) => {
    setPlaybackError('');
    if (selectedSources.length === 0) {
      setPlaybackError('请先在设置中启用至少一个可用点播源。');
      return;
    }
    try {
      const response = await api.search(movie.title, selectedSources, yellowFilter);
      const normalize = (value: string) => value.replace(/[\s\p{P}\p{S}]/gu, '').toLocaleLowerCase();
      const target = normalize(movie.title);
      const match = response.list.find((entry) => normalize(entry.name) === target);
      if (!match) {
        setPlaybackError('暂未在已启用的点播源中找到《' + movie.title + '》的准确资源，请更换点播源后重试。');
        return;
      }
      setQuickPlayItem(match);
    } catch (error) {
      setPlaybackError(error instanceof Error ? error.message : '获取影片详情失败，请稍后重试。');
    }
  };
  return (
    <div className="v4-spatial-screen min-h-screen" data-screen={screen}>
      <V4HomepageHeader />
      <main className="v4-spatial-main">
        <div className="v4-spatial-heading">
          <div>
            {copy.eyebrow ? <span className="v4-spatial-eyebrow">{copy.eyebrow}</span> : null}
            <h1>{copy.title}</h1>
            <p>{copy.subtitle}</p>
          </div>

        </div>

        {screen === 'movies' ? <CatalogScreen category="movie" onPick={openRecommendation} /> : null}
        {screen === 'tv' ? <CatalogScreen category="tv" onPick={openRecommendation} /> : null}
        {screen === 'variety' ? <CatalogScreen category="variety" onPick={openRecommendation} /> : null}
        {screen === 'overseas' ? <CatalogScreen category="overseas" onPick={openRecommendation} /> : null}
        {screen === 'anime' ? <AnimeScreen onPick={openRecommendation} /> : null}
        {screen === 'resources' ? <ResourcesScreen onPick={setQuickPlayItem} /> : null}
        {screen === 'me' ? <MeScreen /> : null}
        {screen === 'settings' ? <SettingsScreen /> : null}
      </main>
      {playbackError ? <p className="v4-spatial-footnote" role="status">{playbackError}</p> : null}
      <HomeInlinePlayer item={quickPlayItem} onClose={() => setQuickPlayItem(null)} />
    </div>
  );
}

type CatalogCategory = 'movie' | 'tv' | 'variety' | 'overseas';

const CATALOG_TAGS: Record<CatalogCategory, string[]> = {
  movie: ['热门', '最新', '经典', '豆瓣高分', '冷门佳片', '华语', '欧美', '韩国', '日本'],
  tv: ['热门', '国产剧', '美剧', '英剧', '韩剧', '日剧', '港剧'],
  variety: ['综艺'],
  overseas: ['热门', '美剧', '英剧', '韩剧', '日剧', '泰剧'],
};

function CatalogScreen({ category, onPick }: { category: CatalogCategory; onPick: (item: DoubanItem) => void }) {
  const tags = CATALOG_TAGS[category];
  const [tag, setTag] = useState(tags[0]);
  const type = category === 'movie' ? 'movie' : 'tv';
  const query = useQuery({
    queryKey: ['catalog', category, tag],
    queryFn: ({ signal }) => api.douban(type, tag, 0, 50, signal),
    // A transient upstream failure should not leave the catalogue retrying
    // invisibly for a long time; cached results remain usable across tabs.
    staleTime: 5 * 60 * 1000,
    retry: 1,
    retryDelay: 900,
    refetchOnWindowFocus: true,
  });
  const [loadingStalled, setLoadingStalled] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    if (!query.isLoading) {
      setLoadingStalled(false);
      return;
    }
    const timer = window.setTimeout(() => setLoadingStalled(true), 12000);
    return () => window.clearTimeout(timer);
  }, [query.isLoading, category, tag, loadAttempt]);
  const items = query.data?.items ?? [];
  return (
    <section className="v4-spatial-panel" aria-label={`${COPY[category === 'movie' ? 'movies' : category].title}推荐`}>
      <div className="v4-spatial-panel-head"><h2>{COPY[category === 'movie' ? 'movies' : category].title}推荐</h2><span>豆瓣实时数据</span></div>
      <div className="v4-catalog-filters mb-4">
        {tags.map((item) => (
          <button key={item} type="button" aria-pressed={tag === item}
            className={tag === item ? 'px-3 py-1.5 rounded-full text-xs bg-accent text-on-accent' : 'px-3 py-1.5 rounded-full text-xs bg-chip text-muted hover:text-content'}
            onClick={() => setTag(item)}>{item}</button>
        ))}
      </div>
      {query.isError ? (
        <div className="v4-spatial-empty flex flex-col items-center gap-3" role="alert">
          <span>分类数据暂时无法加载，请检查网络后重试。</span>
          <button type="button" className="v4-spatial-primary" onClick={() => void query.refetch()}>重新加载海报</button>
        </div>
      ) : query.isLoading && !loadingStalled ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3" aria-label="正在加载海报" aria-busy="true">{Array.from({ length: 12 }, (_, i) => <div key={i} className="aspect-[2/3] rounded-lg bg-chip animate-pulse" />)}</div>
      ) : query.isLoading ? (
        <div className="v4-spatial-empty flex flex-col items-center gap-3" role="status">
          <span>海报请求超过 12 秒仍未完成，可能是上游数据源响应缓慢。</span>
          <button type="button" className="v4-spatial-primary" onClick={() => { setLoadingStalled(false); setLoadAttempt((value) => value + 1); void query.refetch(); }}>重试加载</button>
        </div>
      ) : items.length === 0 ? (
        <div className="v4-spatial-empty">该分类暂无推荐内容。</div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
          {items.map((item) => <DoubanCard key={item.id} item={item} isTv={type === 'tv'} enableTmdbFallback onClick={() => onPick(item)} />)}
        </div>
      )}
    </section>
  );
}

function MoviesScreen({ onPick }: { onPick: (item: DoubanItem) => void }) {
  return (
    <section className="v4-spatial-panel" aria-label="影视推荐">
      <div className="v4-spatial-panel-head"><h2>热门影视</h2><span>实时推荐数据</span></div>
      <RecommendSection onPick={onPick} />
    </section>
  );
}

function AnimeScreen({ onPick }: { onPick: (item: DoubanItem) => void }) {
  return (
    <>
      <section className="v4-spatial-panel v4-anime-feature">
        <div className="v4-spatial-panel-head"><h2>每日放送</h2><span>Bangumi · 当季日历</span></div>
        <AnimeRecommendationSection onPick={onPick} />
      </section>
      <p className="v4-spatial-footnote">新番数据来自现有 Bangumi 日历接口；无数据时显示空状态，不使用示例海报填充。</p>
    </>
  );
}

function ResourcesScreen({ onPick }: { onPick: (item: SearchResultItem) => void }) {
  const selectedKeys = useAppStore((s) => s.selectedKeys);
  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const sourceHealth = useAppStore((s) => s.sourceHealth);
  const subscriptions = useAppStore((s) => s.subscriptions);
  const yellowFilter = useAppStore((s) => s.yellowFilter);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const all = [...envSources, ...customAPIs];
  const activeSources = selectedKeys
    .map((key) => resolveSource({ customAPIs, envSources }, key))
    .filter((source): source is SourceConfig => Boolean(
      source && validateSourceUrl(source.url) &&
      !isSourceDisabled({ sourceHealth }, source.key) &&
      !isInDisabledSubscription({ subscriptions }, source.key)
    ));
  const runSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const keyword = query.trim().slice(0, 100);
    if (!keyword) return;
    if (activeSources.length === 0) {
      setError('请先在设置中启用至少一个可用点播源。');
      setResults([]);
      return;
    }
    setSearching(true);
    setError('');
    try {
      const response = await api.search(keyword, activeSources, yellowFilter);
      setResults(response.list);
      if (response.list.length === 0) setError('没有在当前启用的点播源中找到结果。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '资源搜索失败，请稍后重试。');
      setResults([]);
    } finally {
      setSearching(false);
    }
  };
  const sourceName = (key: string) =>
    all.find((source) => source.key === key)?.name ?? key;

  return (
    <div className="v4-resources-layout space-y-5">
      <section className="v4-spatial-panel">
        <div className="v4-spatial-panel-head"><h2>搜索播放资源</h2><span>{activeSources.length} 个可用点播源</span></div>
        <form className="v4-resource-search" onSubmit={runSearch}>
          <input aria-label="搜索影视资源" value={query} maxLength={100} onChange={(event) => setQuery(event.target.value)} placeholder="搜索片名、剧集…" />
          <button type="submit" disabled={searching || !query.trim()}>{searching ? '搜索中…' : '搜索资源'}</button>
        </form>
        {error ? <p className="v4-resource-feedback" role="status">{error}</p> : null}
        {results.length > 0 ? (
          <div className="v4-resource-results">
            {results.map((item) => (
              <button key={`${item.sourceKey}:${item.vodId}`} type="button" onClick={() => onPick(item)} className="v4-resource-result">
                <div><strong>{item.name}</strong><span>{sourceName(item.sourceKey)} · {item.remarks || '可查看详情'}</span></div>
                <b>立即播放 ›</b>
              </button>
            ))}
          </div>
        ) : null}
      </section>
      <section className="v4-spatial-panel">
        <div className="v4-spatial-panel-head"><h2>已配置的数据源</h2><span>{all.length} 个来源 · {selectedKeys.length} 个已勾选</span></div>
        {all.length === 0 ? (
          <div className="v4-spatial-empty"><strong>还没有配置点播源</strong><p>添加一个兼容的采集 API 后，即可搜索和播放影视内容。</p></div>
        ) : (
          <div className="v4-source-grid">
            {all.map((source) => {
              const selected = selectedKeys.includes(source.key);
              const health = sourceHealth[source.key];
              return (
                <article className="v4-source-card" key={source.key}>
                  <div className="v4-source-status"><i className={selected ? 'is-enabled' : ''} />{selected ? '已勾选' : '未勾选'}</div>
                  <h3>{source.name}</h3>
                  <p title={source.url}>{source.url}</p>
                  <span>{health?.ok ? `最近响应 ${health.ms}ms` : health?.error ? '最近请求异常' : '尚无健康度记录'}</span>
                </article>
              );
            })}
          </div>
        )}
        <button type="button" className="v4-spatial-primary" onClick={() => window.dispatchEvent(new CustomEvent('libretv:open-source-manager'))}>管理点播源与订阅</button>
      </section>
    </div>
  );
}

function MeScreen() {
  const history = useLiveQuery(() => db.history.orderBy('timestamp').reverse().limit(24).toArray(), []);
  const downloads = useLiveQuery(() => db.downloads.orderBy('createdAt').reverse().limit(20).toArray(), []);
  const favorites = useLiveQuery(() => db.favorites.orderBy('addedAt').reverse().toArray(), []);
  const liveFavorites = useAppStore((state) => state.liveFavorites);
  return (
    <div className="v4-me-layout">
      <section className="v4-me-cover" aria-label="我的个人空间封面">
        <div className="v4-me-cover-art" aria-hidden="true">
          <span className="v4-me-cover-orbit v4-me-cover-orbit-one" />
          <span className="v4-me-cover-orbit v4-me-cover-orbit-two" />
          <span className="v4-me-cover-glow" />
        </div>
        <div className="v4-me-cover-profile">
          <div className="v4-me-profile-avatar" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="8" r="3.5" />
              <path d="M4.8 20c.7-3.4 3.1-5.2 7.2-5.2s6.5 1.8 7.2 5.2" />
            </svg>
          </div>
          <div className="v4-me-cover-copy">
            <span className="v4-me-cover-eyebrow">LIBRETV · PERSONAL SPACE</span>
            <h2>我的空间</h2>
            <p>收藏你的观影轨迹，接着上次的进度继续观看。</p>
          </div>
          <div className="v4-me-local-badge"><span />仅保存在本机</div>
        </div>
      </section>

      <section className="v4-spatial-panel v4-me-history-panel">
        <div className="v4-spatial-panel-head"><h2>继续观看</h2><span>{history?.length ?? 0} 条本机记录</span></div>
        {!history ? <div className="v4-spatial-empty">正在读取本机观看记录…</div> : history.length === 0 ? (
          <div className="v4-spatial-empty"><strong>还没有观看记录</strong><p>播放过的影片和进度会自动出现在这里。</p></div>
        ) : (
          <div className="v4-me-history-grid">{history.map((item) => <MeHistoryCard key={item.id} item={item} />)}</div>
        )}
      </section>
      <section className="v4-spatial-panel v4-me-history-panel">
        <div className="v4-spatial-panel-head"><h2>影视收藏</h2><span>{favorites?.length ?? 0} 部影片</span></div>
        {!favorites ? <div className="v4-spatial-empty">正在读取影视收藏…</div> : favorites.length === 0 ? (
          <div className="v4-spatial-empty"><strong>还没有收藏影视</strong><p>在电影或电视剧搜索结果卡片上点击心形按钮，即可保存到这里。</p></div>
        ) : (
          <div className="v4-me-history-grid">{favorites.map((item) => <MeFavoriteCard key={item.id} item={item} />)}</div>
        )}
      </section>
      <section className="v4-spatial-panel v4-me-library-actions">
        <button type="button" className="v4-settings-card" onClick={() => window.dispatchEvent(new CustomEvent('libretv:open-history-panel'))}>
          <div><strong>全部观看历史</strong><p>{history?.length ?? 0} 条最近记录 · 搜索、删除与继续播放</p></div><b aria-hidden="true">›</b>
        </button>
        <Link href="/search" className="v4-settings-card"><div><strong>搜索记录</strong><p>查看最近搜索并快速重新搜索</p></div><b aria-hidden="true">›</b></Link>
        <Link href="/live" className="v4-settings-card"><div><strong>频道收藏</strong><p>{liveFavorites.length} 个已收藏频道</p></div><b aria-hidden="true">›</b></Link>
        <button type="button" className="v4-settings-card" onClick={() => requestShowDownloadManager()}>
          <div><strong>下载管理</strong><p>{downloads?.length ?? 0} 个本机下载任务 · 查看进度与管理文件</p></div><b aria-hidden="true">›</b>
        </button>
      </section>
      <section className="v4-spatial-panel v4-me-settings-entry">
        <Link href="/settings" className="v4-settings-card"><div><strong>设置</strong><p>外观、播放、资源管理、采集中心与隐私设置</p></div><b aria-hidden="true">›</b></Link>
      </section>
    </div>
  );
}

function MeFavoriteCard({ item }: { item: FavoriteEntry }) {
  const imageProxyMode = useAppStore((state) => state.imageProxyMode);
  const customImageProxy = useAppStore((state) => state.customImageProxy);
  const customAPIs = useAppStore((state) => state.customAPIs);
  const envSources = useAppStore((state) => state.envSources);
  const source = resolveSource({ customAPIs, envSources }, item.sourceKey);
  const href = buildWatchUrl({ sourceKey: item.sourceKey, vodId: item.vodId, index: 0, title: item.title, sourceUrl: source?.url ?? item.sourceUrl, detail: source?.detail });
  return (
    <article className="v4-me-history-card relative">
      <Link href={href} className="flex min-w-0 flex-1 items-center gap-3">
        <div className="v4-me-history-image">{item.pic ? <SmartImage url={item.pic} mode={imageProxyMode} customProxy={customImageProxy} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <span>▶</span>}</div>
        <div className="v4-me-history-copy min-w-0"><strong>{item.title}</strong><span>{[item.year, item.typeName, item.sourceName].filter(Boolean).join(' · ')}</span></div>
      </Link>
      <button type="button" className="ml-2 shrink-0 rounded-lg px-3 py-2 text-xs text-muted hover:bg-chip" aria-label={"取消收藏 " + item.title} onClick={() => { void removeFavorite(item.sourceKey, item.vodId); }}>取消收藏</button>
    </article>
  );
}

function MeHistoryCard({ item }: { item: HistoryEntry }) {
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const source = resolveSource({ customAPIs, envSources }, item.sourceKey);
  const href = buildWatchUrl({ sourceKey: item.sourceKey, vodId: item.vodId, index: item.episodeIndex, title: item.title, sourceUrl: source?.url ?? item.sourceUrl, detail: source?.detail });
  const percent = item.duration > 0 ? Math.max(0, Math.min(100, Math.round(item.playbackPosition / item.duration * 100))) : 0;
  return (
    <Link className="v4-me-history-card" href={href}>
      <div className="v4-me-history-image">
        {item.pic ? <SmartImage url={item.pic} mode={imageProxyMode} customProxy={customImageProxy} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <span>▶</span>}
      </div>
      <div className="v4-me-history-copy"><strong>{item.title}</strong><span>第 {item.episodeIndex + 1} 集 · {formatTime(item.playbackPosition)}</span><div><i style={{ width: `${percent}%` }} /></div></div>
    </Link>
  );
}

const SETTINGS_GROUPS = [
  { title: '播放与过滤', description: '自动连播、片头片尾跳过与播放缓存', page: 'playback', icon: 'play', tone: '#0A84FF' },
  { title: '语言设置', description: '界面语言与 Friday 对话语言', page: 'language', icon: 'globe', tone: '#64D2FF' },
  { title: '首页与内容', description: '首页推荐与内容偏好', page: 'home', icon: 'house', tone: '#30D158' },
  { title: '外观模式', description: '浅色、深色与跟随系统主题', page: 'appearance', icon: 'sun', tone: '#FF9F0A' },
  { title: '封面图加载', description: '海报图片代理与加载偏好', page: 'image', icon: 'image', tone: '#BF5AF2' },
  { title: '点播源管理', description: '点播来源、优先级与健康检测', page: 'vod', icon: 'server', tone: '#5E5CE6' },
  { title: '直播设置', description: '管理直播源与频道', page: 'live', icon: 'radio', tone: '#FF375F' },
  { title: '资源订阅', description: '管理点播与直播资源订阅', page: 'subs', icon: 'bookmark', tone: '#30D158' },
  { title: '资源采集中心', description: 'FMHY 目录与 Scrapling 采集引擎', page: 'collector', icon: 'layers', tone: '#0A84FF' },
  { title: 'Friday 语音', description: '助手角色、语音音色与唤醒方式', page: 'voice', icon: 'audio', tone: '#FF9F0A' },
  { title: '配置导入与导出', description: '备份或恢复本机配置', page: 'io', icon: 'arrow', tone: '#64D2FF' },
  { title: '本机缓存', description: '查看和管理本机视频缓存', page: 'cache', icon: 'storage', tone: '#8E8E93' },
] as const;

function SettingsCategoryIcon({ name }: { name: (typeof SETTINGS_GROUPS)[number]['icon'] }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 24 24" width="23" height="23" aria-hidden="true" {...common}>
      {name === 'play' ? <><path d="M5 4.8a1.5 1.5 0 0 1 2.2-1.3l12 7a1.7 1.7 0 0 1 0 3l-12 7A1.5 1.5 0 0 1 5 19.2z" /></> : null}
      {name === 'globe' ? <><circle cx="12" cy="12" r="9" /><path d="M3.5 12h17M12 3c2.3 2.5 3.4 5.5 3.4 9S14.3 18.5 12 21c-2.3-2.5-3.4-5.5-3.4-9S9.7 5.5 12 3z" /></> : null}
      {name === 'house' ? <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" /></> : null}
      {name === 'sun' ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></> : null}
      {name === 'image' ? <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="m21 15-5-5L5 20" /></> : null}
      {name === 'server' ? <><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01M11 7.5h6M11 16.5h6" /></> : null}
      {name === 'radio' ? <><path d="M4 9a12 12 0 0 1 16 0M7 12a7.5 7.5 0 0 1 10 0m-7 3a3 3 0 0 1 4 0" /><circle cx="12" cy="19" r="1" /></> : null}
      {name === 'bookmark' ? <><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4z" /></> : null}
      {name === 'layers' ? <><path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5" /></> : null}
      {name === 'audio' ? <><path d="M3 10v4m4-7v10m4-13v16m4-13v10m4-7v4" /></> : null}
      {name === 'arrow' ? <><path d="M12 3v12m-4-4 4 4 4-4M5 17v4h14v-4" /></> : null}
      {name === 'storage' ? <><ellipse cx="12" cy="5" rx="8.5" ry="3" /><path d="M3.5 5v7c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3V5M3.5 12v7c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3v-7" /></> : null}
    </svg>
  );
}

function SettingsScreen() {
  const [query, setQuery] = useState('');
  const filteredGroups = SETTINGS_GROUPS.filter((group) =>
    `${group.title} ${group.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  );

  const openCategory = (page: string) => {
    try {
      window.localStorage.setItem('libretv-settings-open-page', page);
    } catch {
      // 即使浏览器禁用本地存储，也仍然打开现有设置抽屉。
    }
    window.dispatchEvent(new CustomEvent('libretv:open-source-manager'));
  };

  return (
    <section className="v4-settings-apple" aria-label="设置分类">
      <label className="v4-settings-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></svg>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索设置" aria-label="搜索设置" />
        {query ? <button type="button" onClick={() => setQuery('')} aria-label="清除搜索">×</button> : null}
      </label>
      <div className="v4-settings-apple-list">
        {filteredGroups.length ? filteredGroups.map((group, index) => (
          <button key={group.page} type="button" className="v4-settings-apple-row" onClick={() => openCategory(group.page)}>
            <span className="v4-settings-apple-icon" style={{ color: group.tone }}><SettingsCategoryIcon name={group.icon} /></span>
            <span className="v4-settings-apple-copy">
              <strong>{group.title}</strong>
              <small>{group.description}</small>
            </span>
            <svg className="v4-settings-apple-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>
            {index < filteredGroups.length - 1 ? <span className="v4-settings-apple-divider" aria-hidden="true" /> : null}
          </button>
        )) : <p className="v4-settings-apple-empty">没有找到相关设置</p>}
      </div>
      <p className="v4-settings-apple-footnote">设置保存在本机；打开分类后继续使用现有配置面板。</p>
    </section>
  );
}
