export type SubtitleFormat = 'vtt' | 'srt';
export interface SubtitleCue {
  readonly id: string | null;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}
export interface SubtitleTrack {
  readonly format: SubtitleFormat;
  readonly cues: SubtitleCue[];
}

function parseTimestamp(value: string): number | null {
  const match = value.trim().match(/^(?:(\d{1,2}):)?(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(match[4]);
  if (minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

/** Parses WebVTT and SRT text cues. Rendering/ASS styling remains a separate layer. */
export function parseSubtitle(input: string, format?: SubtitleFormat): SubtitleTrack {
  const normalized = input.replace(/^\uFEFF/, '').replace(/\r/g, '');
  const detected: SubtitleFormat = format || (/^\s*WEBVTT(?:\s|$)/m.test(normalized) ? 'vtt' : 'srt');
  const lines = normalized.split('\n');
  const cues: SubtitleCue[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line || line === 'WEBVTT' || line.startsWith('NOTE') || line === 'STYLE' || line === 'REGION') {
      index += 1;
      while ((line.startsWith('NOTE') || line === 'STYLE' || line === 'REGION') && index < lines.length && lines[index].trim()) index += 1;
      continue;
    }

    let id: string | null = null;
    let timing = line;
    if (!line.includes('-->') && index + 1 < lines.length && lines[index + 1].includes('-->')) {
      id = line;
      timing = lines[index + 1].trim();
      index += 1;
    }
    const match = timing.match(/^(.+?)\s+-->\s+([^\s]+)(?:\s+.*)?$/);
    if (!match) { index += 1; continue; }
    const start = parseTimestamp(match[1]);
    const end = parseTimestamp(match[2]);
    index += 1;
    const textLines: string[] = [];
    while (index < lines.length && lines[index].trim()) {
      textLines.push(lines[index]);
      index += 1;
    }
    if (start === null || end === null || end <= start) continue;
    cues.push({ id, start, end, text: textLines.join('\n') });
  }

  cues.sort((a, b) => a.start - b.start || a.end - b.end);
  return { format: detected, cues };
}

export function findActiveSubtitle(cues: readonly SubtitleCue[], timeSeconds: number): SubtitleCue | null {
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) return null;
  let low = 0;
  let high = cues.length - 1;
  let candidate: SubtitleCue | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (cues[middle].start <= timeSeconds) {
      candidate = cues[middle];
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return candidate && timeSeconds < candidate.end ? candidate : null;
}
