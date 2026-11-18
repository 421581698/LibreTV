import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('iPad cinema integration edges', () => {
  it('connects homepage route changes to the stable focus target after listener setup', () => {
    const contract = read('src/components/ipad-cinema/IpadCinemaContract.tsx');
    const header = read('src/components/home/V4HomepageHeader.tsx');
    expect(header).toContain('data-ipad-focus-id="region:primary-navigation:index:0"');
    expect(header).toContain('tabIndex={-1}');
    expect(contract).toContain("detail: { focusId: 'region:primary-navigation:index:0', reason: 'navigation' }");
    expect(contract.indexOf("document.addEventListener('ipad-cinema:focus-request', onFocusRequest)"))
      .toBeLessThan(contract.indexOf('    apply();'));
    expect(contract).toContain("route.kind === 'home' && activation !== 'inactive'");
    expect(contract).toContain('lastRouteRef.current !== null');
  });

  it('mounts a background-return notice without attempting autoplay', () => {
    const layout = read('src/app/layout.tsx');
    const notice = read('src/components/ipad-cinema/IpadCinemaResumeNotice.tsx');
    expect(layout).toContain("import { IpadCinemaResumeNotice } from '@/components/ipad-cinema/IpadCinemaResumeNotice';");
    expect(layout).toContain('<IpadCinemaResumeNotice />');
    expect(notice).toContain("detail?.kind !== 'app-background'");
    expect(notice).toContain("document.visibilityState === 'visible'");
    expect(notice).toContain('请轻点播放器的播放按钮继续');
    expect(notice).not.toContain('.play(');
    expect(notice).not.toContain('autoplay');
  });
});
