import { describe, expect, it } from 'vitest';
import { sanitizeDownloadFilename, suggestDownloadFilename } from './download-saver';

describe('download filename safety', () => {
  it('removes path separators and reserved filename characters', () => {
    const result = sanitizeDownloadFilename('../../evil:name?.mp4');
    expect(result).toBe('_.._evil_name_.mp4');
    expect(result).not.toMatch(/[\\/:*?"<>|]/);
  });

  it('prefixes Windows reserved device names', () => {
    expect(sanitizeDownloadFilename('CON.mp4')).toBe('_CON.mp4');
    expect(sanitizeDownloadFilename('LPT1')).toBe('_LPT1');
  });

  it('removes control and bidirectional override characters', () => {
    expect(sanitizeDownloadFilename('safe\u202Ename\u0000.mp4')).toBe('safename.mp4');
  });

  it('keeps a valid extension when truncating long titles', () => {
    const result = sanitizeDownloadFilename('x'.repeat(240) + '.mp4');
    expect(result.length).toBeLessThanOrEqual(180);
    expect(result.endsWith('.mp4')).toBe(true);
  });

  it('infers a direct media extension from the URL path, not its query string', () => {
    expect(suggestDownloadFilename('Episode 1', 'https://cdn.example.com/media/ep1.mkv?token=secret'))
      .toBe('Episode 1.mkv');
    expect(suggestDownloadFilename('Episode 1.mp4', 'https://cdn.example.com/media/ep1.mkv'))
      .toBe('Episode 1.mp4');
  });
});
