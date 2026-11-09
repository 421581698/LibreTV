'use client';

import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { V4HomepageHeader } from '@/components/home/V4HomepageHeader';
import { AnimeRecommendationSection, RecommendSection } from '@/components/douban-section';
import { DoubanCard } from '@/components/video-card';
import { GlassPanel } from '@/components/ui/glass';
import { SmartImage } from '@/components/smart-image';
import { db, type HistoryEntry } from '@/lib/db';
import { isInDisabledSubscription, isSourceDisabled, resolveSource, useAppStore } from '@/lib/store';
import type { DoubanItem, SearchResultItem, SourceConfig } from '@/lib/types';
import { api } from '@/lib/client-api';
import { validateSourceUrl } from '@/lib/utils';
import { buildWatchUrl, formatTime } from '@/lib/utils';

type Screen = 'movies' | 'tv' | 'anime' | 'variety' | 'overseas' | 'resources' | 'me' | 'settings';
const COPY: Record<Screen, { eyebrow: string; title: string; subtitle: string }> = {
  movies: { eyebrow: 'LIBRARY / MOVIES', title: '电影', subtitle: '发现热门、新片与高分电影。内容来自实时豆瓣推荐。' },
  tv: { eyebrow: 'LIBRARY / TV SERIES', title: '电视剧', subtitle: '浏览热门电视剧与不同地区的剧集推荐。' },
  variety: { eyebrow: 'LIBRARY / VARIETY', title: '综艺', subtitle: '浏览真实综艺推荐与热门节目。' },
  overseas: { eyebrow: 'LIBRARY / OVERSEAS DRAMA', title: '海外剧', subtitle: '按美剧、英剧、韩剧、日剧等分类发现海外剧集。' },
  anime: { eyebrow: 'LIBRARY / ANIME', title: '动漫', subtitle: '按星期查看 Bangumi 当季放送，追踪正在更新的新番。' },
  resources: { eyebrow: 'LIBRARY / SOURCES', title: '资源', subtitle: '管理真实接入的点播源、订阅和源健康状态，不展示虚构网盘结果。' },
  me: { eyebrow: 'PERSONAL / LIBRARY', title: '我的', subtitle: '本机观看记录与播放进度保存在你的设备上。' },
  settings: { eyebrow: 'SYSTEM / SETTINGS', title: '设置', subtitle: '播放、外观、网络、语音与数据选项沿用现有设置模块。' },
};

export function V4SpatialScreen({ screen }: { screen: Screen }) {
  const router = useRouter();
  const copy = COPY[screen];
  return (
    <div className="v4-spatial-screen min-h-screen" data-screen={screen}>
      <V4HomepageHeader />
      <main className="v4-spatial-main">
        <div className="v4-spatial-heading">
          <div>
            <span className="v4-spatial-eyebrow">{copy.eyebrow}</span>
            <h1>{copy.title}</h1>
            <p>{copy.subtitle}</p>
          </div>
          {screen === 'settings' ? (
            <button type="button" className="v4-spatial-primary" onClick={() => window.dispatchEvent(new CustomEvent('libretv:open-source-manager'))}>
              打开完整设置
            </button>
          ) : null}
        </div>

        {screen === 'movies' ? <CatalogScreen category="movie" onPick={(item) => router.push(`/?s=${encodeURIComponent(item.title)}`)} /> : null}
        {screen === 'tv' ? <CatalogScreen category="tv" onPick={(item) => router.push(`/?s=${encodeURIComponent(item.title)}`)} /> : null}
        {screen === 'variety' ? <CatalogScreen category="variety" onPick={(item) => router.push(`/?s=${encodeURIComponent(item.title)}`)} /> : null}
        {screen === 'overseas' ? <CatalogScreen category="overseas" onPick={(item) => router.push(`/?s=${encodeURIComponent(item.title)}`)} /> : null}
        {screen === 'anime' ? <AnimeScreen onPick={(item) => router.push(`/?s=${encodeURIComponent(item.title)}`)} /> : null}
        {screen === 'resources' ? <ResourcesScreen /> : null}
        {screen === 'me' ? <MeScreen /> : null}
        {screen === 'settings' ? <SettingsScreen /> : null}
      </main>
      <MobileScreenTabs active={screen} />
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
  });
  const items = query.data?.items ?? [];
  return (
    <section className="v4-spatial-panel" aria-label={`${COPY[category === 'movie' ? 'movies' : category].title}推荐`}>
      <div className="v4-spatial-panel-head"><h2>{COPY[category === 'movie' ? 'movies' : category].title}推荐</h2><span>豆瓣实时数据</span></div>
      <div className="flex flex-wrap gap-2 mb-4">
        {tags.map((item) => (
          <button key={item} type="button" aria-pressed={tag === item}
            className={tag === item ? 'px-3 py-1.5 rounded-full text-xs bg-accent text-on-accent' : 'px-3 py-1.5 rounded-full text-xs bg-chip text-muted hover:text-content'}
            onClick={() => setTag(item)}>{item}</button>
        ))}
      </div>
      {query.isError ? (
        <div className="v4-spatial-empty" role="alert">分类数据加载失败，请稍后重试。</div>
      ) : query.isLoading ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">{Array.from({ length: 12 }, (_, i) => <div key={i} className="aspect-[2/3] rounded-lg bg-chip animate-pulse" />)}</div>
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

function ResourcesScreen() {
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
    <div className="space-y-5">
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
              <Link key={`${item.sourceKey}:${item.vodId}`} href={`/?s=${encodeURIComponent(item.name)}`} className="v4-resource-result">
                <div><strong>{item.name}</strong><span>{sourceName(item.sourceKey)} · {item.remarks || '可查看详情'}</span></div>
                <b>查看详情 ›</b>
              </Link>
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
  return (
    <section className="v4-spatial-panel">
      <div className="v4-spatial-panel-head"><h2>继续观看</h2><span>{history?.length ?? 0} 条本机记录</span></div>
      {!history ? <div className="v4-spatial-empty">正在读取本机观看记录…</div> : history.length === 0 ? (
        <div className="v4-spatial-empty"><strong>还没有观看记录</strong><p>播放过的影片和进度会自动出现在这里。</p></div>
      ) : (
        <div className="v4-me-history-grid">{history.map((item) => <MeHistoryCard key={item.id} item={item} />)}</div>
      )}
    </section>
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

function SettingsScreen() {
  const groups = [
    ['播放与过滤', '默认清晰度、自动连播、片头片尾过滤'],
    ['外观与封面', '主题、封面图代理与加载策略'],
    ['网络与数据源', '点播源、直播源、订阅与健康检测'],
    ['Friday 语音', '语音识别、播报声音与对话偏好'],
    ['数据管理', '配置导入导出与本机缓存'],
  ];
  return (
    <section className="v4-spatial-panel">
      <div className="v4-settings-grid">
        {groups.map(([title, description], index) => (
          <button key={title} type="button" className="v4-settings-card" onClick={() => window.dispatchEvent(new CustomEvent('libretv:open-source-manager'))}>
            <span>0{index + 1}</span><div><strong>{title}</strong><p>{description}</p></div><b>›</b>
          </button>
        ))}
      </div>
      <p className="v4-spatial-footnote">设置项由现有设置抽屉执行和持久化；此页不创建第二套互相冲突的配置状态。</p>
    </section>
  );
}

function MobileScreenTabs({ active }: { active: Screen }) {
  const items = [{ href: '/', label: '首页' }, { href: '/movies', label: '电影' }, { href: '/tv', label: '电视剧' }, { href: '/anime', label: '动漫' }, { href: '/variety', label: '综艺' }, { href: '/overseas', label: '海外剧' }, { href: '/live', label: '直播' }];
  return (
    <nav className="v4-mobile-tabs" aria-label="移动端导航">
      {items.map((item) => <Link key={item.href} href={item.href} className={(active === 'movies' && item.href === '/movies') || (active === 'tv' && item.href === '/tv') || (active === 'anime' && item.href === '/anime') || (active === 'variety' && item.href === '/variety') || (active === 'overseas' && item.href === '/overseas') ? 'is-active' : ''} >{item.label}</Link>)}
    </nav>
  );
}
