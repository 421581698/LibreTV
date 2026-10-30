'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

const INIT_MESSAGE = { id: 'init', role: 'assistant', content: '你好！我是 Friday。你想看什么类型的电影？或者需要我为你推荐几部高分剧集吗？' };

export default function AIFloatingBall() {
  // ==========================================
  // 状态管理
  // ==========================================
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  
  // 聊天状态
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<{ id: string; role: string; content: string }[]>([INIT_MESSAGE]);
  const [loading, setLoading] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [innerHeight, setInnerHeight] = useState(500);

  // 悬浮球拖拽与录音状态
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  
  // 引用
  const dragStartRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const triggerElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => setMounted(true), []);

  // 1. 初始位置计算 & 窗口大小变化时的边界矫正
  useEffect(() => {
    const updateBounds = () => {
      setPosition(prev => {
        // 如果未初始化（0,0），设置到右下角
        if (prev.x === 0 && prev.y === 0) {
          return { x: window.innerWidth - 80, y: window.innerHeight - 150 };
        }
        // 如果已经存在，确保在旋转屏幕/缩小窗口后不超出边界
        return {
          x: Math.min(prev.x, window.innerWidth - 60),
          y: Math.min(prev.y, window.innerHeight - 60)
        };
      });
    };
    
    if (mounted) {
      updateBounds();
      window.addEventListener('resize', updateBounds);
    }
    return () => window.removeEventListener('resize', updateBounds);
  }, [mounted]);

  // 2. 退出动画延迟卸载 DOM
  useEffect(() => {
    if (!isMounted) return;
    const timer = setTimeout(() => {
      if (!isOpen) setIsMounted(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [isOpen, isMounted]);

  // ==========================================
  // 弹窗控制逻辑
  // ==========================================
  const togglePanel = (reset = false) => {
    if (isOpen) {
      setIsOpen(false);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setLoading(false); // 强制复位加载状态
      document.body.classList.remove('friday-popup-lock');

      // 焦点回退
      if (triggerElementRef.current && triggerElementRef.current.focus && triggerElementRef.current !== document.body) {
        triggerElementRef.current.focus();
      }
    } else {
      triggerElementRef.current = document.activeElement as HTMLElement;
      setIsMounted(true);
      setTimeout(() => {
        setIsOpen(true);
        document.body.classList.add('friday-popup-lock');
        setIsAtBottom(true);
        
        if (reset) {
          // 修复：使用完整的欢迎文案
          setMessages([INIT_MESSAGE]);
          setInput('');
        }

        setTimeout(() => {
          inputRef.current?.focus();
          forceScrollToBottom();
        }, 100);
      }, 10);
    }
  };

  // ==========================================
  // 全局副作用：ESC、软键盘、焦点陷阱
  // ==========================================
  useEffect(() => {
    if (!isOpen) return;

    // 1. 键盘事件 (ESC关闭 + Tab焦点陷阱)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        togglePanel(false);
        return;
      }
      if (e.key === 'Tab' && popupRef.current) {
        const focusableElements = popupRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const visibleElements = Array.from(focusableElements).filter(el => (el as HTMLElement).offsetParent !== null) as HTMLElement[];
        
        if (visibleElements.length === 0) return;
        const firstElement = visibleElements[0];
        const lastElement = visibleElements[visibleElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // 2. 软键盘适配
    const handleResize = () => {
      setInnerHeight(Math.min(600, window.visualViewport?.height ?? window.innerHeight * 0.8));
    };
    const vp = window.visualViewport;
    if (vp) vp.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (vp) vp.removeEventListener('resize', handleResize);
    };
  }, [isOpen]);

  // ==========================================
  // 拖拽逻辑
  // ==========================================
  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    dragStartRef.current = {
      x: clientX - position.x,
      y: clientY - position.y
    };
    isDraggingRef.current = false;
    setIsDragging(false);

    const handlePointerMove = (moveEvent: MouseEvent | TouchEvent) => {
      const moveX = 'touches' in moveEvent ? moveEvent.touches[0].clientX : moveEvent.clientX;
      const moveY = 'touches' in moveEvent ? moveEvent.touches[0].clientY : moveEvent.clientY;
      
      const deltaX = Math.abs(moveX - (dragStartRef.current.x + position.x));
      const deltaY = Math.abs(moveY - (dragStartRef.current.y + position.y));
      
      if (deltaX > 5 || deltaY > 5) {
        if (!isDraggingRef.current) {
          isDraggingRef.current = true;
          setIsDragging(true);
        }
        
        const maxX = window.innerWidth - 60;
        const maxY = window.innerHeight - 60;
        const newX = Math.max(0, Math.min(moveX - dragStartRef.current.x, maxX));
        const newY = Math.max(0, Math.min(moveY - dragStartRef.current.y, maxY));
        
        setPosition({ x: newX, y: newY });
      }
    };

    const handlePointerUp = () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('touchend', handlePointerUp);
      
      // 修复时序问题：直接同步重置状态，不用 setTimeout。这能防止快速点击被误判为拖拽
      setIsDragging(false);
      // 注意：isDraggingRef.current 会在 handleOrbClick 中的 onClick 触发后再重置
      // 使用 requestAnimationFrame 确保 onClick 事件优先于状态重置
      requestAnimationFrame(() => {
        isDraggingRef.current = false;
      });
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchmove', handlePointerMove, { passive: true });
    window.addEventListener('touchend', handlePointerUp);
  };

  const handleOrbClick = () => {
    if (isDraggingRef.current) return;
    togglePanel();
  };

  // ==========================================
  // 滚动与请求逻辑
  // ==========================================
  const formatText = (text: string) => {
    if (!text) return { __html: '' };
    let safe = text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br />');
    return { __html: safe };
  };

  const handleScroll = () => {
    if (!chatContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
    setIsAtBottom(scrollHeight - scrollTop - clientHeight < 50);
  };

  const forceScrollToBottom = () => {
    setIsAtBottom(true);
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({ top: chatContainerRef.current.scrollHeight, behavior: 'smooth' });
    }
  };

  useEffect(() => {
    if (isAtBottom && chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, isAtBottom, loading]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userId = Date.now() + Math.random().toString(36).substring(2);
    const newMessages = [...messages, { id: userId, role: 'user', content: text }];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    setIsAtBottom(true);
    forceScrollToBottom();

    const history = newMessages.slice(-10).map(m => ({ role: m.role, content: m.content }));
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) throw new Error('Network response was not ok');
      if (!response.body) throw new Error('empty response body');

      const reader = response.body.getReader();
      
      const aiId = Date.now() + Math.random().toString(36).substring(2);
      setMessages(prev => [...prev, { id: aiId, role: 'assistant', content: '' }]);

      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        // 修复：每次分片处理都实例化解码器，避免跨域残留碎片导致乱码
        const decoder = new TextDecoder('utf-8');
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.slice(6));
              const delta = data.choices?.[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1].content = fullContent;
                  return updated;
                });
              }
            } catch (e) {
              console.warn('SSE 解析错误:', e);
            }
          }
        }
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        const errId = Date.now() + Math.random().toString(36).substring(2);
        setMessages(prev => [...prev, { id: errId, role: 'assistant', content: '⚠️ 网络开小差了，请稍后再试。' }]);
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  // ==========================================
  // 渲染
  // ==========================================
  return (
    <>
      {/* 悬浮球 */}
      {!isOpen && (
        <div
          onMouseDown={handlePointerDown}
          onTouchStart={handlePointerDown}
          onClick={handleOrbClick}
          style={{
            position: 'fixed',
            left: 0,
            top: 0,
            transform: `translate(${position.x}px, ${position.y}px) scale(${isDragging ? 0.9 : 1})`,
            transition: isDragging ? 'none' : 'transform 0.2s cubic-bezier(0.25, 1.2, 0.5, 1)',
            zIndex: 1300,
            cursor: 'pointer',
            touchAction: 'none',
            width: '56px',
            height: '56px',
            opacity: position.x === 0 && position.y === 0 ? 0 : 1
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #007aff, #00c6ff)',
              boxShadow: '0 8px 24px rgba(0,122,255,0.4), inset 0 2px 4px rgba(255,255,255,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: '20px'
            }}
          >
            ✨
          </div>
        </div>
      )}

      {/* 弹窗 */}
      {mounted && isMounted && createPortal(
        <div 
          className={`fixed inset-0 z-[1400] flex items-start justify-center pt-[max(60px,env(safe-area-inset-top,0px)+10px)] pointer-events-none transition-all duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
        >
          <div 
            className="absolute inset-0 bg-black/40 pointer-events-auto backdrop-blur-sm transition-opacity duration-300" 
            onClick={() => togglePanel(false)}
          ></div>
          
          <div 
            ref={popupRef}
            className={`relative w-[90%] max-w-[400px] bg-[#08080a] text-white rounded-[40px] overflow-hidden flex flex-col pointer-events-auto shadow-[0_20px_40px_rgba(0,0,0,0.5),inset_0_0_0_1px_rgba(255,255,255,0.1)] transition-all duration-300 ease-[cubic-bezier(0.25,1.2,0.5,1)] ${isOpen ? 'scale-100 translate-y-0' : 'scale-90 -translate-y-5'}`}
            style={{ height: `${innerHeight}px` }}
          >
            <div className="absolute bottom-[-20px] left-0 w-full h-[80px] bg-[radial-gradient(ellipse_at_bottom,rgba(255,165,0,0.8)_0%,rgba(0,140,255,0.6)_40%,rgba(0,0,0,0)_70%)] blur-[15px] pointer-events-none opacity-80 z-0 animate-pulse"></div>

            <div className="relative z-10 flex flex-col h-full">
              <button 
                className="absolute top-4 right-4 w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-sm z-50 hover:bg-white/20 transition-colors" 
                onClick={() => togglePanel(false)}
              >
                ✕
              </button>
              
              <div 
                className="flex-1 overflow-y-auto p-6 pt-12 flex flex-col gap-4 scrollbar-hide relative" 
                ref={chatContainerRef} 
                onScroll={handleScroll}
              >
                <div className="flex items-center gap-2 text-sm text-gray-300 font-semibold mb-2">
                  <span>✨ Friday AI 助手</span>
                </div>

                {messages.map(msg => (
                  <div 
                    key={msg.id} 
                    className={`max-w-[85%] p-3 rounded-2xl text-[14px] leading-relaxed break-words ${
                      msg.role === 'user' 
                        ? 'self-end bg-blue-500/20 border border-blue-500/30 rounded-br-sm' 
                        : 'self-start bg-white/10 border border-white/10 rounded-bl-sm'
                    }`}
                  >
                    <div dangerouslySetInnerHTML={formatText(msg.content)} />
                  </div>
                ))}

                {loading && (
                  <div className="self-start bg-white/10 border border-white/10 p-4 rounded-2xl rounded-bl-sm flex gap-1 items-center">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></span>
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-100"></span>
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-200"></span>
                  </div>
                )}

                {!isAtBottom && (
                  <button 
                    onClick={forceScrollToBottom} 
                    className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-gray-800/90 border border-white/20 text-xs px-4 py-1.5 rounded-full shadow-lg backdrop-blur hover:bg-gray-700 transition z-30"
                  >
                    ↓ 回到底部
                  </button>
                )}
              </div>

              <div className="flex items-center p-4 gap-2 bg-black/40 border-t border-white/5 relative z-20">
                {/* 麦克风按钮：如果不需要直接删掉这个 <button> 即可 */}
                <button 
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${isRecording ? 'bg-red-500/20 text-red-500' : 'bg-white/5 text-gray-400 hover:text-white'}`}
                  onClick={() => setIsRecording(!isRecording)}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                  </svg>
                </button>
                
                <input 
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder="问问 Friday 看点什么..."
                  disabled={loading}
                  className="flex-1 bg-white/5 border border-white/10 rounded-full px-4 py-2.5 text-sm text-white outline-none focus:border-blue-500/50 transition-colors"
                />
                
                <button 
                  onClick={handleSend}
                  disabled={!input.trim() || loading}
                  className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center disabled:bg-gray-700 disabled:text-gray-500 transition-colors"
                >
                  {loading ? (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
</>
  );
}
