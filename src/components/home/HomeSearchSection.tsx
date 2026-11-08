'use client';

import type { Dispatch, RefObject, SetStateAction } from 'react';
import { SearchHistoryDropdown, useSearchHistory } from '@/components/search-history';
import { Icon } from '@/components/icon';
import { cn } from '@/lib/utils';

type SearchHistoryState = ReturnType<typeof useSearchHistory>;
type HomeSearchSectionProps = {
  urlQuery: string;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  inputRef: RefObject<HTMLInputElement | null>;
  searchHistory: SearchHistoryState;
  runSearch: (query: string) => void;
  runSearchInPlace: (query: string) => boolean;
  pickHistory: (text: string) => void;
  showBrandTitle?: boolean;
  compactHeader?: boolean;
};

/** 首页只负责展示与发出语音意图；ASR 生命周期统一由 Friday voice controller 管理。 */
export function HomeSearchSection({
  urlQuery, input, setInput, inputRef, searchHistory, runSearch,
  pickHistory, showBrandTitle = true, compactHeader = false,
}: HomeSearchSectionProps) {
  return (
    <section className={cn('flex flex-col items-center', compactHeader ? 'home-v2-header-search' : urlQuery ? 'mb-6' : 'mt-8 mb-8')}>
      {!urlQuery && showBrandTitle && <header className="text-center mb-6"><h1 className="text-4xl sm:text-5xl font-bold brand-gradient">LibreTV</h1></header>}
      {urlQuery && <h1 className="sr-only">LibreTV 视频搜索</h1>}
      <div ref={searchHistory.containerRef} className="relative w-full max-w-2xl">
        <form className="w-full" onSubmit={(event) => { event.preventDefault(); runSearch(input); }}>
          <div className={cn('home-v2-ai-search flex items-center min-h-14 border', searchHistory.visible ? 'rounded-t-2xl rounded-b-none border-accent border-b-line bg-surface-raised' : 'rounded-2xl border-line bg-chip', )}>
            <span className="home-v2-search-leading" aria-hidden="true"><Icon name="search" className="w-5 h-5" /></span>
            <input
              ref={inputRef}
              className="home-v2-ai-search-input"
              placeholder="输入片名，搜索影视资源…"
              value={input}
              maxLength={100}
              onChange={(event) => { setInput(event.target.value); searchHistory.resetActive(); }}
              onFocus={searchHistory.onFocus}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.preventDefault();
                searchHistory.onKeyDown(event, pickHistory);
              }}
              role="combobox" aria-label="AI 搜索影片" aria-expanded={searchHistory.visible}
              aria-controls="home-search-history" aria-autocomplete="list"
              aria-activedescendant={searchHistory.visible && searchHistory.activeIndex >= 0 ? `home-search-history-${searchHistory.activeIndex}` : undefined}
            />
            {input && <button type="button" className="home-v2-search-clear" onClick={() => { setInput(''); searchHistory.resetActive(); inputRef.current?.focus(); }} aria-label="清空输入"><Icon name="close" className="w-4 h-4" /></button>}
            <button type="submit" className="home-v2-search-submit" aria-label="搜索"><Icon name="search" className="w-5 h-5" /></button>
          </div>
        </form>
        {searchHistory.visible && <SearchHistoryDropdown id="home-search-history" matches={searchHistory.matches} activeIndex={searchHistory.activeIndex} onPick={pickHistory} onRemove={searchHistory.remove} onClearAll={searchHistory.clearAll} />}
      </div>
    </section>
  );
}
