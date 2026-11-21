import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('iPad Edition playback route contract', () => {
  const wrapper = read('src/app/ipad-edition/watch/page.tsx');
  const watch = read('src/app/watch/page.tsx');
  const switchSource = read('src/components/switch-source.tsx');
  const continueWatching = read('src/components/ipad-edition/IpadEditionContinueWatching.tsx');

  it('mounts the shared playback engine with the dedicated iPad watch route', () => {
    expect(wrapper).toContain('<WatchPage watchPath="/ipad-edition/watch" />');
    expect(watch).toContain("watchPath = '/watch'");
    expect(watch).toContain('router.replace(`${watchPath}?${sp.toString()}`, { scroll: false });');
  });

  it('keeps episode selection, previous/next and auto-next on the current edition route', () => {
    expect(watch).toContain('const goEpisode = useCallback(');
    expect(watch).toContain('router.replace(`${watchPath}?${sp.toString()}`, { scroll: false });');
    expect(watch).not.toContain('router.replace(`/watch?${sp.toString()}`');
  });

  it('keeps source switching and player error/close fallbacks inside iPad Edition', () => {
    expect(watch).toContain('watchPath={watchPath}');
    expect(watch).toContain("const fallbackHref = watchPath === '/ipad-edition/watch' ? '/ipad-edition' : '/';");
    expect(switchSource).toContain("watchPath = '/watch'");
    expect(switchSource).toContain("watchUrl.replace('/watch?', watchPath + '?')");
  });

  it('opens continue-watching entries on the dedicated iPad watch route', () => {
    expect(continueWatching).toContain(".replace('/watch?', '/ipad-edition/watch?')");
  });
});
