'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

import { useFridayDetailBridge } from '@/components/friday/useFridayDetailBridge';
import { useToast } from '@/components/toast';
import type { SearchResultItem } from '@/lib/types';

export type OpenDetail = (
  item: SearchResultItem,
  extra?: { rating?: string; poster?: string }
) => void;

/**
 * 搜索结果 → 详情页的导航。
 *
 * 保留原有两条入口，跳转参数与原实现逐字一致（详情页与播放器无需改动）：
 *   1. 卡片点击 / 首页豆瓣卡片 → openDetail
 *   2. Friday 语音桥 → useFridayDetailBridge → openDetail
 *
 * ⚠️ 该 hook 内含 Friday 事件监听，同一页面只能挂载一次。
 * 因此调用方应为页面容器，搜索结果视图通过 props 接收 openDetail，
 * 不要在下层组件重复调用，否则同一次 Friday 事件会触发两次跳转。
 */
export function useSearchDetailNav() {
  const router = useRouter();
  const { toast } = useToast();
  const [detailItem, setDetailItem] = useState<SearchResultItem | null>(null);

  const openDetail = useCallback<OpenDetail>(
    (item, extra) => {
      const params = new URLSearchParams({
        source: item.sourceKey,
        id: item.vodId,
        title: item.name,
        sourceName: item.sourceName,
      });
      if (item.pic || extra?.poster) params.set('pic', item.pic || extra?.poster || '');
      if (extra?.rating) params.set('rating', extra.rating);
      if (item.sourceUrl) params.set('sourceUrl', item.sourceUrl);
      router.push('/detail?' + params.toString());
    },
    [router]
  );

  useFridayDetailBridge(setDetailItem, toast);

  // 同一影片只跳转一次，避免 Friday 重复推送导致连续压栈
  const openedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!detailItem) {
      openedRef.current = null;
      return;
    }
    const key = detailItem.sourceKey + ':' + detailItem.vodId;
    if (openedRef.current === key) return;
    openedRef.current = key;
    openDetail(detailItem);
    setDetailItem(null);
  }, [detailItem, openDetail]);

  return { openDetail, toast };
}
