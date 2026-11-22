import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Friday Liquid Glass Phase 3 route contracts', () => {
  it('uses the Friday card surface for homepage poster actions without replacing poster artwork', () => {
    const home = read('src/components/home/V4HomepageContent.tsx');
    expect(home).toContain('<GlassCard as="button"');
    expect(home).toContain('<SmartImage');
  });

  it('integrates personal space and settings panels while preserving their native landmarks', () => {
    const spatial = read('src/components/home/V4SpatialScreen.tsx');
    expect(spatial).toContain('<GlassBar as="header" className="v52-me-header">');
    expect(spatial).toContain('<GlassPanel as="section" className="v52-me-section v52-me-continue"');
    expect(spatial).toContain('<GlassPanel as="section" className="card p-4 sm:p-5"');
  });

  it('uses Friday controls on the detail hero and glass cards for episode actions', () => {
    const detail = read('src/components/movie-detail-page.tsx');
    expect(detail).toContain('<GlassControl as="button"');
    expect(detail).toContain('<GlassCard');
    expect(detail).toContain('movie-episode-card');
  });

  it('keeps live route chrome separate from the live video frame', () => {
    const live = read('src/app/live/page.tsx');
    expect(live).toMatch(/<GlassPanel\\s+as="aside"/);
    expect(live).toContain('<GlassPanel as="section" className="glass-panel p-3 mt-3">');
    expect(live).toContain('<div className="aspect-video bg-black rounded-lg overflow-hidden">');
  });

  it('wraps the remaining settings index groups and detail subpanels in Friday panels', () => {
    const settings = read('src/components/source-manager.tsx');
    expect(settings).toContain('<GlassPanel className="overflow-hidden rounded-2xl border border-line bg-card divide-y divide-line">');
    expect(settings).toContain('<GlassPanel className="rounded-2xl"><VodSourcesPanel /></GlassPanel>');
    expect(settings).toContain('<GlassPanel className="rounded-2xl"><ResourceCollectorPanel /></GlassPanel>');
  });

  it('does not apply Friday glass or backdrop blur to the ArtPlayer surface', () => {
    const player = read('src/components/player-shell.tsx');
    expect(player).not.toMatch(/friday-glass|backdrop-filter/i);
    expect(player).toContain('<div ref={containerRef} className="w-full h-full"');
  });
});
