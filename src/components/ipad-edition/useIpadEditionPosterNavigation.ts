'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DoubanItem } from '@/lib/types';

/**
 * Poster taps are navigation-only. They must never query CMS playback sources;
 * source discovery belongs exclusively to the explicit Start Playback action
 * on the destination detail page.
 */
export function useIpadEditionPosterNavigation() {
  const router = useRouter();
  const [error, setError] = useState('');

  const openPoster = useCallback((movie: DoubanItem) => {
    setError('');
    const provider = (movie as DoubanItem & { provider?: string }).provider;
    const params = new URLSearchParams({ title: movie.title });
    if (movie.cover) params.set('pic', movie.cover);
    if (movie.rating) params.set('rating', movie.rating);
    if (movie.backdrop) params.set('backdrop', movie.backdrop);

    if (provider === 'tmdb' && /^\d{1,12}$/.test(movie.id)) {
      params.set('tmdbId', movie.id);
      params.set('tmdbType', movie.isTv ? 'tv' : 'movie');
    } else if (/^\d{1,12}$/.test(movie.id)) {
      // Bangumi subject IDs are not TMDB IDs. Keep their metadata identity
      // separate and load the subject detail endpoint on the detail page.
      params.set('bangumiId', movie.id);
    } else {
      setError('无法识别这张海报的资料编号，请稍后重试。');
      return;
    }

    router.push('/ipad-edition/detail?' + params.toString());
  }, [router]);

  return { openPoster, pendingTitle: '', error, clearError: () => setError('') };
}
