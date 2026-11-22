'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client-api';
import { isInDisabledSubscription, isSourceDisabled, resolveSource, useAppStore } from '@/lib/store';
import type { DoubanItem, SearchResultItem, SourceConfig } from '@/lib/types';
import { validateSourceUrl } from '@/lib/utils';

function normalizeTitle(value: string) {
  return value.replace(/[\\s\\p{P}\\p{S}]/gu, '').toLocaleLowerCase();
}

/** Resolves recommendation metadata to a real enabled CMS resource before opening detail. */
export function useIpadEditionPosterNavigation() {
  const router = useRouter();
  const selectedKeys = useAppStore((state) => state.selectedKeys);
  const customAPIs = useAppStore((state) => state.customAPIs);
  const envSources = useAppStore((state) => state.envSources);
  const yellowFilter = useAppStore((state) => state.yellowFilter);
  const sourceHealth = useAppStore((state) => state.sourceHealth);
  const subscriptions = useAppStore((state) => state.subscriptions);
  const [pendingTitle, setPendingTitle] = useState('');
  const [error, setError] = useState('');

  const selectedSources = useMemo(() => selectedKeys
    .map((key) => resolveSource({ customAPIs, envSources }, key))
    .filter((source): source is SourceConfig => Boolean(
      source && validateSourceUrl(source.url) &&
      !isSourceDisabled({ sourceHealth }, source.key) &&
      !isInDisabledSubscription({ subscriptions }, source.key)
    )), [selectedKeys, customAPIs, envSources, sourceHealth, subscriptions]);

  const openPoster = useCallback(async (movie: DoubanItem) => {
    setError('');
    if (selectedSources.length === 0) {
      setError('没有可用的已启用点播源。请先到设置中启用点播源。');
      return;
    }

    setPendingTitle(movie.title);
    try {
      const response = await api.search(movie.title, selectedSources, yellowFilter);
      const target = normalizeTitle(movie.title);
      const match = response.list.find((entry) => normalizeTitle(entry.name) === target);
      if (!match) {
        setError('已搜索已启用的点播源，但没有找到《' + movie.title + '》的准确资源。请换一个片名或检查资源内容。');
        return;
      }

      const params = new URLSearchParams({
        source: match.sourceKey,
        id: match.vodId,
        title: match.name,
        sourceName: match.sourceName,
      });
      if (match.pic || movie.cover) params.set('pic', match.pic || movie.cover);
      if (movie.rating) params.set('rating', movie.rating);
      if (match.sourceUrl) params.set('sourceUrl', match.sourceUrl);
      router.push('/ipad-edition/detail?' + params.toString());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '搜索已启用的点播源失败，请稍后重试。');
    } finally {
      setPendingTitle('');
    }
  }, [selectedSources, yellowFilter, router]);

  return { openPoster, pendingTitle, error, clearError: () => setError('') };
}
