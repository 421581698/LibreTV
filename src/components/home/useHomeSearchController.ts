'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSearchHistory } from '@/components/search-history';
import type { ToastType } from '@/components/toast';

type HomeSearchToast = (message: string, type?: ToastType) => void;

/** 首页搜索控制器；语音搜索可直接更新本页结果，不触发路由跳转。 */
export function useHomeSearchController(routeQuery: string, selectedSourceCount: number, toast: HomeSearchToast) {
  const router = useRouter();
  const [input, setInput] = useState(routeQuery);
  const [localQuery, setLocalQuery] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchHistory = useSearchHistory(input);
  const activeQuery = localQuery ?? routeQuery;

  useEffect(() => {
    setLocalQuery(null);
    setInput(routeQuery);
  }, [routeQuery]);

  const validateQuery = (queryText: string) => {
    const query = queryText.trim().slice(0, 100);
    if (!query) {
      toast('请输入搜索内容', 'info');
      inputRef.current?.focus();
      return '';
    }
    if (selectedSourceCount === 0) {
      toast('请先在设置中添加并勾选点播源', 'warning');
      return '';
    }
    return query;
  };

  const runSearch = (queryText: string) => {
    const query = validateQuery(queryText);
    if (!query) return;
    setLocalQuery(null);
    router.push(`/?q=${encodeURIComponent(query)}`, { scroll: false });
    searchHistory.record(query);
  };

  const runSearchInPlace = (queryText: string): boolean => {
    const query = validateQuery(queryText);
    if (!query) return false;
    setInput(query);
    setLocalQuery(query);
    searchHistory.record(query);
    return true;
  };

  const pickHistory = (text: string) => {
    setInput(text);
    searchHistory.close();
    runSearch(text);
  };

  return { input, setInput, inputRef, searchHistory, runSearch, runSearchInPlace, pickHistory, activeQuery };
}
