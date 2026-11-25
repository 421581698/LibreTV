'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { GLASS_DEFAULTS, readGlassPreferences, selectGlassBackend, type GlassBackend, type GlassPreferences } from '@/lib/friday-glass/runtime';

const STORAGE_KEY = 'libretv-friday-glass-v1.1';
const GlassContext = createContext({
  backend: 'safe' as GlassBackend,
  preferences: GLASS_DEFAULTS,
  reducedMotion: true,
  update: (_preferences: Partial<GlassPreferences>) => { void _preferences; },
  reset: () => {},
  reportFailure: () => {},
  setPlaying: (_playing: boolean) => { void _playing; },
});

export function useFridayGlass() {
  return useContext(GlassContext);
}

export function FridayGlassProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(GLASS_DEFAULTS);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const attemptedRecovery = useRef(false);
  const [underPressure, setUnderPressure] = useState(false);
  const [capabilities, setCapabilities] = useState({
    contrast: false, transparency: false, forcedColors: false, backdrop: false,
    webkit: false, optical: false, reducedMotion: true,
  });

  useEffect(() => {
    try { setPreferences(readGlassPreferences(localStorage.getItem(STORAGE_KEY))); } catch {}
    setReady(true);
    if (typeof matchMedia !== 'function' || typeof CSS === 'undefined') return;
    const contrast = matchMedia('(prefers-contrast: more)');
    const transparency = matchMedia('(prefers-reduced-transparency: reduce)');
    const forcedColors = matchMedia('(forced-colors: active)');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const queries = [contrast, transparency, forcedColors, reducedMotion];
    const webkit = /AppleWebKit/.test(navigator.userAgent) &&
      (!/Chrome|Chromium|Edg|OPR/.test(navigator.userAgent) || /iPhone|iPad|iPod/.test(navigator.userAgent));
    const backdrop = CSS.supports('backdrop-filter', 'blur(2px)') ||
      CSS.supports('-webkit-backdrop-filter', 'blur(2px)');
    const optical = !webkit && /Chrome|Chromium|Edg/.test(navigator.userAgent) &&
      CSS.supports('backdrop-filter', 'url("#friday-optics")');
    const refresh = () => setCapabilities({
      contrast: contrast.matches, transparency: transparency.matches, forcedColors: forcedColors.matches,
      reducedMotion: reducedMotion.matches, backdrop, webkit, optical,
    });
    refresh();
    for (const query of queries) {
      if (query.addEventListener) query.addEventListener('change', refresh);
      else query.addListener(refresh);
    }
    return () => {
      for (const query of queries) {
        if (query.removeEventListener) query.removeEventListener('change', refresh);
        else query.removeListener(refresh);
      }
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); } catch {}
  }, [preferences, ready]);

  useEffect(() => {
    if (!capabilities.optical || preferences.quality !== 'auto' || typeof PerformanceObserver === 'undefined' ||
      !PerformanceObserver.supportedEntryTypes?.includes('longtask')) return;
    let recovery: number | undefined;
    let recent: number[] = [];
    const observer = new PerformanceObserver((list) => {
      if (document.hidden) return;
      const now = performance.now();
      recent = [...recent, ...list.getEntries().map((entry) => entry.startTime)].filter((time) => now - time < 3000);
      if (recent.length < 3) return;
      setUnderPressure(true);
      window.clearTimeout(recovery);
      recovery = window.setTimeout(() => setUnderPressure(false), 15000);
    });
    observer.observe({ type: 'longtask' });
    return () => {
      observer.disconnect();
      window.clearTimeout(recovery);
      setUnderPressure(false);
    };
  }, [capabilities.optical, preferences.quality]);

  useEffect(() => {
    if (!failed || attemptedRecovery.current) return;
    const timer = window.setTimeout(() => {
      attemptedRecovery.current = true;
      setFailed(false);
    }, 30000);
    return () => window.clearTimeout(timer);
  }, [failed]);

  const backend = selectGlassBackend({ ...capabilities, preferences, playing, underPressure, failed });
  const reducedMotion = capabilities.reducedMotion || !preferences.motion;
  const update = useCallback((changes: Partial<GlassPreferences>) => setPreferences((current) => ({ ...current, ...changes })), []);
  const reset = useCallback(() => {
    attemptedRecovery.current = false;
    setPreferences(GLASS_DEFAULTS);
    setFailed(false);
  }, []);
  const reportFailure = useCallback(() => setFailed(true), []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.fridayGlass = backend;
    root.dataset.fridayMotion = reducedMotion ? 'reduced' : 'full';
    root.dataset.fridayAmbient = preferences.ambient ? 'on' : 'off';
    root.dataset.fridayCinemaDark = String(preferences.cinemaDark);
    root.dataset.fridayPlayback = playing && preferences.playbackProtection ? 'protected' : 'normal';
    root.style.setProperty('--friday-intensity', String(preferences.intensity / 100));
  }, [backend, playing, preferences, reducedMotion]);

  return <GlassContext.Provider value={{ backend, preferences, reducedMotion, update, reset, reportFailure, setPlaying }}>{children}</GlassContext.Provider>;
}

export function useFridayGlassPlayback(playing: boolean) {
  const { setPlaying } = useFridayGlass();
  useEffect(() => {
    setPlaying(playing);
    return () => setPlaying(false);
  }, [playing, setPlaying]);
}
