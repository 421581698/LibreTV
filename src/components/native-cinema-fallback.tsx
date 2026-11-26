'use client';
import { useEffect, useRef, useState } from 'react';
import type { PlayerSkipApi } from './player-shell';
import { probeNativeDolbyAudioCapability, type NativeDolbyAudioCapability } from '@/lib/dolby/native-audio-capability';

interface Props {
  url: string;
  retry: () => void;
  onApi: (api: PlayerSkipApi | null) => void;
  onClock: (position: number, duration: number) => void;
  onSwitch: () => void;
  onProgress: (position: number, duration: number) => void;
  onEnded: () => void;
  getRestorePosition: () => number | Promise<number>;
  panel: 'audio' | 'subtitles' | 'quality' | 'diagnostics' | null;
  onClosePanel: () => void;
}

// Emergency native playback for Safari-compatible media. Does not claim HLS
// rendition control, JOC, or the full ArtPlayer recovery feature set.
export function NativeCinemaFallback(props: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState('');
  const [nativeAudio, setNativeAudio] = useState<NativeDolbyAudioCapability | null>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setNativeAudio(probeNativeDolbyAudioCapability(mime => video.canPlayType(mime)));
    let disposed = false;
    let restored = false;
    let lastSaved = 0;
    const save = () => {
      if (restored && !video.ended && Number.isFinite(video.duration) && video.duration > 0) latest.current.onProgress(video.currentTime, video.duration);
    };
    const tick = () => {
      if (Date.now() - lastSaved >= 5000) { lastSaved = Date.now(); save(); }
    };
    const ended = () => latest.current.onEnded();
    const restore = async () => {
      try {
        const position = await latest.current.getRestorePosition();
        if (!disposed && Number.isFinite(position) && position > 0 && Number.isFinite(video.duration) && position < video.duration && video.currentTime === 0) video.currentTime = position;
      } catch { /* Continue without saved progress. */ }
      finally { if (!disposed) restored = true; }
    };
    video.addEventListener('loadedmetadata', restore, { once: true });
    if (video.readyState >= 1) { video.removeEventListener('loadedmetadata', restore); void restore(); }
    video.addEventListener('timeupdate', tick);
    video.addEventListener('pause', save);
    video.addEventListener('ended', ended);
    const sync = () => {
      latest.current.onClock(video.currentTime, Number.isFinite(video.duration) ? video.duration : 0);
      setSize(video.videoHeight > 0 ? video.videoWidth + ' × ' + video.videoHeight : '');
    };
    const events = ['loadedmetadata', 'durationchange', 'timeupdate', 'seeked', 'resize'];
    events.forEach(event => video.addEventListener(event, sync));
    latest.current.onApi({
      getCurrentTime: () => video.currentTime,
      getDuration: () => Number.isFinite(video.duration) ? video.duration : 0,
      seek: seconds => { if (Number.isFinite(seconds) && Number.isFinite(video.duration)) video.currentTime = Math.max(0, Math.min(seconds, video.duration)); },
      pause: () => video.pause(),
      isPaused: () => video.paused,
      getPlaybackRate: () => video.playbackRate,
      setPlaybackRate: rate => { if (Number.isFinite(rate) && rate >= .25 && rate <= 4) { video.playbackRate = rate; video.defaultPlaybackRate = rate; } },
    });
    sync();
    return () => {
      disposed = true;
      video.removeEventListener('loadedmetadata', restore);
      video.removeEventListener('timeupdate', tick);
      video.removeEventListener('pause', save);
      video.removeEventListener('ended', ended);
      events.forEach(event => video.removeEventListener(event, sync));
      latest.current.onApi(null);
      video.pause();
    };
  }, [props.url]);
  return <div className="cinema-native-fallback" data-testid="cinema-native-fallback">
    <video ref={videoRef} src={props.url} playsInline preload="metadata" onError={() => setFailed(true)} />
    <div className="cinema-native-status" role="status">
      {failed ? '原生播放也无法加载，请切换片源。' : '已切换至原生兼容播放，部分高级功能暂不可用。'}
      <button type="button" onClick={props.retry}>重试完整播放器</button>
      <button type="button" onClick={props.onSwitch}>切换片源</button>
    </div>
    {props.panel && <div className="cinema-v4-quality-panel">
      <button type="button" onClick={props.onClosePanel} aria-label="关闭兼容播放面板">关闭</button>
      {props.panel === 'audio' ? <p>浏览器 AC-3 支持声明：{nativeAudio?.ac3 ?? 'unknown'}；E-AC-3 支持声明：{nativeAudio?.eac3 ?? 'unknown'}。这不代表已输出 Dolby Digital、Dolby Digital Plus 或 Atmos。</p> : <p>{props.panel === 'quality' ? (size ? '实际视频尺寸：' + size : '尚未取得视频尺寸') : '兼容播放模式暂不提供此高级功能。'}</p>}
      <p>原生播放由浏览器管理清晰度与轨道。</p>
    </div>}
  </div>;
}
