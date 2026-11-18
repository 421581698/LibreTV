'use client';

import { useEffect, useState } from 'react';

/**
 * Safari may suspend media while the page is backgrounded. This notice never
 * calls play(): the user must resume playback with a fresh interaction.
 */
export function IpadCinemaResumeNotice() {
  const [pending, setPending] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onDecision = (event: Event) => {
      const detail = (event as CustomEvent<{
        kind?: string;
        decision?: string;
      }>).detail;
      if (detail?.kind !== 'app-background' || !detail.decision || detail.decision === 'none') return;
      setPending(true);
      setVisible(document.visibilityState === 'visible');
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && pending) setVisible(true);
    };
    document.addEventListener('ipad-cinema:resume-decision', onDecision);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('ipad-cinema:resume-decision', onDecision);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [pending]);

  if (!visible || !pending) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-[100] mx-auto flex max-w-xl items-center justify-between gap-3 rounded-2xl border border-white/15 bg-black/85 px-4 py-3 text-sm text-white shadow-2xl backdrop-blur-xl"
    >
      <span>已保存播放进度。请轻点播放器的播放按钮继续。</span>
      <button
        type="button"
        className="shrink-0 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium"
        onClick={() => { setPending(false); setVisible(false); }}
      >
        知道了
      </button>
    </div>
  );
}
