import { describe, expect, it } from 'vitest';
import { findActiveSubtitle, parseSubtitle } from './subtitle-engine';

describe('subtitle engine', () => {
  it('parses WebVTT cues and cue settings', () => {
    const track = parseSubtitle(`WEBVTT

intro
00:00:01.000 --> 00:00:03.500 align:start
Hello <b>world</b>!

00:00:04.000 --> 00:00:05.000
Next line`);
    expect(track.format).toBe('vtt');
    expect(track.cues).toHaveLength(2);
    expect(track.cues[0].start).toBe(1);
    expect(track.cues[0].text).toContain('Hello');
  });

  it('parses SRT timestamps and sorts cues', () => {
    const track = parseSubtitle(`2
00:00:05,000 --> 00:00:06,000
Second

1
00:00:01,000 --> 00:00:02,000
First`);
    expect(track.cues.map(cue => cue.start)).toEqual([1, 5]);
  });

  it('finds the active cue and respects cue end boundaries', () => {
    const track = parseSubtitle(`00:00:01,000 --> 00:00:02,000
Hello`);
    expect(findActiveSubtitle(track.cues, 1.5)?.text).toBe('Hello');
    expect(findActiveSubtitle(track.cues, 2)).toBeNull();
  });
});
