'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { SmartImage } from '@/components/smart-image';
import { allLiveSources, useAppStore } from '@/lib/store';

const categories = [
  { key: 'movies', href: '/movies', title: '电影' },
  { key: 'tv', href: '/tv', title: '电视剧' },
  { key: 'anime', href: '/anime', title: '动漫' },
  { key: 'overseas', href: '/overseas', title: '海外剧' },
  { key: 'variety', href: '/variety', title: '综艺' },
  { key: 'live', href: '/live', title: '直播' },
] as const;

export function CategoriesGallery() {
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const liveEnvSources = useAppStore((s) => s.liveEnvSources);
  const liveSubscriptions = useAppStore((s) => s.liveSubscriptions);
  const liveSelectedUrls = useAppStore((s) => s.liveSelectedUrls);
  const liveSources = allLiveSources({ liveEnvSources, liveSubscriptions })
    .filter((source) => liveSelectedUrls.includes(source.url));

  const movie = useQuery({ queryKey: ['category-cover', 'movie'], queryFn: ({ signal }) => api.douban('movie', '热门', 0, 8, signal), staleTime: 5 * 60_000 });
  const tv = useQuery({ queryKey: ['category-cover', 'tv'], queryFn: ({ signal }) => api.douban('tv', '热门', 0, 8, signal), staleTime: 5 * 60_000 });
  const anime = useQuery({ queryKey: ['category-cover', 'anime'], queryFn: ({ signal }) => api.bangumiCalendar(signal), staleTime: 5 * 60_000 });
  const overseas = useQuery({ queryKey: ['category-cover', 'overseas'], queryFn: ({ signal }) => api.douban('tv', '美剧', 0, 8, signal), staleTime: 5 * 60_000 });
  const variety = useQuery({ queryKey: ['category-cover', 'variety'], queryFn: ({ signal }) => api.douban('tv', '综艺', 0, 8, signal), staleTime: 5 * 60_000 });
  const live = useQuery({
    queryKey: ['category-cover', 'live', liveSources.map((source) => source.url).join('|')],
    queryFn: async () => {
      const results = await Promise.allSettled(liveSources.map((source) => api.livePlaylist(source.url)));
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const channel = result.value.channels.find((item) => item.logo);
        if (channel?.logo) return channel.logo;
      }
      return undefined;
    },
    enabled: liveSources.length > 0,
    staleTime: 10 * 60_000,
  });

  const covers: Record<(typeof categories)[number]['key'], string | undefined> = {
    movies: movie.data?.items.find((item) => item.cover)?.cover,
    tv: tv.data?.items.find((item) => item.cover)?.cover,
    anime: anime.data?.days.flatMap((day) => day.items).find((item) => item.cover)?.cover,
    overseas: overseas.data?.items.find((item) => item.cover)?.cover,
    variety: variety.data?.items.find((item) => item.cover)?.cover,
    live: live.data,
  };

  return (
    <nav className="v4-category-grid" aria-label="影视分类">
      {categories.map((category) => {
        const cover = covers[category.key];
        return (
          <Link key={category.href} href={category.href} className={cover ? 'v4-category-card has-cover' : 'v4-category-card'}>
            {cover ? (
              <SmartImage url={cover} mode={imageProxyMode} customProxy={customImageProxy} alt="" className="v4-category-cover" />
            ) : (
              <span className="v4-category-cover-placeholder" aria-hidden="true" />
            )}
            <span className="v4-category-title">{category.title}</span>
          </Link>
        );
      })}
    </nav>
  );
}
