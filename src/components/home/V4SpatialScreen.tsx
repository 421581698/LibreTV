'use client';

import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { V4HomepageHeader } from '@/components/home/V4HomepageHeader';
import { AnimeRecommendationSection, RecommendSection } from '@/components/douban-section';
import { GlassPanel } from '@/components/ui/glass';
import { SmartImage } from '@/components/smart-image';
import { db, type HistoryEntry } from '@/lib/db';
import { isInDisabledSubscription, isSourceDisabled, resolveSource, useAppStore } from '@/lib/store';
import type { DoubanItem, SearchResultItem, SourceConfig } from '@/lib/types';
import { api } from '@/lib/client-api';
import { validateSourceUrl } from '@/lib/utils';
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
