'use client';

interface ClassicWatchTitleProps {
  title: string;
  sourceName: string;
  hasEpisodes: boolean;
  currentIndex: number;
  episodeCount: number;
  isMovie: boolean;
}

/** Ordinary /watch chrome. Never mounted inside iPad Cinema V4. */
export function ClassicWatchTitle({
  title, sourceName, hasEpisodes, currentIndex, episodeCount, isMovie,
}: ClassicWatchTitleProps) {
  return <div className="netflix-title-row">
    <div className="min-w-0">
      <h1 className="text-xl sm:text-2xl font-semibold text-content truncate">{title}</h1>
      <p className="text-xs sm:text-sm text-muted mt-1">
        {sourceName} · {hasEpisodes ? `第 ${currentIndex + 1} / ${episodeCount} 集` : isMovie ? '电影' : '单集内容'}
      </p>
    </div>
  </div>;
}

export function ClassicWatchRateButton({
  rate, onCycle,
}: { rate: number; onCycle: () => void }) {
  return <button type="button" className="watch-cinema-rate"
    aria-label={`播放速度 ${rate} 倍`} title="切换播放速度"
    onClick={onCycle}>{rate}×</button>;
}

interface ClassicWatchToolsProps {
  hasEpisodes: boolean;
  currentIndex: number;
  episodeCount: number;
  skipPanelOpen: boolean;
  markedCount: number;
  autoplayNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onDownload: () => void;
  onToggleSkip: () => void;
  onAutoplayNext: (value: boolean) => void;
}
export function ClassicWatchTools({
  hasEpisodes, currentIndex, episodeCount, skipPanelOpen, markedCount,
  autoplayNext, onPrevious, onNext, onDownload, onToggleSkip, onAutoplayNext,
}: ClassicWatchToolsProps) {
  return <div className="netflix-watch-tools">
    {hasEpisodes && <>
      <button type="button" className="btn-ghost btn-sm" disabled={currentIndex <= 0} onClick={onPrevious}>上一集</button>
      <button type="button" className="btn-ghost btn-sm" disabled={currentIndex >= episodeCount - 1} onClick={onNext}>下一集</button>
    </>}
    <button type="button" className="btn-ghost btn-sm" onClick={onDownload}>下载本集</button>
    <button type="button" className={`btn-ghost btn-sm${skipPanelOpen ? ' bg-chip text-content' : ''}`}
      aria-expanded={skipPanelOpen} aria-haspopup="dialog" onClick={onToggleSkip}>
      跳过标记{markedCount > 0 ? ` (${markedCount})` : ''}
    </button>
    <label className="flex items-center gap-1.5 text-xs text-muted ml-auto cursor-pointer">
      <input type="checkbox" className="h-3.5 w-3.5 accent-[#2563eb]"
        checked={autoplayNext} onChange={(event) => onAutoplayNext(event.target.checked)} />
      自动连播
    </label>
  </div>;
}
