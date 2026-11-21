import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('iPhone playback interaction contract', () => {
  const home = read('src/app/page.tsx');
  const registry = read('src/components/home/RegistryInlinePlayer.tsx');
  const watch = read('src/app/watch/page.tsx');
  const player = read('src/components/player-shell.tsx');

  it('tests the actual homepage inline player rather than the unused legacy HomeInlinePlayer', () => {
    expect(home).toContain("import { RegistryInlinePlayer } from '@/components/home/RegistryInlinePlayer';");
    expect(home).toContain('<RegistryInlinePlayer resource={registryPlayItem}');
    expect(registry).toContain('role="dialog"');
    expect(registry).toContain('onCloseRef.current()');
    expect(registry).toContain("if (event.key === 'Escape')");
    expect(registry).toContain("if (event.key !== 'Tab') return;");
    expect(registry).toContain("document.body.style.overflow = 'hidden';");
    expect(registry).toContain('closeButtonRef.current?.focus({ preventScroll: true });');
    expect(registry).toContain('previousFocus.focus({ preventScroll: true });');
    expect(registry).toContain('element.getClientRects().length > 0');
  });

  it('keeps playback clock rendering responsive without increasing progress persistence frequency', () => {
    expect(player).toContain('onClockUpdate?: (position: number, duration: number) => void;');
    expect(player).toContain('propsRef.current.onClockUpdate?.(art.currentTime, art.duration);');
    expect(player).toContain('propsRef.current.onClockUpdate?.(current, art.duration);');
    expect(player).toContain("art.on('video:loadedmetadata', syncPlaybackClock);");
    expect(player).toContain("art.on('video:durationchange', syncPlaybackClock);");
    expect(player).toContain("art.on('video:loadedmetadata', syncPlaybackClock);");
    expect(player).toContain("art.on('video:durationchange', syncPlaybackClock);");
    expect(player).toContain('if (now - lastSave > 5000)');
    expect(watch).toContain('onClockUpdate={(position, duration) => setWatchClock({ position, duration })}');
    expect(watch).toContain('onTimeUpdate={handleProgress}');
    expect(watch).toContain('onRequestSwitchSource={(reason) => {');
    expect(watch).toContain('setSwitchOpen(true);');
  });

  it('cancels pending auto-next when the source session changes, not only when the episode index changes', () => {
    expect(watch).toContain('}, [sourceKey, vodId, directUrl, suppliedSourceUrl, currentUrl, currentIndex, cancelAutoNext]);');
    expect(watch).toContain('if (switchOpen) cancelAutoNext();');
  });

  it('does not route episode hotkeys while a modal or editable field owns keyboard focus', () => {
    expect(watch).toContain('if (!e.altKey || switchOpen || skipPanelOpen) return;');
    expect(watch).toContain("target.closest('input, textarea, select, [contenteditable=\"true\"], [role=\"dialog\"]')");
  });

  it('uses one tested native-fullscreen fallback path for the watch-page fullscreen control', () => {
    expect(watch).toContain("import { requestNativeFullscreenWithFallback, type NativeFullscreenVideo } from '@/lib/player-fullscreen';");
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
