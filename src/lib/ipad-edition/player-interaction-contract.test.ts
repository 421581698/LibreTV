import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('iPad Edition playback interaction contract', () => {
  const watch = read('src/components/ipad-edition/IpadEditionWatchPlayer.tsx');
  const player = read('src/components/player-shell.tsx');
  const switchSource = read('src/components/switch-source.tsx');
  const wrapper = read('src/app/ipad-edition/watch/page.tsx');

  it('keeps every playback route transition inside the iPad Edition route', () => {
    expect(wrapper).toContain('<IpadEditionWatchPlayer />');
    expect(watch).toContain("const watchPath = '/ipad-edition/watch' as const;");
    expect(watch).toContain('router.replace(`${watchPath}?${sp.toString()}`, { scroll: false });');
    expect(watch).toContain("const fallbackHref = watchPath === '/ipad-edition/watch' ? '/ipad-edition' : '/';");
    expect(watch).toContain('watchPath={watchPath}');
    expect(switchSource).toContain("watchUrl.replace('/watch?', watchPath + '?')");
  });

  it('keeps the playback clock responsive and separate from throttled persistence', () => {
    expect(player).toContain('onClockUpdate?: (position: number, duration: number) => void;');
    expect(player).toContain('propsRef.current.onClockUpdate?.(art.currentTime, art.duration);');
    expect(player).toContain('propsRef.current.onClockUpdate?.(current, art.duration);');
    expect(player).toContain('if (now - lastSave > 5000)');
    expect(watch).toContain('onClockUpdate={(position, duration) => setWatchClock({ position, duration })}');
    expect(watch).toContain('onTimeUpdate={handleProgress}');
    expect(watch).toContain('onRequestSwitchSource={(reason) => {');
    expect(watch).toContain('setSwitchOpen(true);');
  });

  it('uses the same native-fullscreen fallback helper as the player control', () => {
    expect(watch).toContain('requestNativeFullscreenWithFallback(');
    expect(watch).toContain('playerApiRef.current.enterFullscreen()');
    expect(player).toContain('enterFullscreen: () => {');
    expect(player).toContain('current.fullscreenWeb = true');
  });
});
