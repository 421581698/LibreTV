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
    expect(watch).toContain("const fallbackHref = '/ipad-edition';");
    expect(watch).toContain('watchPath={watchPath}');
    expect(switchSource).toContain("watchUrl.replace('/watch?', watchPath + '?')");
  });

  it('keeps the playback clock responsive and separate from throttled persistence', () => {
    expect(player).toContain('onClockUpdate?: (position: number, duration: number) => void;');
    expect(player).toContain('propsRef.current.onClockUpdate?.(art.currentTime, art.duration);');
    expect(player).toContain('propsRef.current.onClockUpdate?.(current, art.duration);');
    expect(player).toContain("art.on('video:loadedmetadata', syncPlaybackClock);");
    expect(player).toContain("art.on('video:durationchange', syncPlaybackClock);");
    expect(player).toContain('if (now - lastSave > 5000)');
    expect(watch).toContain('onClockUpdate={(position, duration) => setWatchClock({ position, duration })}');
    expect(watch).toContain('onTimeUpdate={handleProgress}');
    expect(watch).toContain('onRequestSwitchSource={(reason) => {');
    expect(watch).toContain('}, [sourceKey, vodId, indexParam, directUrl]);');
    expect(watch).toContain('setSwitchOpen(true);');
  });

  it('previews range scrubbing and commits a single seek on pointer/key release', () => {
    expect(watch).toContain('onChange={(event) => setSeekDraft(Number(event.target.value))}');
    expect(watch).toContain('onPointerUp={(event) => commitSeek(Number(event.currentTarget.value))}');
    expect(watch).toContain('onKeyUp={(event) => commitSeek(Number(event.currentTarget.value))}');
  });

  it('cancels pending auto-next when the source session changes, not only when the episode index changes', () => {
    expect(watch).toContain('}, [sourceKey, vodId, directUrl, suppliedSourceUrl, currentUrl, currentIndex, cancelAutoNext]);');
    expect(watch).toContain('if (switchOpen) cancelAutoNext();');
  });

  it('does not route episode hotkeys while a modal or editable field owns keyboard focus', () => {
    expect(watch).toContain('if (!e.altKey || switchOpen || skipPanelOpen) return;');
    expect(watch).toContain("target.closest('input, textarea, select, [contenteditable=\"true\"], [role=\"dialog\"]')");
  });

  it('uses the same native-fullscreen fallback helper as the player control', () => {
    expect(watch).toContain('requestNativeFullscreenWithFallback(');
    expect(watch).toContain('playerApiRef.current?.isFullscreen()');
    expect(watch).toContain('playerApiRef.current.exitFullscreen();');
    expect(watch).toContain('playerApiRef.current.enterFullscreen()');
    expect(player).toContain('enterFullscreen: () => {');
    expect(player).toContain('current.fullscreenWeb = true');
    expect(player).toContain('isFullscreen: () => {');
    expect(player).toContain('exitFullscreen: () => {');
    expect(player).toContain("[role=\"dialog\"], [role=\"listbox\"]");
    expect(player).toContain("case 'f': case 'F': {");
    expect(player).toContain('requestNativeFullscreenWithFallback(');
    expect(player).toContain('let activeTouchId: number | null = null;');
    expect(player).toContain('touch.identifier === activeTouchId');
    expect(player).toContain('if (isLongPress && art.video) art.video.playbackRate = originalRate;');
    expect(player).toContain('if (art.fullscreenWeb) {');
    expect(player).toContain('art.fullscreenWeb = false;');
    expect(player).toContain('nativeVideo.webkitExitFullscreen();');
  });
});
