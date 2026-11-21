'use client';

import { useMemo } from 'react';

import {
  useAppStore,
  resolveSource,
  isInDisabledSubscription,
  isSourceDisabled,
} from '@/lib/store';
import { validateSourceUrl } from '@/lib/utils';
import { rankSourcesByHealth } from '@/lib/source-ranking';
import { rankSourcesByPlaybackQuality } from '@/lib/playback-telemetry';

/**
 * 解析当前参与搜索的点播源。
 *
 * 从 app/page.tsx 原样提取，筛选与排序顺序逐项保持一致：
 *   有效 URL → 按 key 去重 → 剔除已停用源 → 剔除停用订阅 → 健康度排序 → 播放质量排序
 *
 * 提取原因：首页（点击豆瓣卡片）与搜索结果页都需要这份列表，
 * 若各自计算会产生两份逻辑，后续改动必然漏改一边。
 */
export function useSelectedSources() {
  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const selectedKeys = useAppStore((s) => s.selectedKeys);
  const sourceHealth = useAppStore((s) => s.sourceHealth);
  const playbackHealth = useAppStore((s) => s.playbackHealth);
  const subscriptions = useAppStore((s) => s.subscriptions);

  const selectedSources = useMemo(() => {
    const seen = new Set<string>();
    const sources = selectedKeys
      .map((key) => resolveSource({ customAPIs, envSources }, key))
      .filter((s): s is NonNullable<typeof s> => {
        if (!s || !validateSourceUrl(s.url) || seen.has(s.key)) {
          return false;
        }
        seen.add(s.key);
        return true;
      })
      .filter((s) => !isSourceDisabled({ sourceHealth }, s.key))
      .filter((s) => !isInDisabledSubscription({ subscriptions }, s.key));
    const searchHealthy = rankSourcesByHealth(sources, sourceHealth);
    return rankSourcesByPlaybackQuality(searchHealthy, playbackHealth);
  }, [customAPIs, envSources, selectedKeys, sourceHealth, playbackHealth, subscriptions]);

  return selectedSources;
}
