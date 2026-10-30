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
  const [showSettings, setShowSettings] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [voiceRate, setVoiceRate] = useState(1.0);
  const [voicePitch, setVoicePitch] = useState(0.9); 
  
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

  // 获取球体尺寸（兼容小屏）
  const getOrbSize = () => {
    if (typeof window === 'undefined') return { w: 90, h: 60 };
    return window.innerWidth <= 430 ? { w: 75, h: 50 } : { w: 90, h: 60 };
  };

  // 监听屏幕旋转与尺寸变化，修复边界
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      const { w, h } = getOrbSize();
      const maxW = window.innerWidth - w;
      const maxH = window.innerHeight - h - 20;
      setPosition(p => ({
        x: Math.max(0, Math.min(p.x, maxW)),
        y: Math.max(0, Math.min(p.y, maxH))
      }));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 读取拖拽位置记忆
  useEffect(() => {
    try {
      const savedPos = localStorage.getItem('ai-orb-pos');
      if (savedPos) setPosition(JSON.parse(savedPos));
    } catch (e) {}
  }, []);

  // 初始化语音包与麦克风（防崩溃处理）
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = false;
        recognitionRef.current.lang = 'zh-CN';
      }

      if ('speechSynthesis' in window) {
        const loadVoices = () => {
          const available = window.speechSynthesis.getVoices().filter(v => v.lang.includes('zh'));
          setVoices(available);
          if (available.length > 0) {
            const defaultVoice = available.find(v => v.name.includes('美') || v.name.includes('婷')) || available[0];
            setSelectedVoice(defaultVoice.name);
          }
        };
        loadVoices();
        window.speechSynthesis.onvoiceschanged = loadVoices;

        return () => {
          window.speechSynthesis.onvoiceschanged = null;
          window.speechSynthesis.cancel();
        };
      }
    } catch (err) {
      console.warn('语音功能初始化失败:', err);
    }
  }, []);

  // 消息滚动到底部
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isOpen, loading]);

  const speakText = (text: string) => {
    if (!isVoiceEnabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return; 
    try {
      window.speechSynthesis.cancel(); 
      const speakStr = text.length > 80 ? text.substring(0, 80) + '...' : text;
      const utterance = new SpeechSynthesisUtterance(speakStr);
      utterance.rate = voiceRate;
      utterance.pitch = voicePitch;
      const v = voices.find(v => v.name === selectedVoice);
      if (v) utterance.voice = v;
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('朗读失败', e);
    }
  };

  const startVoiceInput = () => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      alert('您的浏览器不支持语音输入，请用键盘输入。');
      return;
    }
    speakText('我在，请问有什么可以帮您？'); 
    setIsRecording(true);
    try {
      recognition.start();
      recognition.onresult = (event: any) => {
        setInput(event.results[0][0].transcript);
        setIsRecording(false);
      };
      recognition.onerror = () => setIsRecording(false);
      recognition.onend = () => setIsRecording(false);
    } catch (e) {
      setIsRecording(false);
    }
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
  }, [messages, isVoiceEnabled, voices, selectedVoice, voiceRate, voicePitch]);

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
      if ('touches' in e && e.cancelable) e.preventDefault(); 
    }

    const { w, h } = getOrbSize();
    const maxW = window.innerWidth - w;
    const maxH = window.innerHeight - h - 20;
    setPosition({ x: Math.max(0, Math.min(moveX, maxW)), y: Math.max(0, Math.min(moveY, maxH)) });
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    if (hasMoved.current && typeof window !== 'undefined') {
      try { localStorage.setItem('ai-orb-pos', JSON.stringify(position)); } catch (e) {}
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
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
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
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <button onClick={() => setShowSettings(!showSettings)} style={{ background: 'none', border: 'none', fontSize: '14px', cursor: 'pointer', color: '#aaa', fontWeight: 'bold' }}>设置</button>
                <button onClick={closePanel} style={{ background: 'none', border: 'none', fontSize: '16px', cursor: 'pointer', color: '#aaa' }}>✕</button>
              </div>
            </div>
            
            {showSettings && (
              <div className="ai-voice-settings">
                <div style={{ marginBottom: '8px' }}>
                  <span>发音人：</span>
                  {voices.length === 0 ? (
                    <span style={{color:'#ff9999', fontSize: '12px'}}>
                      未检测到中文语音，请前往设备设置下载
                    </span>
                  ) : (
                    <select value={selectedVoice} onChange={(e) => setSelectedVoice(e.target.value)}>
                      {voices.map(v => (
                        <option key={v.name} value={v.name}>{v.name}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>语速：</span>
                  <input type="range" min="0.5" max="1.5" step="0.1" value={voiceRate} onChange={(e) => setVoiceRate(parseFloat(e.target.value))} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>音调：</span>
                  <input type="range" min="0.5" max="1.5" step="0.1" value={voicePitch} onChange={(e) => setVoicePitch(parseFloat(e.target.value))} />
                </div>
              </div>
            )}

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
              <button className={`voice-btn ${isRecording ? 'recording' : ''}`} onClick={startVoiceInput}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                  <line x1="12" x2="12" y1="19" y2="22"></line>
                </svg>
              </button>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); handleSend(input); }
                }}
                placeholder="说话或输入..."
              />
              <button onClick={() => handleSend(input)} disabled={loading} style={{ borderRadius: '50%', width: '36px', height: '36px', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 12 7-7 7 7"/>
                  <path d="M12 19V5"/>
                </svg>
              </button>
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
            left: '0', top: '0', bottom: 'auto', right: 'auto', margin: '0',
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
