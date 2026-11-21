export type SubtitleTrackSource = 'hls' | 'native';

export interface SubtitleTrackOption {
  id: string;
  label: string;
  language: string;
  source: SubtitleTrackSource;
  index: number;
  isDefault: boolean;
}

export interface HlsSubtitleTrackLike {
  name?: string;
  lang?: string;
  default?: boolean;
  forced?: boolean;
}

export interface HlsSubtitleControllerLike {
  subtitleTracks: readonly HlsSubtitleTrackLike[];
  subtitleTrack: number;
  subtitleDisplay: boolean;
}

export interface NativeSubtitleTrackLike {
  id?: string;
  label?: string;
  language?: string;
  kind?: string;
  mode: TextTrackMode;
}

export interface NativeSubtitleTrackListLike {
  readonly length: number;
  [index: number]: NativeSubtitleTrackLike;
}

export function listSubtitleTracks(
  video: Pick<HTMLMediaElement, 'textTracks'>,
  hls?: HlsSubtitleControllerLike | null,
): SubtitleTrackOption[] {
  if (hls?.subtitleTracks.length) {
    return hls.subtitleTracks.map((track, index) => ({
      id: `hls:${index}`,
      label: track.name?.trim() || track.lang?.trim() || `字幕 ${index + 1}`,
      language: track.lang ?? '',
      source: 'hls',
      index,
      isDefault: Boolean(track.default),
    }));
  }

  const tracks = video.textTracks as unknown as NativeSubtitleTrackListLike;
  const options: SubtitleTrackOption[] = [];
  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index];
    if (track.kind && track.kind !== 'subtitles' && track.kind !== 'captions') continue;
    options.push({
      id: `native:${track.id || index}`,
      label: track.label?.trim() || track.language?.trim() || `字幕 ${index + 1}`,
      language: track.language ?? '',
      source: 'native',
      index,
      isDefault: track.mode === 'showing',
    });
  }
  return options;
}

/** Select one track and disable every competing subtitle renderer. */
export function applySubtitleTrack(
  video: Pick<HTMLMediaElement, 'textTracks'>,
  hls: HlsSubtitleControllerLike | null | undefined,
  trackId: string | null,
  enabled: boolean,
): boolean {
  const tracks = video.textTracks as unknown as NativeSubtitleTrackListLike;
  const selectedHls = enabled && trackId?.startsWith('hls:') ? Number(trackId.slice(4)) : -1;
  if (hls) {
    hls.subtitleDisplay = selectedHls >= 0 && Number.isInteger(selectedHls) && selectedHls < hls.subtitleTracks.length;
    hls.subtitleTrack = hls.subtitleDisplay ? selectedHls : -1;
  }

  const selectedNative = enabled && trackId?.startsWith('native:') ? trackId.slice(7) : null;
  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index];
    const id = `native:${track.id || index}`;
    track.mode = selectedNative === id.slice(7) ? 'showing' : 'disabled';
  }

  if (!enabled || trackId === null) return true;
  if (trackId.startsWith('hls:')) return Boolean(hls?.subtitleDisplay);
  if (trackId.startsWith('native:')) {
    return Array.from({ length: tracks.length }, (_, index) => tracks[index])
      .some((track, index) => `native:${track.id || index}` === trackId && track.mode === 'showing');
  }
  return false;
}
