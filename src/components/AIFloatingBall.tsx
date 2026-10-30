'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

type Message = {
  id: string; role: 'user' | 'assistant';
  type: 'text' | 'movie_card' | 'system';
  content: string; data?: any; 
};

const INIT_MESSAGE: Message = { id: 'init', role: 'assistant', type: 'text', content: '你好！我是 Friday。想看什么电影，或者需要我帮你换几个新接口？' };
type SpeechState = 'idle' | 'listening' | 'thinking' | 'speaking';

// 高精度唯一 ID 生成，兼容旧浏览器
function simpleUid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export default function AIFloatingBall() {
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([INIT_MESSAGE]);
  const [loading, setLoading] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [speechState, setSpeechState] = useState<SpeechState>('idle');
  const [isSpeechSupported, setIsSpeechSupported] = useState(true); 
  
  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const isVoiceModeRef = useRef(false); 
  const speechStateRef = useRef<SpeechState>('idle'); 
  const micDeniedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const agentAbortControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false); 
  const agentCallDepthRef = useRef(0); 
  
  const messagesRef = useRef(messages); 
  const isOpenRef = useRef(isOpen); 
  const isAgentExecutingRef = useRef(false); 
  
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const reloadTimerRef = useRef<NodeJS.Timeout | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 统一状态更新，保证 messagesRef 强同步
  const updateMessages = useCallback((updater: Message[] | ((prev: Message[]) => Message[])) => {
    setMessages(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      messagesRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => { speechStateRef.current = speechState; }, [speechState]);
  useEffect(() => { isOpenRef.current = isOpen; }, [isOpen]);
  
  useEffect(() => {
    setMounted(true);
    mountedRef.current = true; 
    if (typeof window !== 'undefined') {
      synthRef.current = window.speechSynthesis;
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) setIsSpeechSupported(false);
    }
    return () => {
      mountedRef.current = false; 
      document.body.classList.remove('friday-popup-lock');
      synthRef.current?.cancel();
      try { recognitionRef.current?.abort(); } catch (e) {}
      if (abortControllerRef.current) abortControllerRef.current.abort();
      if (agentAbortControllerRef.current) agentAbortControllerRef.current.abort();
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      agentCallDepthRef.current = 0; 
    };
  }, []);

  // 页面切后台停止麦克风
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        try { recognitionRef.current?.abort(); } catch (e) {}
      } else if (document.visibilityState === 'visible' && isVoiceModeRef.current && !micDeniedRef.current) { 
        try { recognitionRef.current?.start(); } catch (e) {}
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // 语音识别初始化
  useEffect(() => {
    if (typeof window === 'undefined' || !isSpeechSupported) return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.lang = 'zh-CN';
      recognition.continuous = false;
      recognition.interimResults = true;
      
      recognition.onstart = () => { if (isVoiceModeRef.current) setSpeechState('listening'); };
      recognition.onresult = (event: any) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
          else setInput(event.results[i][0].transcript);
        }
        if (finalTranscript) {
          try { recognition.stop(); } catch(e) {}
          handleSend(finalTranscript); 
        }
      };
      recognition.onerror = (e: any) => {
        if (e.error === 'not-allowed') { setIsVoiceMode(false); isVoiceModeRef.current = false; micDeniedRef.current = true; }
        setSpeechState('idle');
      };
      recognition.onend = () => {
        if (micDeniedRef.current || document.visibilityState === 'hidden') return;
        if (isVoiceModeRef.current && speechStateRef.current === 'listening') {
          setTimeout(() => { try { recognition.start(); } catch (e) { setSpeechState('idle'); } }, 300);
        }
      };
      recognitionRef.current = recognition;
    }
  }, [isSpeechSupported]);

  const speakText = useCallback((text: string) => {
    if (!synthRef.current) return;
    synthRef.current.cancel(); 
    const utterance = new SpeechSynthesisUtterance(text.replace(/\*\*|\*|#|>/g, ''));
    utterance.lang = 'zh-CN';
    utterance.onstart = () => setSpeechState('speaking');
    utterance.onend = () => {
      if (isVoiceModeRef.current) {
        setSpeechState('listening');
        try { recognitionRef.current?.start(); } catch (e) {}
      } else setSpeechState('idle');
    };
    synthRef.current.speak(utterance);
  }, []);

  const toggleVoiceMode = () => {
    if (!isSpeechSupported) return;
    if (isVoiceMode) {
      isVoiceModeRef.current = false; setIsVoiceMode(false); setSpeechState('idle');
      synthRef.current?.cancel(); try { recognitionRef.current?.stop(); } catch (e) {}
    } else {
      micDeniedRef.current = false; isVoiceModeRef.current = true; setIsVoiceMode(true); setSpeechState('listening');
      try { recognitionRef.current?.start(); } catch (e) {}
    }
  };

  const togglePanel = useCallback((reset = false) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      if (isOpenRef.current) {
        setIsOpen(false); toggleVoiceMode(); synthRef.current?.cancel();
        if (abortControllerRef.current) abortControllerRef.current.abort();
        if (agentAbortControllerRef.current) agentAbortControllerRef.current.abort();
        setLoading(false); document.body.classList.remove('friday-popup-lock');
        closeTimerRef.current = setTimeout(() => { setIsMounted(false); }, 300);
      } else {
        setIsMounted(true);
        setTimeout(() => {
          setIsOpen(true); document.body.classList.add('friday-popup-lock');
          if (reset) { updateMessages([INIT_MESSAGE]); setInput(''); }
          setTimeout(() => { inputRef.current?.focus(); forceScrollToBottom(); }, 100);
        }, 10);
      }
    }, 150); 
  }, [isVoiceMode, updateMessages]); 

  useEffect(() => {
    const handleOpen = (e: Event) => togglePanel((e as CustomEvent).detail?.reset || false);
    window.addEventListener('toggle-friday-panel', handleOpen);
    return () => window.removeEventListener('toggle-friday-panel', handleOpen);
  }, [togglePanel]);

  // Tab 焦点陷阱
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { togglePanel(false); return; }
      if (e.key === 'Tab' && popupRef.current) {
        const focusable = popupRef.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        const visible = Array.from(focusable).filter(el => (el as HTMLElement).offsetParent !== null) as HTMLElement[];
        if (visible.length === 0) return;
        const first = visible[0]; const last = visible[visible.length - 1];
        if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } } 
        else { if (document.activeElement === last) { e.preventDefault(); first.focus(); } }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, togglePanel]);

  const forceScrollToBottom = () => {
    setIsAtBottom(true);
    if (chatContainerRef.current) chatContainerRef.current.scrollTo({ top: chatContainerRef.current.scrollHeight, behavior: 'smooth' });
  };

  useEffect(() => {
    if (isAtBottom && chatContainerRef.current) chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
  }, [messages, isAtBottom, loading]);

  const formatText = (text: string) => {
    if (!text) return { __html: '' };
    const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br />');
    return { __html: safe };
  };

  // 核心流解析
  const processStreamResponse = async (response: Response) => {
    if (!response.body) throw new Error('empty body');
    const reader = response.body.getReader();
    
    let fullContent = '';
    let toolName = ''; 
    let toolArgsBuffer = '';
    
    const streamMsgId = crypto.randomUUID ? crypto.randomUUID() : simpleUid();
    let hasStreamedText = false;

    // 修复：提取 decoder，并在 done 时冲刷
    const decoder = new TextDecoder('utf-8');

    while (true) {
      const { done, value } = await reader.read();
      
      const chunk = decoder.decode(value, { stream: !done });
      if (done) {
        decoder.decode(); 
        break;
      }

      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ') && line.trim() !== 'data: [DONE]') {
          try {
            const data = JSON.parse(line.slice(6));
            const delta = data.choices?.[0]?.delta;
            
            if (delta?.content) {
              fullContent += delta.content;
              if (!hasStreamedText) {
                hasStreamedText = true;
                updateMessages(prev => [...prev, { id: streamMsgId, role: 'assistant', type: 'text', content: fullContent }]);
              } else {
                updateMessages(prev => {
                  const updated = [...prev];
                  const msgIndex = updated.findIndex(m => m.id === streamMsgId);
                  if (msgIndex > -1) updated[msgIndex].content = fullContent;
                  return updated;
                });
              }
            }
            
            if (delta?.tool_calls && delta.tool_calls.length > 0) {
              if (delta.tool_calls[0].function?.name) {
                toolName = '';
                toolArgsBuffer = '';
              }
              const tc = delta.tool_calls[0];
              if (tc.function?.name) toolName = tc.function.name;
              if (tc.function?.arguments) {
                if (toolArgsBuffer.length < 10000) toolArgsBuffer += tc.function.arguments;
              }
            }
          } catch (e) { console.warn('SSE parse error:', e); }
        }
      }
    }

    if (!mountedRef.current) return; 

    if (toolName && toolArgsBuffer) {
      try {
        const args = JSON.parse(toolArgsBuffer);

        if (toolName === 'search_movie' && args.keyword) {
          const realPoster = `https://picsum.photos/seed/${encodeURIComponent(args.keyword)}/300/450`; 
          updateMessages(prev => [...prev, { 
            id: crypto.randomUUID ? crypto.randomUUID() : simpleUid(), role: 'assistant', type: 'movie_card', content: '',
            data: { title: args.keyword, poster: realPoster, link: `/search?q=${encodeURIComponent(args.keyword)}` }
          }]);
          speakText(fullContent || `已经为您搜索到关于${args.keyword}的影片。`);
          window.dispatchEvent(new CustomEvent('friday-action-search', { detail: args.keyword }));
        } 
        
        else if (toolName === 'fetch_and_add_source') {
          executeAgentFetchSources();
        }

        else if (toolName === 'add_video_source' && args.name && args.api_url) {
          updateMessages(prev => [...prev, { id: crypto.randomUUID ? crypto.randomUUID() : simpleUid(), role: 'assistant', type: 'system', content: `✅ 已写入新接口：\n名称：${args.name}\n地址：${args.api_url}` }]);
          try {
            let existing = [];
            const localData = localStorage.getItem('custom_api_url');
            if (localData) {
              try { 
                const parsed = JSON.parse(localData);
                existing = Array.isArray(parsed) ? parsed : [{ name: '默认', url: parsed }];
              } catch { existing = [{ name: '默认', url: localData }]; }
            }
            existing.push({ name: args.name, url: args.api_url });
            localStorage.setItem('custom_api_url', JSON.stringify(existing));
          } catch(e) { console.error('写入源失败', e); }

          speakText(fullContent || `已经帮您把${args.name}的接口加好了，马上为您刷新。`);
          reloadTimerRef.current = setTimeout(() => window.location.reload(), 2500);
        }
        
        else if (toolName === 'update_api_config' && args.api_url) {
          updateMessages(prev => [...prev, { id: crypto.randomUUID ? crypto.randomUUID() : simpleUid(), role: 'assistant', type: 'system', content: `✅ 已更新 API 地址：${args.api_url}` }]);
          let existing = [];
          const localData = localStorage.getItem('custom_api_url');
          if (localData) {
            try { 
              const parsed = JSON.parse(localData);
              existing = Array.isArray(parsed) ? parsed : [{ name: '默认', url: parsed }];
            } catch { existing = [{ name: '默认', url: localData }]; }
          }
          if (existing.length > 0) existing[0].url = args.api_url;
          else existing.push({ name: '默认', url: args.api_url });
          localStorage.setItem('custom_api_url', JSON.stringify(existing));

          speakText(fullContent || '设置已更新，即将刷新页面。');
          reloadTimerRef.current = setTimeout(() => window.location.reload(), 2000);
        }
      } catch (err) {
         console.error("工具调用参数解析失败", err, toolArgsBuffer);
         updateMessages(prev => [...prev, {id: crypto.randomUUID ? crypto.randomUUID() : simpleUid(), role:'assistant', type:'text', content:'⚠️ 工具调用解析出错，请重试'}]);
      }
    } 
    else if (fullContent) {
      speakText(fullContent);
    }
  };

  const executeAgentFetchSources = async () => {
    if (isAgentExecutingRef.current || !mountedRef.current || agentCallDepthRef.current >= 2) return;
    agentCallDepthRef.current += 1;
    
    if (isVoiceModeRef.current) setSpeechState('thinking');
    
    isAgentExecutingRef.current = true;
    setLoading(true);
    updateMessages(prev => [...prev, { id: crypto.randomUUID ? crypto.randomUUID() : simpleUid(), role: 'assistant', type: 'text', content: `正在全网抓取接口并自动筛选，请稍候...` }]);
    forceScrollToBottom();

    agentAbortControllerRef.current = new AbortController();
    
    const latestHistory = messagesRef.current.map(m => ({ role: m.role, content: m.content }));

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'fetch_sources', messages: latestHistory }),
        signal: agentAbortControllerRef.current.signal
      });

      if (!response.ok) {
         const errorData = await response.json().catch(() => ({}));
         throw new Error(errorData.error || 'Agent 抓取失败');
      }

      await processStreamResponse(response);
      
    } catch (error: any) {
       if (error.name !== 'AbortError' && mountedRef.current) {
         updateMessages(prev => [...prev, { id: crypto.randomUUID ? crypto.randomUUID() : simpleUid(), role: 'assistant', type: 'text', content: `⚠️ 抓取源失败：${error.message}` }]);
       }
    } finally {
       if (mountedRef.current) {
         isAgentExecutingRef.current = false;
         agentAbortControllerRef.current = null;
         setLoading(false);
         agentCallDepthRef.current = 0;
         if (isVoiceModeRef.current) setSpeechState('listening');
       }
    }
  };

  const handleSend = async (overrideText?: string) => {
    const text = overrideText || input.trim();
    if (!text || loading) return;

    synthRef.current?.cancel(); setInput('');
    const userMsg: Message = { id: crypto.randomUUID ? crypto.randomUUID() : simpleUid(), role: 'user', type: 'text', content: text };
    updateMessages(prev => [...prev, userMsg]); 
    
    setLoading(true); setIsAtBottom(true);
    if (isVoiceModeRef.current) setSpeechState('thinking');
    forceScrollToBottom();

    const history = messagesRef.current.map(m => ({ role: m.role, content: m.content }));
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
         const errorData = await response.json().catch(() => ({}));
         throw new Error(errorData.error || `HTTP Error ${response.status}`);
      }

      await processStreamResponse(response);

    } catch (error: any) {
      if (error.name !== 'AbortError' && mountedRef.current) {
        updateMessages(prev => [...prev, { id: crypto.randomUUID ? crypto.randomUUID() : simpleUid(), role: 'assistant', type: 'text', content: `⚠️ 网络错误：${error.message}` }]);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false); abortControllerRef.current = null;
      }
    }
  };

  if (!mounted || !isMounted) return null;

  return createPortal(
    <div className={`fixed inset-0 z-[1400] flex items-start justify-center pt-[max(60px,env(safe-area-inset-top,0px)+10px)] pointer-events-none transition-all duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'}`}>
      <div className="absolute inset-0 bg-black/40 pointer-events-auto backdrop-blur-sm" onClick={() => togglePanel(false)}></div>
      
      <div 
        ref={popupRef}
        className={`relative w-[90%] max-w-[400px] bg-[#020202] rounded-[40px] overflow-hidden flex flex-col pointer-events-auto shadow-[0_20px_50px_rgba(0,0,0,0.8),inset_0_1px_1px_rgba(255,255,255,0.15)] transition-all duration-500 ease-[cubic-bezier(0.25,1.2,0.5,1)] ${isOpen ? 'scale-100 translate-y-0' : 'scale-90 -translate-y-8'}`} 
        style={{ maxHeight: '75vh', height: '75dvh' }}
      >
        <div className="absolute bottom-0 left-0 w-full h-[60px] pointer-events-none z-0 opacity-80 mix-blend-screen overflow-hidden">
           <div className="absolute bottom-[-20px] left-[10%] w-[80%] h-[60px] bg-[radial-gradient(ellipse_at_bottom,rgba(255,220,0,0.8)_0%,transparent_70%)] blur-[12px]"></div>
           <div className="absolute bottom-[-10px] left-[20%] w-[60%] h-[50px] bg-[radial-gradient(ellipse_at_bottom,rgba(0,255,200,0.5)_0%,transparent_60%)] blur-[15px]"></div>
           <div className="absolute bottom-[10px] left-[30%] w-[40%] h-[30px] bg-[radial-gradient(ellipse_at_center,rgba(255,50,50,0.6)_0%,transparent_70%)] blur-[10px]"></div>
        </div>

        <div className="relative z-10 flex flex-col min-h-0">
          <div className="flex justify-between items-center px-6 py-4 z-50 shrink-0">
             <span className="text-sm text-gray-300 font-semibold flex items-center gap-2">✨ Friday</span>
             <button className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-sm hover:bg-white/20" onClick={() => togglePanel(false)}>✕</button>
          </div>
          
          <div className={`overflow-y-auto px-6 pb-4 flex flex-col gap-4 relative transition-all duration-500 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] ${isVoiceMode ? 'opacity-20 blur-sm pointer-events-none' : ''}`} ref={chatContainerRef}>
            {messages.map((msg) => (
              <div key={msg.id} className={`flex flex-col w-full ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                {msg.type === 'text' && (
                  <div className={`text-[15px] leading-relaxed break-words max-w-[90%] ${msg.role === 'user' ? 'bg-blue-500/20 text-blue-100 border border-blue-500/30 p-3 rounded-2xl rounded-br-sm' : 'text-gray-100 p-1'}`}>
                    <div dangerouslySetInnerHTML={formatText(msg.content)} />
                  </div>
                )}
                {msg.type === 'movie_card' && (
                  <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl overflow-hidden w-[240px] shadow-lg mt-2">
                    <div className="h-[130px] bg-cover bg-center" style={{ backgroundImage: `url(${msg.data.poster})` }} />
                    <div className="p-3 flex flex-col gap-1">
                      <span className="text-white font-bold text-sm truncate">{msg.data.title}</span>
                      <button onClick={() => { synthRef.current?.cancel(); window.location.href = msg.data.link; togglePanel(false); }} className="mt-2 w-full bg-blue-600 hover:bg-blue-500 text-white text-xs py-1.5 rounded-lg">立即播放</button>
                    </div>
                  </div>
                )}
                {msg.type === 'system' && (
                  <div className="text-[13px] text-green-400 bg-green-500/10 border border-green-500/30 p-3 rounded-xl mt-2 whitespace-pre-wrap">{msg.content}</div>
                )}
              </div>
            ))}
            {loading && !isVoiceMode && (
              <div className="self-start flex gap-1 items-center p-1">
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></span>
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-100"></span>
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-200"></span>
              </div>
            )}
          </div>

          {isVoiceMode && (
            <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/60 backdrop-blur-md rounded-[40px]">
               <div className="w-24 h-24 rounded-full flex items-center justify-center transition-all duration-500 bg-black/50 shadow-[0_0_40px_rgba(255,255,255,0.1)] border border-white/10">
                  <span className="text-3xl">{speechState === 'listening' ? '🎙️' : speechState === 'thinking' ? '🧠' : '🗣️'}</span>
               </div>
               <div className="text-gray-400 text-sm mt-4 animate-pulse">
                  {speechState === 'listening' ? '我在听...' : speechState === 'thinking' ? '让我想想...' : '正在回答...'}
               </div>
               <button onClick={toggleVoiceMode} className="absolute bottom-6 px-6 py-2 bg-red-500/80 text-white text-sm rounded-full">结束通话</button>
            </div>
          )}

          <div className={`flex items-center px-4 pb-4 pt-2 gap-2 shrink-0 relative z-20 ${isVoiceMode ? 'opacity-0 pointer-events-none' : ''}`}>
            {isSpeechSupported && (
              <button onClick={toggleVoiceMode} className="w-10 h-10 rounded-full flex items-center justify-center text-gray-400 hover:text-white bg-white/5">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
              </button>
            )}
            <input ref={inputRef} type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSend()} placeholder={loading ? "Friday 正在处理中..." : "输入消息或搜索电影..."} disabled={loading} className="flex-1 bg-transparent border border-white/10 rounded-full px-4 py-2 text-sm text-white outline-none focus:border-white/30" />
            <button onClick={() => handleSend()} disabled={!input.trim() || loading} className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center disabled:bg-gray-700 disabled:text-gray-500">
              {loading ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span> : <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
