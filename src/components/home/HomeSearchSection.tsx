'use client';

import { useEffect, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { SearchHistoryDropdown, useSearchHistory } from '@/components/search-history';
import { Icon } from '@/components/icon';
import { cn } from '@/lib/utils';

type SearchHistoryState = ReturnType<typeof useSearchHistory>;
type VoiceState = 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING';
type HomeSearchSectionProps = {
  urlQuery: string;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  inputRef: RefObject<HTMLInputElement | null>;
  searchHistory: SearchHistoryState;
  runSearch: (query: string) => void;
  runSearchInPlace: (query: string) => boolean;
  pickHistory: (text: string) => void;
  voiceState: VoiceState;
  setVoiceState: Dispatch<SetStateAction<VoiceState>>;
  showBrandTitle?: boolean;
  showQuickSearches?: boolean;
};

/** 首页只负责展示与发出语音意图；ASR 生命周期统一由 Friday voice controller 管理。 */
export function HomeSearchSection({
  urlQuery, input, setInput, inputRef, searchHistory, runSearch,
  pickHistory, voiceState, setVoiceState, showBrandTitle = true, showQuickSearches = false,
}: HomeSearchSectionProps) {
  const [voiceError, setVoiceError] = useState('');

  useEffect(() => {
    const handleVoiceState = (event: Event) => {
      const next = (event as CustomEvent<{ state?: VoiceState }>).detail?.state;
      if (next && ['IDLE', 'LISTENING', 'THINKING', 'SPEAKING'].includes(next)) {
        setVoiceState(next);
      }
    };
    const handleVoiceError = (event: Event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message;
      setVoiceError(typeof message === 'string' ? message : '');
    };
    const handleTranscript = (event: Event) => {
      const text = (event as CustomEvent<{ text?: string }>).detail?.text?.trim();
      if (text) setInput(text.slice(0, 100));
    };
    window.addEventListener('friday-home-voice-state', handleVoiceState);
    window.addEventListener('friday-home-voice-error', handleVoiceError);
    window.addEventListener('friday-home-transcript', handleTranscript);
    return () => {
      window.removeEventListener('friday-home-voice-state', handleVoiceState);
      window.removeEventListener('friday-home-voice-error', handleVoiceError);
      window.removeEventListener('friday-home-transcript', handleTranscript);
    };
  }, [setInput, setVoiceState]);

  const toggleOrbVoice = () => {
    // The central Friday controller owns the only SpeechRecognition instance.
    window.dispatchEvent(new CustomEvent('friday-home-orb-toggle'));
  };

  const placeholder = voiceState === 'LISTENING'
    ? '正在聆听，请说…'
    : voiceState === 'THINKING'
      ? '正在为你寻找…'
      : '说出你想看的内容，或输入片名…';

  return (
    <section className={cn('flex flex-col items-center', urlQuery ? 'mb-6' : showQuickSearches ? 'mt-2 mb-4' : 'mt-8 mb-8')}>
      {!urlQuery && showBrandTitle && <header className="text-center mb-6"><h1 className="text-4xl sm:text-5xl font-bold brand-gradient">LibreTV</h1></header>}
      {urlQuery && <h1 className="sr-only">LibreTV 视频搜索</h1>}
      <div ref={searchHistory.containerRef} className="relative w-full max-w-2xl">
        <form className="w-full" onSubmit={(event) => { event.preventDefault(); runSearch(input); }}>
          <div className={cn('home-v2-ai-search flex items-center min-h-14 border', searchHistory.visible ? 'rounded-t-2xl rounded-b-none border-accent border-b-line bg-surface-raised' : 'rounded-2xl border-line bg-chip', voiceState === 'LISTENING' && 'is-listening')}>
            <span className="home-v2-search-leading" aria-hidden="true"><Icon name="search" className="w-5 h-5" /></span>
            <input
              ref={inputRef}
              className="home-v2-ai-search-input"
              placeholder={placeholder}
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
        {voiceError && <p className="home-v2-voice-error" role="status" aria-live="polite">{voiceError}</p>}
        {voiceState === 'LISTENING' && <p className="home-v2-voice-status" role="status" aria-live="polite"><span className="home-v2-voice-pulse" />正在聆听，说完后会自动搜索</p>}
        {showQuickSearches && !urlQuery && <div className="home-v2-quick-searches" aria-label="热门搜索">{['蜘蛛侠', '科幻', '悬疑', '动漫'].map((term) => <button key={term} type="button" className="home-v2-quick-search" onClick={() => runSearch(term)}>{term}</button>)}</div>}
        {searchHistory.visible && <SearchHistoryDropdown id="home-search-history" matches={searchHistory.matches} activeIndex={searchHistory.activeIndex} onPick={pickHistory} onRemove={searchHistory.remove} onClearAll={searchHistory.clearAll} />}
      </div>
    </section>
  );
}
