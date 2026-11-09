'use client';

import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRouter } from 'next/navigation';
import { V4HomepageHeader } from '@/components/home/V4HomepageHeader';
import { AnimeRecommendationSection, RecommendSection } from '@/components/douban-section';
import { GlassPanel } from '@/components/ui/glass';
import { SmartImage } from '@/components/smart-image';
import { db, type HistoryEntry } from '@/lib/db';
import { resolveSource, useAppStore } from '@/lib/store';
import type { DoubanItem } from '@/lib/types';
import { buildWatchUrl, formatTime } from '@/lib/utils';

type Screen = 'movies' | 'anime' | 'resources' | 'me' | 'settings';
const COPY: Record<Screen, { eyebrow: string; title: string; subtitle: string }> = {
  movies: { eyebrow: 'LIBRARY / MOVIES', title: '影视', subtitle: '从真实推荐与已配置的点播源中发现电影、剧集和纪录片。' },
  anime: { eyebrow: 'LIBRARY / ANIME', title: '动漫', subtitle: '按星期查看 Bangumi 当季放送，追踪正在更新的新番。' },
  resources: { eyebrow: 'LIBRARY / SOURCES', title: '资源', subtitle: '管理真实接入的点播源、订阅和源健康状态，不展示虚构网盘结果。' },
  me: { eyebrow: 'PERSONAL / LIBRARY', title: '我的', subtitle: '本机观看记录与播放进度保存在你的设备上。' },
  settings: { eyebrow: 'SYSTEM / SETTINGS', title: '设置', subtitle: '播放、外观、网络、语音与数据选项沿用现有设置模块。' },
};

export function V4SpatialScreen({ screen }: { screen: Screen }) {
  const router = useRouter();
  const copy = COPY[screen];
  return (
    <div className="v4-spatial-screen min-h-screen">
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

        {screen === 'movies' ? <MoviesScreen onPick={(item) => router.push(`/?s=${encodeURIComponent(item.title)}`)} /> : null}
        {screen === 'anime' ? <AnimeScreen onPick={(item) => router.push(`/?s=${encodeURIComponent(item.title)}`)} /> : null}
        {screen === 'resources' ? <ResourcesScreen /> : null}
        {screen === 'me' ? <MeScreen /> : null}
        {screen === 'settings' ? <SettingsScreen /> : null}
      </main>
      <MobileScreenTabs active={screen} />
    </div>
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
  const all = [...envSources, ...customAPIs];
  return (
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
  const items = [{ href: '/', label: '首页' }, { href: '/movies', label: '影视' }, { href: '/anime', label: '动漫' }, { href: '/live', label: '直播' }, { href: '/me', label: '我的' }];
  return (
    <nav className="v4-mobile-tabs" aria-label="移动端导航">
      {items.map((item) => <Link key={item.href} href={item.href} className={(active === 'movies' && item.href === '/movies') || (active === 'anime' && item.href === '/anime') || (active === 'me' && item.href === '/me') ? 'is-active' : ''} >{item.label}</Link>)}
    </nav>
  );
}
