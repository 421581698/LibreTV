'use client';

import { useRouter } from 'next/navigation';
import { Icon } from '@/components/icon';
import { LiquidGlassSurface } from '@/components/ui/liquid-glass';
import styles from './Search.module.css';

export function SearchModule() {
  const router = useRouter();

  return (
    <LiquidGlassSurface
      as="button"
      type="button"
      variant="control"
      interactive
      className={'v4-search ' + styles.root}
      aria-label="搜索"
      title="搜索"
      onClick={() => router.push('/search')}
    >
      <Icon name="search" />
    </LiquidGlassSurface>
  );
}
