import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpatialMediaSession, verifySpatialMediaCors, type SpatialEngineHandle } from './spatial-media-session';

function makeVideo() {
  const events = new Map<string, Set<EventListener>>();
  const video = {
    currentTime: 12,
    duration: 120,
    paused: true,
    muted: false,
    volume: 0.7,
    playbackRate: 1,
    error: null,
    currentSrc: 'https://media.example/movie.mp4',
    src: '',
    crossOrigin: null as string | null,
    preload: '',
    playsInline: false,
    controls: false,
    style: {} as Record<string, string>,
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    load: vi.fn(),
    pause: vi.fn(() => { video.paused = true; }),
    play: vi.fn(async () => { video.paused = false; }),
    remove: vi.fn(),
    addEventListener: vi.fn((name: string, listener: EventListener) => {
      const set = events.get(name) ?? new Set<EventListener>();
      set.add(listener);
      events.set(name, set);
    }),
    removeEventListener: vi.fn((name: string, listener: EventListener) => events.get(name)?.delete(listener)),
    dispatch: (name: string) => events.get(name)?.forEach((listener) => listener(new Event(name))),
  };
  return video as unknown as HTMLVideoElement & { dispatch: (name: string) => void };
}

function setPaused(video: HTMLVideoElement, paused: boolean) {
  Object.defineProperty(video, 'paused', { configurable: true, value: paused });
}

function makeHost() {
  return { appendChild: vi.fn(), } as unknown as HTMLElement;
}

function makeEngine() {
  const engine: SpatialEngineHandle = {
    resumeFromUserGesture: vi.fn(async () => undefined),
    setMode: vi.fn(() => ({ route: 'bypass', label: '原始音轨', reason: '声道布局未知，保持旁路' })),
    destroyAfterMediaElementRemoval: vi.fn(async () => undefined),
  };
  return engine;
}

afterEach(() => vi.unstubAllGlobals());

describe('SpatialMediaSession preparation', () => {
  it('rejects HLS without touching the native media element', async () => {
    const native = makeVideo();
    await expect(SpatialMediaSession.prepare({
      nativeVideo: native, host: makeHost(), sourceUrl: 'https://media.example/list.m3u8',
      sourceKind: 'hls', verifyCors: vi.fn(async () => true),
    })).rejects.toThrow(/Safari 原生 HLS/);
    expect(native.muted).toBe(false);
  });

  it('rejects CORS failures before allocating a spatial media element', async () => {
    const native = makeVideo();
    const createMediaElement = vi.fn(makeVideo);
    await expect(SpatialMediaSession.prepare({
      nativeVideo: native, host: makeHost(), sourceUrl: 'https://cdn.example/movie.mp4',
      sourceKind: 'mp4', verifyCors: vi.fn(async () => false), createMediaElement,
    })).rejects.toThrow(/CORS/);
    expect(createMediaElement).not.toHaveBeenCalled();
    expect(native.muted).toBe(false);
  });

  it('sets CORS mode before source assignment and uses a distinct media element', async () => {
    const native = makeVideo();
    const spatial = makeVideo();
    const host = makeHost();
    const session = await SpatialMediaSession.prepare({
      nativeVideo: native, host, sourceUrl: 'https://cdn.example/movie.mp4',
      sourceKind: 'mp4', verifyCors: vi.fn(async () => true),
      createMediaElement: () => spatial,
      createEngine: () => makeEngine(),
    });
    expect(spatial.crossOrigin).toBe('anonymous');
    expect(spatial.src).toBe('https://cdn.example/movie.mp4');
    expect(spatial).not.toBe(native);
    expect(host.appendChild).toHaveBeenCalledWith(spatial);
    expect(native.muted).toBe(false);
    expect(session.snapshot.state).toBe('prepared');
  });
});

describe('SpatialMediaSession activation and fallback', () => {
  it('activates only on explicit method call and preserves native fallback element', async () => {
    const native = makeVideo();
    const spatial = makeVideo();
    const engine = makeEngine();
    const session = await SpatialMediaSession.prepare({
      nativeVideo: native, host: makeHost(), sourceUrl: 'https://media.example/movie.mp4',
      sourceKind: 'mp4', verifyCors: vi.fn(async () => true),
      createMediaElement: () => spatial, createEngine: () => engine,
    });
    expect(native.muted).toBe(false);
    expect(engine.resumeFromUserGesture).not.toHaveBeenCalled();
    const result = await session.activateFromUserGesture();
    expect(result.state).toBe('active');
    expect(result.route).toBe('bypass');
    expect(engine.resumeFromUserGesture).toHaveBeenCalledTimes(1);
    expect(native.muted).toBe(true);
    expect(engine.setMode).toHaveBeenCalledWith('headphone-stereo');
  });

  it('restores native audio and position when disabled', async () => {
    const native = makeVideo();
    const spatial = makeVideo();
    const engine = makeEngine();
    const session = await SpatialMediaSession.prepare({
      nativeVideo: native, host: makeHost(), sourceUrl: 'https://media.example/movie.mp4',
      sourceKind: 'mp4', verifyCors: vi.fn(async () => true),
      createMediaElement: () => spatial, createEngine: () => engine,
    });
    await session.activateFromUserGesture();
    spatial.currentTime = 28;
    await session.dispose();
    expect(native.muted).toBe(false);
    expect(native.currentTime).toBe(28);
    expect(spatial.remove).toHaveBeenCalledTimes(1);
    expect(engine.destroyAfterMediaElementRemoval).toHaveBeenCalledTimes(1);
    expect(session.snapshot.state).toBe('disposed');
  });

  it('mirrors native pause, resume, seek, rate and volume without replacing the native element', async () => {
    const native = makeVideo();
    setPaused(native, false);
    const spatial = makeVideo();
    const session = await SpatialMediaSession.prepare({
      nativeVideo: native, host: makeHost(), sourceUrl: 'https://media.example/movie.mp4',
      sourceKind: 'mp4', verifyCors: vi.fn(async () => true),
      createMediaElement: () => spatial, createEngine: () => makeEngine(),
    });
    await session.activateFromUserGesture();
    setPaused(native, true);
    native.dispatch('pause');
    expect(spatial.pause).toHaveBeenCalled();
    setPaused(native, false);
    native.dispatch('play');
    expect(spatial.play).toHaveBeenCalled();
    native.currentTime = 41;
    native.dispatch('seeked');
    expect(spatial.currentTime).toBe(41);
    native.playbackRate = 1.5;
    native.dispatch('ratechange');
    expect(spatial.playbackRate).toBe(1.5);
    native.volume = 0.35;
    native.dispatch('volumechange');
    expect(spatial.volume).toBe(0.35);
    await session.dispose();
  });

  it('returns to native playback when the native mute control is used', async () => {
    const native = makeVideo();
    const spatial = makeVideo();
    const session = await SpatialMediaSession.prepare({
      nativeVideo: native, host: makeHost(), sourceUrl: 'https://media.example/movie.mp4',
      sourceKind: 'mp4', verifyCors: vi.fn(async () => true),
      createMediaElement: () => spatial, createEngine: () => makeEngine(),
    });
    await session.activateFromUserGesture();
    native.muted = false;
    native.dispatch('volumechange');
    await Promise.resolve();
    await Promise.resolve();
    expect(native.muted).toBe(false);
    expect(session.snapshot.state).toBe('fallback');
  });

  it('makes dispose idempotent', async () => {
    const native = makeVideo();
    const spatial = makeVideo();
    const engine = makeEngine();
    const session = await SpatialMediaSession.prepare({
      nativeVideo: native, host: makeHost(), sourceUrl: 'https://media.example/movie.mp4',
      sourceKind: 'mp4', verifyCors: vi.fn(async () => true),
      createMediaElement: () => spatial, createEngine: () => engine,
    });
    await session.activateFromUserGesture();
    await session.dispose();
    await session.dispose();
    expect(spatial.remove).toHaveBeenCalledTimes(1);
    expect(engine.destroyAfterMediaElementRemoval).toHaveBeenCalledTimes(1);
  });

  it('falls back natively on spatial media errors', async () => {
    const native = makeVideo();
    const spatial = makeVideo();
    const engine = makeEngine();
    const session = await SpatialMediaSession.prepare({
      nativeVideo: native, host: makeHost(), sourceUrl: 'https://media.example/movie.mp4',
      sourceKind: 'mp4', verifyCors: vi.fn(async () => true),
      createMediaElement: () => spatial, createEngine: () => engine,
    });
    await session.activateFromUserGesture();
    native.currentTime = 55;
    spatial.currentTime = 0;
    spatial.dispatch('error');
    await Promise.resolve();
    await Promise.resolve();
    expect(native.muted).toBe(false);
    expect(native.currentTime).toBe(55);
    expect(session.snapshot.state).toBe('fallback');
  });

  it('falls back if user-gesture activation or playback is rejected', async () => {
    const native = makeVideo();
    const spatial = makeVideo();
    const engine = makeEngine();
    vi.mocked(engine.resumeFromUserGesture).mockRejectedValueOnce(new Error('gesture required'));
    const session = await SpatialMediaSession.prepare({
      nativeVideo: native, host: makeHost(), sourceUrl: 'https://media.example/movie.mp4',
      sourceKind: 'mp4', verifyCors: vi.fn(async () => true),
      createMediaElement: () => spatial, createEngine: () => engine,
    });
    await expect(session.activateFromUserGesture()).rejects.toThrow('gesture required');
    expect(native.muted).toBe(false);
    expect(session.snapshot.state).toBe('fallback');
  });
});

describe('verifySpatialMediaCors', () => {
  it('rejects when fetch cannot confirm a readable CORS response', async () => {
    vi.stubGlobal('window', { location: { href: 'https://app.example', origin: 'https://app.example' } });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('CORS'); }));
    expect(await verifySpatialMediaCors('https://cdn.example/movie.mp4')).toBe(false);
  });
});
