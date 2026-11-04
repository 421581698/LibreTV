'use client';

import type { Dispatch, RefObject, SetStateAction } from 'react';
import { FridayHero } from '@/components/friday/FridayHero';
import { HomeSearchSection } from '@/components/home/HomeSearchSection';
import { useSearchHistory } from '@/components/search-history';

type SearchHistoryState = ReturnType<typeof useSearchHistory>;

type CinemaLobbyHeroProps = {
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  inputRef: RefObject<HTMLInputElement | null>;
  searchHistory: SearchHistoryState;
  runSearch: (query: string) => void;
  pickHistory: (text: string) => void;
  onSearchFocus: () => void;
};

/**
 * Cinema Lobby 的首页意图画布。
 * 只组合 Friday 主视觉与现有搜索入口，不拥有搜索状态或数据请求。
 */
export function CinemaLobbyHero({
  input,
  setInput,
  inputRef,
  searchHistory,
  runSearch,
  pickHistory,
  onSearchFocus,
}: CinemaLobbyHeroProps) {
  return (
    <div className="cinema-lobby-hero">
      <FridayHero onSearchFocus={onSearchFocus} />
      <HomeSearchSection
        urlQuery=""
        input={input}
        setInput={setInput}
        inputRef={inputRef}
        searchHistory={searchHistory}
        runSearch={runSearch}
        pickHistory={pickHistory}
        showBrandTitle={false}
        showQuickSearches
      />
    </div>
  );
}
