'use client';
import React, { useState, useRef, useEffect, useCallback } from 'react';

export const triggerAIChat = (initialText?: string) => {
  const safeText = initialText ?? '';
  const event = new CustomEvent('openAIChat', { detail: safeText });
  window.dispatchEvent(event);
};

// 唯一ID生成器
const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export default function AIFloatingBall() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<{ id: string; role: string; content: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [orbLock, setOrbLock] = useState(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingRef = useRef(false);

  // 同步 loading 状态
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  // 自动滚动（带定时器清理）
  useEffect(() => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    if (scrollRef.current) {
      scrollTimerRef.current = setTimeout(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      }, 50);
    }
    return () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, [messages, isOpen, loading]);

  // iOS键盘适配
  useEffect(() => {
    if (typeof window !== 'undefined' && window.visualViewport) {
      const handleResize = () => {
        const vh = window.visualViewport?.height || window.innerHeight;
        document.documentElement.style.setProperty('--app-height', `${vh}px`);
      };
      window.visualViewport.addEventListener('resize', handleResize);
      handleResize();
      return () => window.visualViewport?.removeEventListener('resize', handleResize);
    }
  }, []);

  // 卸载时取消请求
  useEffect(() => {
    return () => { fetchAbortRef.current?.abort(); };
  }, []);

  // 打开面板自动聚焦
  useEffect(() => {
    if (isOpen && inputRef.current) inputRef.current.focus();
  }, [isOpen]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleSend = useCallback(async (text: string) => {
    if (!text.trim() || loadingRef.current) return;

    const userMsg = { id: generateId(), role: 'user', content: text };
    
    setMessages(prev => {
      const newMessages = [...prev, userMsg];
      const messagesToSend = newMessages.slice(-10).map(({ id, ...rest }) => rest);

      (async () => {
        setLoading(true);
        fetchAbortRef.current?.abort();
        const abortCtrl = new AbortController();
        fetchAbortRef.current = abortCtrl;

        try {
          const res = await fetch('/api/ai-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: messagesToSend }),
            signal: abortCtrl.signal
          });
          
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || '网络请求失败');
          
          if (data.reply) {
            setMessages(p => [...p, { id: generateId(), role: 'assistant', content: data.reply }]);
          } else {
            setMessages(p => [...p, { id: generateId(), role: 'assistant', content: 'AI 大脑短路了。' }]);
          }
        } catch (error: unknown) {
          if (error instanceof Error && error.name === 'AbortError') return;
          const errMsg = error instanceof Error ? error.message : '网络异常，请稍后再试。';
          setMessages(p => [...p, { id: generateId(), role: 'assistant', content: errMsg }]);
        } finally {
          setLoading(false);
        }
      })();
      
      return newMessages;
    });
    setInput('');
  }, []);

  // 全局唤起监听
  useEffect(() => {
    const handleOpen = (e: Event) => {
      if (loadingRef.current) return;
      setIsOpen(true);
      const customEvent = e as CustomEvent<string>;
      if (customEvent.detail) {
        setInput(customEvent.detail);
        void handleSend(customEvent.detail);
      }
    };
    window.addEventListener('openAIChat', handleOpen);
    return () => window.removeEventListener('openAIChat', handleOpen);
  }, [handleSend]);

  const closePanel = () => {
    fetchAbortRef.current?.abort();
    setIsOpen(false);
    setInput('');
  };

  const togglePanel = () => {
    if (orbLock) return;
    setOrbLock(true);
    setIsOpen(prev => !prev);
    setTimeout(() => setOrbLock(false), 300);
  };

  return (
    <React.Fragment>
      {isOpen && (
        <React.Fragment>
          <div className="ai-chat-overlay" onClick={closePanel}></div>
          <div className="ai-chat-panel" onClick={(e) => e.stopPropagation()}>
            <div className="ai-chat-header">
              <span>AI 电影管家</span>
              <button onClick={closePanel}>✕</button>
            </div>
            <div className="ai-chat-messages" ref={scrollRef}>
              {messages.length === 0 && (
                <div className="ai-msg-assistant">你好！我是你的全能 AI。你可以让我推荐电影，或者直接问我想看什么。</div>
              )}
              {messages.map((msg) => (
                <div key={msg.id} className={msg.role === 'user' ? 'ai-msg-user' : 'ai-msg-assistant'}>
                  {msg.content}
                </div>
              ))}
              {loading && <div className="ai-msg-assistant">正在思考中...</div>}
            </div>
            <div className="ai-chat-input-area">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSend(input);
                  }
                }}
                placeholder="输入你想看的电影..."
              />
              <button onClick={() => handleSend(input)} disabled={loading}>↑</button>
            </div>
          </div>
        </React.Fragment>
      )}
      {!isOpen && (
        <div className="ai-orb-container" onClick={togglePanel}>
          <div className="ai-orb"></div>
        </div>
      )}
    </React.Fragment>
  );
}
