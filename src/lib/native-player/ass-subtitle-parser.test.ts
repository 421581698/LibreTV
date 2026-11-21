import { describe, expect, it } from 'vitest';
import {
  assColorToRgba,
  assDialogueToPlainText,
  parseAssSubtitle,
} from './ass-subtitle-parser';

const fixture = `[Script Info]
Title: parser fixture
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,40,40,36,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.20,0:00:03.45,Default,,0,0,0,,Hello, world!\\NSecond line
Dialogue: 1,0:00:04.00,0:00:05.00,Default,,0,0,0,,{\\an8}Top aligned
`;

describe('ASS/SSA subtitle parser', () => {
  it('parses script resolution, styles, dialogue and comma-containing text', () => {
    const result = parseAssSubtitle(fixture);
    expect(result.format).toBe('ass');
    expect(result.playResX).toBe(1920);
    expect(result.playResY).toBe(1080);
    expect(result.styles.get('default')?.fontSize).toBe(48);
    expect(result.dialogues).toHaveLength(2);
    expect(result.dialogues[0].text).toContain('Hello, world!');
    expect(result.dialogues[0].start).toBeCloseTo(1.2);
    expect(result.dialogues[1].layer).toBe(1);
  });

  it('skips malformed timestamps and reports a warning', () => {
    const result = parseAssSubtitle(`[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,broken,0:00:03.00,Default,,0,0,0,,Bad cue`);
    expect(result.dialogues).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('converts ASS BGR color and strips override tags for plain text', () => {
    expect(assColorToRgba('&H0000FF00')).toBe('rgba(0, 255, 0, 1)');
    expect(assDialogueToPlainText('{\\an8}Top\\Nline')).toBe('Top\nline');
  });

  it('uses defaults for an empty but valid document', () => {
    const result = parseAssSubtitle('[Script Info]\nTitle: Empty');
    expect(result.styles.has('default')).toBe(true);
    expect(result.dialogues).toHaveLength(0);
  });
});
