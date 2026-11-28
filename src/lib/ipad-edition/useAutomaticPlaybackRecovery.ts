'use client';

import { useEffect, useState } from 'react';
import { useAppStore, resolveSource, isInDisabledSubscription, isSourceDisabled } from '../store';
import { validateSourceUrl } from '../utils';
import { findVerifiedIpadResource, ipadResourceKey } from './playback-coordinator';
import type { IpadMovieIdentity } from './movie-identity';

export interface IpadRecoveryOptions {
  enabled: boolean;
  expected: IpadMovieIdentity;
  sourceKey: string;
  vodId: string;
  index: number;
  query: string;
  requestKey?: string;
  resumePosition?: number;
  router: { replace: (href: string) => void };
}

/**
 * Silent, bounded, identity-checked automatic recovery.
 * It never presents a selection UI, falls back to old generic error handling
 * only when no trustworthy alternative is available, and never crosses into
 * other unrelated films solely to achieve playback success.
 */
export function useAutomaticIpadPlaybackRecovery(options: IpadRecoveryOptions): boolean {
  const { enabled, expected, sourceKey, vodId, index, query, router, requestKey = 'initial', resumePosition } = options;
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const key = sourceKey + '|' + vodId + '|' + query + '|' + requestKey;
  const targetTitle = expected.titles[0] || '';
  const originalTitle = expected.titles[1] || '';
  const expectedYear = expected.year;
  const expectedType = expected.type;

  useEffect(() => {
    if (!enabled || failedKey === key) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); setFailedKey(key); }, 15_000);
    const run = async () => {
      const state = useAppStore.getState();
      const sources = Array.from(new Map(state.selectedKeys
        .map((sourceKey) => resolveSource(state, sourceKey))
        .filter((source) => source && validateSourceUrl(source.url)
          && !isSourceDisabled(state, source.key)
          && !isInDisabledSubscription(state, source.key))
        .map((source) => [source!.key, source!] as const)).values());
      const params = new URLSearchParams(query);
      const tried = (params.get('recoveryTried') || '').split(',').filter(Boolean).slice(-5);
      const current = ipadResourceKey(sourceKey, vodId);
      const excluded = new Set([...tried, current]);
      const result = await findVerifiedIpadResource({
        expected: { titles: [targetTitle, originalTitle], year: expectedYear, type: expectedType },
        sources, yellowFilter: state.yellowFilter, signal: controller.signal,
        excluded, maxDetails: 12, requiredEpisodeCount: Math.max(1, index + 1),
      });
      if (controller.signal.aborted) return;
      if (!result) {
        setFailedKey(key);
        return;
      }
      const nextKey = ipadResourceKey(result.source.key, result.item.vodId);
      if (excluded.has(nextKey)) {
        setFailedKey(key);
        return;
      }
      params.set('source', result.source.key);
      params.set('id', result.item.vodId);
      params.set('sourceUrl', result.item.sourceUrl || result.source.url);
      if (result.item.year) params.set('identitySearchYear', result.item.year);
      else params.delete('identitySearchYear');
      params.set('index', String(Math.max(0, index)));
      if (resumePosition !== undefined && Number.isFinite(resumePosition) && resumePosition > 5) {
        params.set('position', String(Math.floor(resumePosition)));
      }
      params.set('recoveryTried', [...tried, current].slice(-5).join(','));
      // These belong to the previous provider, never re-use them on a new provider.
      params.delete('url');
      params.delete('detail');
      router.replace('/ipad-edition/watch?' + params.toString());
    };
    void run().catch(() => {
      if (!controller.signal.aborted) setFailedKey(key);
    }).finally(() => clearTimeout(timeout));
    return () => { controller.abort(); clearTimeout(timeout); };
    // The query string is the identity of a recovery attempt; a new playback
    // request is allowed its own attempt without background polling.
  }, [enabled, key, sourceKey, vodId, index, query, router, failedKey, resumePosition,
    targetTitle, originalTitle, expectedYear, expectedType]);

  return enabled && failedKey !== key;
}
