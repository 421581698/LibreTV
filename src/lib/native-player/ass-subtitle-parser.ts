export type AssAlignment = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface AssStyle {
  name: string;
  fontName: string;
  fontSize: number;
  primaryColor: string;
  secondaryColor: string;
  outlineColor: string;
  backColor: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikeOut: boolean;
  scaleX: number;
  scaleY: number;
  spacing: number;
  angle: number;
  borderStyle: number;
  outline: number;
  shadow: number;
  alignment: AssAlignment;
  marginL: number;
  marginR: number;
  marginV: number;
  encoding: number;
}

export interface AssDialogue {
  layer: number;
  start: number;
  end: number;
  style: string;
  name: string;
  marginL: number;
  marginR: number;
  marginV: number;
  effect: string;
  text: string;
}

export interface AssDocument {
  format: 'ass' | 'ssa';
  playResX: number;
  playResY: number;
  styles: ReadonlyMap<string, AssStyle>;
  dialogues: readonly AssDialogue[];
  warnings: readonly string[];
}

const DEFAULT_STYLE: AssStyle = {
  name: 'Default', fontName: 'Arial', fontSize: 20,
  primaryColor: '&H00FFFFFF', secondaryColor: '&H000000FF',
  outlineColor: '&H00000000', backColor: '&H80000000',
  bold: false, italic: false, underline: false, strikeOut: false,
  scaleX: 100, scaleY: 100, spacing: 0, angle: 0,
  borderStyle: 1, outline: 2, shadow: 0, alignment: 2,
  marginL: 10, marginR: 10, marginV: 10, encoding: 1,
};

function numberField(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolField(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

function parseTime(value: string): number | null {
  const match = value.trim().match(/^(\d+):(\d{1,2}):(\d{1,2})[.](\d{1,2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const centiseconds = Number(match[4]);
  if (minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds + centiseconds / 100;
}

function parseAlignment(value: string | undefined): AssAlignment {
  const parsed = numberField(value, 2);
  return parsed >= 1 && parsed <= 9 && Number.isInteger(parsed)
    ? parsed as AssAlignment
    : 2;
}

function splitCsv(line: string, fieldCount: number): string[] {
  const fields: string[] = [];
  let start = 0;
  for (let i = 0; i < fieldCount - 1; i += 1) {
    const comma = line.indexOf(',', start);
    if (comma < 0) break;
    fields.push(line.slice(start, comma).trim());
    start = comma + 1;
  }
  fields.push(line.slice(start).trim());
  return fields;
}

function parseStyle(fields: readonly string[], values: readonly string[]): AssStyle {
  const raw = Object.fromEntries(fields.map((field, index) => [field.trim().toLowerCase(), values[index] ?? '']));
  return {
    name: raw.name || 'Default',
    fontName: raw.fontname || DEFAULT_STYLE.fontName,
    fontSize: numberField(raw.fontsize, DEFAULT_STYLE.fontSize),
    primaryColor: raw.primarycolour || raw.primarycolor || DEFAULT_STYLE.primaryColor,
    secondaryColor: raw.secondarycolour || raw.secondarycolor || DEFAULT_STYLE.secondaryColor,
    outlineColor: raw.outlinecolour || raw.outlinecolor || DEFAULT_STYLE.outlineColor,
    backColor: raw.backcolour || raw.backcolor || DEFAULT_STYLE.backColor,
    bold: boolField(raw.bold), italic: boolField(raw.italic),
    underline: boolField(raw.underline), strikeOut: boolField(raw.strikeout),
    scaleX: numberField(raw.scalex, 100), scaleY: numberField(raw.scaley, 100),
    spacing: numberField(raw.spacing, 0), angle: numberField(raw.angle, 0),
    borderStyle: numberField(raw.borderstyle, 1), outline: numberField(raw.outline, 2),
    shadow: numberField(raw.shadow, 0), alignment: parseAlignment(raw.alignment),
    marginL: numberField(raw.marginl, 10), marginR: numberField(raw.marginr, 10),
    marginV: numberField(raw.marginv, 10), encoding: numberField(raw.encoding, 1),
  };
}

/**
 * Parses the safe, static subset of ASS/SSA metadata and dialogue.
 * Vector drawings, karaoke timing, animated transforms and arbitrary script
 * effects are preserved as text but intentionally not executed by this parser.
 */
export function parseAssSubtitle(input: string): AssDocument {
  const source = input.replace(/^\uFEFF/, '').replace(/\r/g, '');
  const format: 'ass' | 'ssa' = /^\s*\[Script Info\]/im.test(source) ? 'ass' : 'ssa';
  let playResX = 384;
  let playResY = 288;
  let section = '';
  let styleFormat: string[] = [];
  let eventFormat: string[] = [];
  const styles = new Map<string, AssStyle>();
  const dialogues: AssDialogue[] = [];
  const warnings: string[] = [];

  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1].toLowerCase();
      continue;
    }

    if (section === 'script info') {
      const separator = line.indexOf(':');
      if (separator < 0) continue;
      const key = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();
      if (key === 'playresx') playResX = Math.max(1, numberField(value, playResX));
      if (key === 'playresy') playResY = Math.max(1, numberField(value, playResY));
      continue;
    }

    if (section === 'v4+ styles' || section === 'v4 styles') {
      if (/^format\s*:/i.test(line)) {
        styleFormat = line.slice(line.indexOf(':') + 1).split(',').map(value => value.trim());
      } else if (/^style\s*:/i.test(line) && styleFormat.length) {
        const values = splitCsv(line.slice(line.indexOf(':') + 1), styleFormat.length);
        const style = parseStyle(styleFormat, values);
        styles.set(style.name.toLowerCase(), style);
      }
      continue;
    }

    if (section === 'events') {
      if (/^format\s*:/i.test(line)) {
        eventFormat = line.slice(line.indexOf(':') + 1).split(',').map(value => value.trim());
      } else if (/^dialogue\s*:/i.test(line) && eventFormat.length) {
        const values = splitCsv(line.slice(line.indexOf(':') + 1), eventFormat.length);
        const raw = Object.fromEntries(eventFormat.map((field, index) => [field.toLowerCase(), values[index] ?? '']));
        const start = parseTime(raw.start ?? '');
        const end = parseTime(raw.end ?? '');
        if (start === null || end === null || end <= start) {
          warnings.push('Skipped dialogue with invalid or non-positive timestamps.');
          continue;
        }
        dialogues.push({
          layer: numberField(raw.layer ?? raw.marked, 0),
          start, end,
          style: raw.style || 'Default',
          name: raw.name || '',
          marginL: numberField(raw.marginl, 0),
          marginR: numberField(raw.marginr, 0),
          marginV: numberField(raw.marginv, 0),
          effect: raw.effect || '',
          text: raw.text || '',
        });
      }
    }
  }

  if (styles.size === 0) styles.set('default', { ...DEFAULT_STYLE });
  if (dialogues.length === 0) warnings.push('No valid dialogue events were found.');
  dialogues.sort((a, b) => a.start - b.start || a.layer - b.layer);
  return { format, playResX, playResY, styles, dialogues, warnings };
}

/** Converts ASS BGR/alpha color notation to CSS rgba; unknown values return null. */
export function assColorToRgba(value: string): string | null {
  const match = value.trim().match(/^&H([0-9A-F]{2})?([0-9A-F]{6})&?$/i);
  if (!match) return null;
  const alpha = match[1] ? Number.parseInt(match[1], 16) : 0;
  const packed = match[2];
  const blue = Number.parseInt(packed.slice(0, 2), 16);
  const green = Number.parseInt(packed.slice(2, 4), 16);
  const red = Number.parseInt(packed.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${1 - alpha / 255})`;
}

/** Removes override commands while retaining readable dialogue and line breaks. */
export function assDialogueToPlainText(value: string): string {
  return value
    .replace(/\x5c[Nn]/g, '\n')
    .replace(/\x5ch/g, ' ')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\[\\{}]/g, '');
}
