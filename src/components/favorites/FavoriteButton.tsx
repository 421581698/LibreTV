'use client';

import { useEffect, useState } from 'react';
import { getFavorite, toggleFavorite, type FavoriteEntry } from '@/lib/db';

type FavoriteButtonProps = {
  entry: Omit<FavoriteEntry, 'createdAt' | 'updatedAt'>;
  className?: string;
  label?: string;
};

export function FavoriteButton({ entry, className = '', label = '收藏' }: FavoriteButtonProps) {
  const [saved, setSaved] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    getFavorite(entry.id)
      .then((favorite) => {
        if (active) setSaved(!!favorite);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setReady(true);
      });
    return () => { active = false; };
  }, [entry.id]);

  const onToggle = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      const next = await toggleFavorite(entry);
      setSaved(next);
      window.dispatchEvent(new CustomEvent('libretv:favorites-changed'));
    } catch {
      // IndexedDB unavailable: keep the current visual state rather than claiming a save.
    }
  };

  return (
    <button
      type="button"
      className={className || 'spatial-v4-favorite-button'}
      onClick={onToggle}
      aria-label={saved ? '取消收藏' : label}
      aria-pressed={saved}
      disabled={!ready}
      title={saved ? '取消收藏' : label}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8">
        <path strokeLinecap="round" strokeLinejoin="round" d="m12 3 2.75 5.57 6.15.9-4.45 4.33 1.05 6.12L12 17.03l-5.5 2.89 1.05-6.12L3.1 9.47l6.15-.9L12 3Z" />
      </svg>
      <span className="sr-only">{saved ? '已收藏' : label}</span>
    </button>
  );
}
