'use client';

import { useEffect, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { SearchHistoryDropdown, useSearchHistory } from '@/components/search-history';
import { Icon } from '@/components/icon';
import { cn } from '@/lib/utils';

type SearchHistoryState = ReturnType<typeof useSearchHistory>;
type VoiceState = 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING';
type SpeechResultLike = { 0?: { transcript?: string }; isFinal?: boolean };
type SpeechEventLike = Event & { results: ArrayLike<SpeechResultLike> };
type SpeechRecognitionLike = {
  lang: string; continuous: boolean; interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechEventLike) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type HomeSearchSectionProps = {
  urlQuery: string;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  inputRef: RefObject<HTMLInputElement | null>;
  searchHistory: SearchHistoryState;
  runSearch: (query: string) => void;
  runSearchInPlace: (query: string) => void;
  pickHistory: (text: string) => void;
  voiceState: VoiceState;
  setVoiceState: Dispatch<SetStateAction<VoiceState>>;
  showBrandTitle?: boolean;
  showQuickSearches?: boolean;
};

/** 首页搜索框复用为语音识别文本显示器；识别结束后直接刷新本页搜索结果。 */
export function HomeSearchSection({
  urlQuery, input, setInput, inputRef, searchHistory, runSearch, runSearchInPlace,
  pickHistory, voiceState, setVoiceState, showBrandTitle = true, showQuickSearches = false,
}: HomeSearchSectionProps) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef('');
  const errorRef = useRef('');
  const manualStopRef = useRef(false);
  const [voiceError, setVoiceError] = useState('');

  const stopRecognition = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    manualStopRef.current = true;
    setVoiceState('IDLE');
    try { recognition.stop(); } catch { /* recognition may already be ending */ }
  };

  const startListening = () => {
    if (recognitionRef.current) return;
    setVoiceError('');
    finalTranscriptRef.current = '';
    errorRef.current = '';
    manualStopRef.current = false;

    if (typeof window === 'undefined' || !window.isSecureContext) {
      setVoiceError('语音识别需要 HTTPS 安全连接。');
      setVoiceState('IDLE');
      return;
    }
    const speechWindow = window as unknown as {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceError('当前浏览器不支持语音识别，请使用搜索框输入。');
      setVoiceState('IDLE');
      return;
    }

    let recognition: SpeechRecognitionLike;
    try { recognition = new Recognition(); }
    catch {
      setVoiceError('无法启动语音识别，请检查麦克风权限。');
      setVoiceState('IDLE');
      return;
    }

    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onstart = () => setVoiceError('');
    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result?.[0]?.transcript?.trim() ?? '';
        if (!transcript) continue;
        if (result.isFinal) finalText += transcript;
        else interimText += transcript;
      }
      const visible = (finalText || interimText).trim().slice(0, 100);
      if (visible) setInput(visible);
      if (finalText.trim()) finalTranscriptRef.current = finalText.trim().slice(0, 100);
    };
    recognition.onerror = (event) => {
      const code = (event as Event & { error?: string }).error || 'unknown';
      errorRef.current = code;
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        setVoiceError('麦克风权限被拒绝，请在 Safari 网站设置中允许麦克风。');
      } else if (code !== 'aborted' && code !== 'no-speech') {
        setVoiceError('语音识别暂时不可用，请检查网络后重试。');
      }
    };
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      const transcript = finalTranscriptRef.current.trim();
      if (manualStopRef.current) {
        manualStopRef.current = false;
        finalTranscriptRef.current = '';
        setVoiceState('IDLE');
        return;
      }
      if (errorRef.current && errorRef.current !== 'no-speech') {
        setVoiceState('IDLE');
        return;
      }
      if (!transcript) {
        setVoiceState('IDLE');
        return;
      }
      setInput(transcript);
      setVoiceState('THINKING');
      runSearchInPlace(transcript);
    };

    recognitionRef.current = recognition;
    setVoiceState('LISTENING');
    try {
      // 必须在圆球真实点击触发的同步事件链中调用 start，兼容 iOS Safari。
      recognition.start();
    } catch (error) {
      recognitionRef.current = null;
      setVoiceState('IDLE');
      const name = error instanceof Error ? error.name : '';
      setVoiceError(name === 'NotAllowedError' || name === 'SecurityError'
        ? '浏览器未授予麦克风权限，请允许网站访问麦克风。'
        : '语音识别启动失败，请再次点击圆球重试。');
    }
  };

  const toggleOrbVoice = () => {
    if (voiceState === 'LISTENING') {
      stopRecognition();
      return;
    }
    if (voiceState === 'SPEAKING') {
      window.speechSynthesis?.cancel();
      setVoiceState('LISTENING');
      startListening();
      return;
    }
    if (voiceState === 'THINKING') return;
    startListening();
  };

  useEffect(() => {
    const handleOrbToggle = () => toggleOrbVoice();
    window.addEventListener('friday-home-orb-toggle', handleOrbToggle);
    return () => window.removeEventListener('friday-home-orb-toggle', handleOrbToggle);
  });

  useEffect(() => () => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    try { recognition?.abort(); } catch { /* ignore unmount cleanup */ }
    window.speechSynthesis?.cancel();
  }, []);

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
