'use client';

import { useRouter } from 'next/navigation';
import { Icon } from '@/components/icon';
import styles from './Search.module.css';

export function SearchModule() {
  const router = useRouter();

  return (
    <button
      type="button"
      className={'v4-search ' + styles.root}
      aria-label="搜索"
      title="搜索"
      onClick={() => router.push('/search')}
    >
      <Icon name="search" />
    </button>
  );
}
