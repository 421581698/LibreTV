'use client';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

export const triggerAIChat = (initialText?: string) => {
  const safeText = initialText ?? '';
  const event = new CustomEvent('openAIChat', { detail: safeText });
  window.dispatchEvent(event);
};

const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export default function AIFloatingBall() {
  const router = useRouter(); 
  
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<{ id: string; role: string; content: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [orbLock, setOrbLock] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true); 
  
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const hasMoved = useRef(false);
  const recognitionRef = useRef<any>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const loadingRef = useRef(false);

  useEffect(() => { loadingRef.current = loading; }, [loading]);

  // 屏幕旋转/窗口改变自动校正位置
  useEffect(() => {
    const handleResize = () => {
      const maxW = window.innerWidth - 90;
      const maxH = window.innerHeight - 100;
      setPosition(p => ({
        x: Math.max(0, Math.min(p.x, maxW)),
        y: Math.max(0, Math.min(p.y, maxH))
      }));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const savedPos = localStorage.getItem('ai-orb-pos');
    if (savedPos) {
      try { setPosition(JSON.parse(savedPos)); } catch (e) {}
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.lang = 'zh-CN';
    }
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isOpen, loading]);

  const speakText = (text: string) => {
    if (!isVoiceEnabled) return; 
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel(); 
      const speakStr = text.length > 80 ? text.substring(0, 80) + '...' : text;
      const utterance = new SpeechSynthesisUtterance(speakStr);
      utterance.lang = 'zh-CN';
      utterance.rate = 1.1;
      window.speechSynthesis.speak(utterance);
    }
  };

  const startVoiceInput = () => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      alert('您的浏览器不支持语音输入，请用键盘。');
      return;
    }
    speakText('我在，请问有什么可以帮您？'); 
    setIsRecording(true);
    recognition.start();
    recognition.onresult = (event: any) => {
      setInput(event.results[0][0].transcript);
      setIsRecording(false);
    };
    recognition.onerror = () => setIsRecording(false);
    recognition.onend = () => setIsRecording(false);
  };

  const handleSend = useCallback(async (text: string) => {
    if (!text.trim() || loadingRef.current) return;

    const userMsg = { id: generateId(), role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    
    const currentMessages = [...messages, userMsg].slice(-10); 
    setInput('');
    setLoading(true);
    
    fetchAbortRef.current?.abort();
    const abortCtrl = new AbortController();
    fetchAbortRef.current = abortCtrl;

    try {
      let pageContext = '';
      if (typeof document !== 'undefined') {
        const mainContent = document.querySelector('main') || document.body;
        const rawText = mainContent.innerText.replace(/\s+/g, ' ').substring(0, 500);
        pageContext = `【当前用户网页上显示的内容摘要】：${rawText}`;
      }

      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          messages: [
            { role: 'system', content: pageContext }, 
            ...currentMessages.map(({ id, ...rest }) => rest) 
          ] 
        }),
        signal: abortCtrl.signal
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '网络请求失败');
      
      if (data.reply) {
        let finalReply = data.reply;
        let searchQuery = '';

        const searchMatch = finalReply.match(/\[SEARCH:\s*(.*?)\s*\]/s);
        if (searchMatch && searchMatch[1]) {
          searchQuery = searchMatch[1].trim();
          finalReply = finalReply.replace(searchMatch[0], '').trim();
        }

        const actionMatch = finalReply.match(/\[ACTION:OPEN_SETTINGS\]/);
        if (actionMatch) {
          finalReply = finalReply.replace(actionMatch[0], '').trim();
          setTimeout(() => {
            const settingsBtn = document.querySelector('a[href="/settings"]') || 
                                document.querySelector('button[aria-label="设置"]') || 
                                document.querySelector('.lucide-settings')?.parentElement;
            if (settingsBtn) (settingsBtn as HTMLElement).click();
            setIsOpen(false);
          }, 800);
        }

        setMessages(p => [...p, { id: generateId(), role: 'assistant', content: finalReply }]);
        speakText(finalReply);

        if (searchQuery) {
          setTimeout(() => {
            router.push(`/?s=${encodeURIComponent(searchQuery)}`);
            setIsOpen(false);
          }, 800);
        }
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
  }, [messages, isVoiceEnabled]);

  const handleTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    dragStart.current = { x: clientX - position.x, y: clientY - position.y };
    setIsDragging(true);
    hasMoved.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isDragging) return;
    
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    
    const moveX = clientX - dragStart.current.x;
    const moveY = clientY - dragStart.current.y;

    if (Math.abs(moveX - position.x) > 5 || Math.abs(moveY - position.y) > 5) {
      hasMoved.current = true;
      if ('touches' in e && e.cancelable) {
        e.preventDefault(); 
      }
    }

    const maxW = window.innerWidth - 90;
    const maxH = window.innerHeight - 100;
    setPosition({ 
      x: Math.max(0, Math.min(moveX, maxW)), 
      y: Math.max(0, Math.min(moveY, maxH)) 
    });
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    if (hasMoved.current) {
      localStorage.setItem('ai-orb-pos', JSON.stringify(position));
    }
    setTimeout(() => { hasMoved.current = false; }, 50); 
  };

  const togglePanel = () => {
    if (hasMoved.current || orbLock) return;
    setOrbLock(true);
    setIsOpen(prev => !prev);
    setTimeout(() => setOrbLock(false), 300);
  };

  const closePanel = () => {
    fetchAbortRef.current?.abort();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsOpen(false);
    setInput('');
  };

  return (
    <React.Fragment>
      {isOpen && (
        <React.Fragment>
          <div className="ai-chat-overlay" onClick={closePanel}></div>
          <div className="ai-chat-panel" onClick={(e) => e.stopPropagation()}>
            <div className="ai-chat-header">
              <span>AI 贾维斯管家</span>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button 
                  onClick={() => setIsVoiceEnabled(!isVoiceEnabled)}
                  style={{ background: 'none', border: 'none', fontSize: '16px', cursor: 'pointer', opacity: 0.8 }}
                >
                  {isVoiceEnabled ? '🔊' : '🔇'}
                </button>
                <button onClick={closePanel}>✕</button>
              </div>
            </div>
            <div className="ai-chat-messages" ref={scrollRef}>
              {messages.length === 0 && (
                <div className="ai-msg-assistant">你好，我是你的贾维斯。我能看见你的屏幕，可以帮你搜电影、打开设置，甚至写代码。</div>
              )}
              {messages.map((msg) => (
                <div key={msg.id} className={msg.role === 'user' ? 'ai-msg-user' : 'ai-msg-assistant'}>
                  {msg.content}
                </div>
              ))}
              {loading && <div className="ai-msg-assistant">正在思考中...</div>}
            </div>
            <div className="ai-chat-input-area">
              <button 
                className="voice-btn" 
                onClick={startVoiceInput}
                style={{ background: 'transparent', color: isRecording ? '#ff4444' : '#fff', border: 'none', fontSize: '20px', padding: '0 10px' }}
              >
                {isRecording ? '🔴' : '🎤'}
              </button>
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
                placeholder="说话或输入..."
              />
              <button onClick={() => handleSend(input)} disabled={loading}>↑</button>
            </div>
          </div>
        </React.Fragment>
      )}
      
      {!isOpen && (
        <div 
          className="ai-orb-container" 
          onClick={togglePanel}
          onMouseDown={handleTouchStart}
          onMouseMove={handleTouchMove}
          onMouseUp={handleTouchEnd}
          onMouseLeave={handleTouchEnd}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{
            transform: `translate(${position.x}px, ${position.y}px)`,
            transition: isDragging ? 'none' : 'transform 0.3s ease-out',
            left: '0',
            top: '0',
            bottom: 'auto',
            right: 'auto',
            margin: '0',
          }}
        >
          <div 
            className="ai-orb"
            style={{
              transform: `scale(${isDragging ? 1.05 : 1})`,
              transition: isDragging ? 'none' : 'transform 0.3s ease-out'
            }}
          ></div>
        </div>
      )}
    </React.Fragment>
  );
}
