'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/icon';
import { SearchHistoryDropdown, useSearchHistory } from '@/components/search-history';
import { V4HomepageHeader } from '@/components/home/V4HomepageHeader';

export default function SearchPage() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [voiceState, setVoiceState] = useState<'IDLE'|'LISTENING'|'THINKING'|'SPEAKING'>('IDLE');
  const inputRef = useRef<HTMLInputElement>(null);
  const history = useSearchHistory(query);

  useEffect(() => {
    inputRef.current?.focus();
    const onTranscript = (event: Event) => {
      const transcript = (event as CustomEvent<{text?:string}>).detail?.text?.trim();
      if (transcript) setQuery(transcript.slice(0,100));
    };
    const onState = (event: Event) => {
      const state = (event as CustomEvent<{state?:string}>).detail?.state;
      if (state && ['IDLE','LISTENING','THINKING','SPEAKING'].includes(state)) setVoiceState(state as typeof voiceState);
    };
    window.addEventListener('friday-home-transcript', onTranscript);
    window.addEventListener('friday-home-voice-state', onState);
    return () => {
      window.removeEventListener('friday-home-transcript', onTranscript);
      window.removeEventListener('friday-home-voice-state', onState);
    };
  }, []);

  const submit = (value = query) => {
    const text = value.trim().slice(0,100);
    if (!text) { inputRef.current?.focus(); return; }
    history.record(text);
    history.close();
    router.push('/?s=' + encodeURIComponent(text));
  };
  const pick = (value: string) => { setQuery(value); submit(value); };

  return <div className="v4-search-page min-h-screen">
    <V4HomepageHeader />
    <main className="v4-search-main">
      <header className="v4-search-heading"><span>DISCOVER</span><h1>搜索</h1><p>搜索电影、电视剧、动漫与更多内容。</p></header>
      <div className="v4-search-box" ref={history.containerRef}>
        <form role="search" onSubmit={event => { event.preventDefault(); submit(); }}>
          <Icon name="search" />
          <input ref={inputRef} value={query} maxLength={100} placeholder={voiceState === 'LISTENING' ? '正在聆听，请说出片名…' : '输入片名、演员或关键词'} aria-label="搜索影视内容" onChange={event => { setQuery(event.target.value); history.resetActive(); }} onFocus={history.onFocus} onKeyDown={event => history.onKeyDown(event,pick)} />
          {query && <button type="button" aria-label="清空搜索" onClick={() => {setQuery('');inputRef.current?.focus();}}><Icon name="close"/></button>}
          <button type="submit" aria-label="提交搜索"><Icon name="search"/></button>
        </form>
        {history.visible && <SearchHistoryDropdown id="search-page-history" matches={history.matches} activeIndex={history.activeIndex} onPick={pick} onRemove={history.remove} onClearAll={history.clearAll}/>}
      </div>
      <div className="v4-search-actions">
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('friday-home-orb-toggle'))} aria-pressed={voiceState === 'LISTENING'}><Icon name="microphone"/><span>{voiceState === 'LISTENING' ? '停止语音搜索' : '语音搜索'}</span></button>
        <span>{voiceState === 'LISTENING' ? '正在聆听' : voiceState === 'THINKING' ? '正在识别' : '支持语音输入'}</span>
      </div>
      <section className="v4-search-history-section"><div><h2>最近搜索</h2><span>本机保存</span></div>
        {history.matches.length ? <div className="v4-search-history-list">{history.matches.map(item => <button key={item.text} type="button" onClick={() => pick(item.text)}><Icon name="clock"/><span>{item.text}</span><b>›</b></button>)}</div> : <p>还没有搜索记录。搜索过的内容会显示在这里。</p>}
      </section>
      <p className="v4-search-note">搜索结果将使用已启用的点播源进行跨源聚合，并保留各来源状态提示。</p>
    </main>
  </div>;
}
