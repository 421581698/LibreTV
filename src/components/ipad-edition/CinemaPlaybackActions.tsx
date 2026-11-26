'use client';

type CinemaPanel = 'audio' | 'subtitles' | 'quality' | 'diagnostics' | null;

/**
 * Cinema V4's only player action bar. The ordinary /watch toolbar and
 * ArtPlayer chrome are intentionally not mounted by this component.
 */
export interface CinemaPlaybackActionsProps {
  rate: number;
  locked: boolean;
  hasEpisodes: boolean;
  panel: CinemaPanel;
  sourcePanelOpen: boolean;
  onRate: () => void;
  onLock: () => void;
  onEpisodes: () => void;
  onAudioAndSubtitles: () => void;
  onQuality: () => void;
  onSources: () => void;
  onDiagnostics: () => void;
  onFullscreen: () => void;
  onUnlock: () => void;
}

export function CinemaPlaybackActions({
  rate, locked, hasEpisodes, panel, sourcePanelOpen,
  onRate, onLock, onEpisodes, onAudioAndSubtitles,
  onQuality, onSources, onDiagnostics, onFullscreen, onUnlock,
}: CinemaPlaybackActionsProps) {
  return <>
    <div className="cinema-v4-actions" role="toolbar" aria-label="影院播放功能">
      <button type="button" data-friday-material="cinema" className="cinema-v4-tool" aria-label={`播放速度 ${rate} 倍`} onClick={onRate}>
        <span aria-hidden="true" className="cinema-v4-tool-symbol">{rate}×</span><span>倍速</span>
      </button>
      <button type="button" data-friday-material="cinema" className="cinema-v4-tool" aria-pressed={locked} onClick={onLock}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg><span>{locked ? '解锁' : '锁定'}</span>
      </button>
      {hasEpisodes && <button type="button" data-friday-material="cinema" className="cinema-v4-tool" onClick={onEpisodes}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/></svg><span>选集</span>
      </button>}
      <button type="button" data-friday-material="cinema" className="cinema-v4-tool" aria-expanded={panel === 'audio' || panel === 'subtitles'} onClick={onAudioAndSubtitles}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18v12H9l-5 3v-3H3z"/><path d="M7 10h10M7 13h6"/></svg><span>音频与字幕</span>
      </button>
      <button type="button" data-friday-material="cinema" className="cinema-v4-tool" aria-expanded={panel === 'quality'} onClick={onQuality}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15l4-4 3 3 3-4"/></svg><span>画质</span>
      </button>
      <button type="button" data-friday-material="cinema" className="cinema-v4-tool cinema-v4-source-control" aria-expanded={sourcePanelOpen} aria-controls="netflix-watch-utility-panel" onClick={onSources}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="5" rx="1"/><rect x="3" y="14" width="18" height="5" rx="1"/></svg><span>播放源</span>
      </button>
      <button type="button" data-friday-material="cinema" className="cinema-v4-tool" aria-expanded={panel === 'diagnostics'} onClick={onDiagnostics}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/></svg><span>诊断</span>
      </button>
      <button type="button" data-friday-material="cinema" className="cinema-v4-tool" onClick={onFullscreen}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg><span>全屏</span>
      </button>
    </div>
    {locked && <>
      <div className="cinema-v4-touch-shield" aria-hidden="true"
        onPointerDown={(event) => event.stopPropagation()}
        onPointerMove={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()} />
      <button type="button" className="cinema-v4-unlock" onClick={onUnlock} aria-label="解锁屏幕">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg><span>解除触控锁定</span>
      </button>
    </>}
  </>;
}
