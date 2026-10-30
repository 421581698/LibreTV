'use client';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

export default function AIFloatingBall() {
  const router = useRouter(); 
  
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<{ id: string; role: string; content: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  
  // ✅ 恢复：语音开关与防抖锁
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true); 
  const [orbLock, setOrbLock] = useState(false);
  
  // 语音设置
  const [showSettings, setShowSettings] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [voiceRate, setVoiceRate] = useState(1.0);
  const [voicePitch, setVoicePitch] = useState(0.9); 
  
  // 拖拽状态
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const hasMoved = useRef(false);
  
  const recognitionRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const loadingRef = useRef(false);

  useEffect(() => { loadingRef.current = loading; }, [loading]);

  const getOrbSize = () => {
    if (typeof window === 'undefined') return { w: 90, h: 60 };
    return window.innerWidth <= 430 ? { w: 75, h: 50 } : { w: 90, h: 60 };
  };

  // 监听屏幕变化
  useEffect(() => {
    const handleResize = () => {
      if (typeof window === 'undefined') return;
      const { w, h } = getOrbSize();
      setPosition(p => ({
        x: Math.max(0, Math.min(p.x, window.innerWidth - w)),
        y: Math.max(0, Math.min(p.y, window.innerHeight - h - 20))
      }));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 读取位置记忆
  useEffect(() => {
    try {
      const savedPos = localStorage.getItem('ai-orb-pos');
      if (savedPos) setPosition(JSON.parse(savedPos));
    } catch (e) {}
  }, []);

  // 初始化语音系统
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
            setSelectedVoice(available.find(v => v.name.includes('美') || v.name.includes('婷'))?.name || available[0].name);
          }
        };
        loadVoices();
        window.speechSynthesis.onvoiceschanged = loadVoices;
        return () => {
          window.speechSynthesis.onvoiceschanged = null;
          window.speechSynthesis.cancel();
        };
      }
    } catch (err) {}
  }, []);

  // 滚动到底部
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isOpen, loading]);

  // ✅ 恢复：统一的关闭面板逻辑，自动停止语音
  const closePanel = useCallback(() => {
    fetchAbortRef.current?.abort();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsOpen(false);
    setInput('');
  }, []);

  // 语音播报逻辑
  const speakText = useCallback((text: string) => {
    if (!isVoiceEnabled) return; // ✅ 拦截静音
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return; 
    try {
      window.speechSynthesis.cancel(); 
      const utterance = new SpeechSynthesisUtterance(text.substring(0, 80));
      utterance.rate = voiceRate;
      utterance.pitch = voicePitch;
      const v = voices.find(v => v.name === selectedVoice);
      if (v) utterance.voice = v;
      window.speechSynthesis.speak(utterance);
    } catch (e) {}
  }, [isVoiceEnabled, voiceRate, voicePitch, voices, selectedVoice]);

  // 启动录音
  const startVoiceInput = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return alert('您的浏览器不支持语音输入');
    speakText('我在，请问有什么可以帮您？'); 
    setIsRecording(true);
    try {
      recognition.start();
      recognition.onresult = (event: any) => {
        setInput(event.results[0][0].transcript);
        setIsRecording(false);
      };
      recognition.onerror = () => {
        setIsRecording(false);
        alert('麦克风识别失败，请检查权限或环境噪音');
      };
      recognition.onend = () => setIsRecording(false);
    } catch (e) { setIsRecording(false); }
  };

  // 发送消息
  const handleSend = useCallback(async (text: string) => {
    if (!text.trim() || loadingRef.current) return;

    const userMsg = { id: `${Date.now()}-${Math.random()}`, role: 'user', content: text };
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
        pageContext = `【页面内容摘要】：${mainContent.innerText.replace(/\s+/g, ' ').substring(0, 500)}`;
      }

      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'system', content: pageContext }, ...currentMessages] }),
        signal: abortCtrl.signal
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '请求失败');
      
      if (data.reply) {
        let finalReply = data.reply;
        const searchMatch = finalReply.match(/\[SEARCH:\s*(.*?)\s*\]/s);
        
        if (searchMatch && searchMatch[1]) {
          const query = searchMatch[1].trim();
          finalReply = finalReply.replace(searchMatch[0], '').trim();
          setTimeout(() => { router.push(`/?s=${encodeURIComponent(query)}`); closePanel(); }, 800);
        }
        
        if (finalReply.includes('[ACTION:OPEN_SETTINGS]')) {
          finalReply = finalReply.replace('[ACTION:OPEN_SETTINGS]', '').trim();
          setTimeout(() => {
            const btn = document.querySelector('a[href="/settings"]') || document.querySelector('.lucide-settings')?.parentElement;
            if (btn) (btn as HTMLElement).click();
            closePanel();
          }, 800);
        }

        setMessages(p => [...p, { id: `${Date.now()}-${Math.random()}`, role: 'assistant', content: finalReply }]);
        speakText(finalReply);
      } else {
        setMessages(p => [...p, { id: `${Date.now()}-${Math.random()}`, role: 'assistant', content: 'AI 大脑短路了。' }]);
      }
    } catch (error: any) {
      if (error.name === 'AbortError') return;
      setMessages(p => [...p, { id: `${Date.now()}-${Math.random()}`, role: 'assistant', content: error.message || '网络异常。' }]);
    } finally {
      setLoading(false);
    }
  }, [messages, router, speakText, closePanel]);

  // ✅ 恢复：拖拽与点击的完美区分逻辑
  const togglePanel = () => {
    if (hasMoved.current || orbLock) return;
    setOrbLock(true);
    setIsOpen(prev => !prev);
    setTimeout(() => setOrbLock(false), 300);
  };

  const handleTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
    const cx = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const cy = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    dragStart.current = { x: cx - position.x, y: cy - position.y };
    setIsDragging(true);
    hasMoved.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isDragging) return;
    const cx = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const cy = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    const mx = cx - dragStart.current.x;
    const my = cy - dragStart.current.y;

    if (Math.abs(mx - position.x) > 5 || Math.abs(my - position.y) > 5) {
      hasMoved.current = true;
      if ('touches' in e && e.cancelable) e.preventDefault(); 
    }

    const { w, h } = getOrbSize();
    setPosition({ x: Math.max(0, Math.min(mx, window.innerWidth - w)), y: Math.max(0, Math.min(my, window.innerHeight - h - 20)) });
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    if (hasMoved.current) {
      try { localStorage.setItem('ai-orb-pos', JSON.stringify(position)); } catch (e) {}
    }
    setTimeout(() => { hasMoved.current = false; }, 50); 
  };

  return (
    <React.Fragment>
      {isOpen && (
        <React.Fragment>
          {/* ✅ 恢复：背景遮罩层 */}
          <div className="ai-chat-overlay" onClick={closePanel}></div>
          
          <div className="ai-chat-panel" onClick={(e) => e.stopPropagation()}>
            <div className="ai-chat-header">
              <span>AI 贾维斯管家</span>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                {/* ✅ 恢复：静音开关 */}
                <button onClick={() => setIsVoiceEnabled(!isVoiceEnabled)} style={{ background: 'none', border: 'none', fontSize: '16px', cursor: 'pointer' }}>
                  {isVoiceEnabled ? '🔊' : '🔇'}
                </button>
                <button onClick={() => setShowSettings(!showSettings)} style={{ background: 'none', border: 'none', color: '#aaa', fontWeight: 'bold', fontSize: '14px', cursor: 'pointer' }}>设置</button>
                <button onClick={closePanel} style={{ background: 'none', border: 'none', color: '#aaa', fontSize: '16px', cursor: 'pointer' }}>✕</button>
              </div>
            </div>
            
            {showSettings && (
              <div className="ai-voice-settings">
                <div style={{ marginBottom: '8px' }}>
                  <span>发音人：</span>
                  {voices.length === 0 ? <span style={{color:'#ff9999', fontSize:'12px'}}>请在系统设置下载中文语音</span> : (
                    <select value={selectedVoice} onChange={(e) => setSelectedVoice(e.target.value)}>
                      {voices.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
                    </select>
                  )}
                </div>
                <div style={{ marginBottom: '8px', display: 'flex', gap: '8px', alignItems: 'center' }}><span>语速：</span><input type="range" min="0.5" max="1.5" step="0.1" value={voiceRate} onChange={(e) => setVoiceRate(parseFloat(e.target.value))} style={{ flex: 1 }} /></div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><span>音调：</span><input type="range" min="0.5" max="1.5" step="0.1" value={voicePitch} onChange={(e) => setVoicePitch(parseFloat(e.target.value))} style={{ flex: 1 }} /></div>
              </div>
            )}

            <div className="ai-chat-messages" ref={scrollRef}>
              {messages.length === 0 && <div className="ai-msg-assistant">你好，我是你的贾维斯。我能看见你的屏幕，可以帮你搜电影、打开设置。</div>}
              {messages.map((msg) => (
                <div key={msg.id} className={msg.role === 'user' ? 'ai-msg-user' : 'ai-msg-assistant'}>{msg.content}</div>
              ))}
              {loading && <div className="ai-msg-assistant">思考中...</div>}
            </div>

            <div className="ai-chat-input-area">
              <button className={`voice-btn ${isRecording ? 'recording' : ''}`} onClick={startVoiceInput}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" x2="12" y1="19" y2="22"></line></svg>
              </button>
              <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSend(input)} placeholder="说话或输入..." />
              <button onClick={() => handleSend(input)} disabled={loading}>↑</button>
            </div>
          </div>
        </React.Fragment>
      )}
      
      {!isOpen && (
        <div 
          className="ai-orb-container" onClick={togglePanel}
          onMouseDown={handleTouchStart} onMouseMove={handleTouchMove} onMouseUp={handleTouchEnd} onMouseLeave={handleTouchEnd}
          onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}
          style={{ transform: `translate(${position.x}px, ${position.y}px)`, left: '0', top: '0', bottom: 'auto', right: 'auto', margin: '0' }}
        >
          <div className="ai-orb"></div>
        </div>
      )}
    </React.Fragment>
  );
}
