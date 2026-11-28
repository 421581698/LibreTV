import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('iPad poster complete coverage / no SDR filters', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/app/ipad-edition/poster-engine.css'), 'utf8');
  it('fills the image frame without stretching', () => {
    expect(css).toContain('.ipad-edition .poster-engine__image{display:block;width:100%;height:100%;object-fit:cover;');
    expect(css).toContain('.ipad-edition .poster-engine--poster{aspect-ratio:2/3}');
    expect(css).toContain('.ipad-edition .poster-engine--continue{aspect-ratio:16/9}');
  });
  it('retains homepage full-coverage selectors and disables filters', () => {
    expect(css).toContain('> img.poster-engine__image { display:block; inset:0; width:100%; height:100%; object-fit:cover; opacity:1; filter:none; }');
  });
  it('permits native HDR when the browser supports dynamic-range-limit', () => {
    expect(css).toContain('@supports (dynamic-range-limit: no-limit)');
    expect(css).toContain('dynamic-range-limit:no-limit;');
  });
});
