
import { describe, expect, it, vi } from 'vitest';
import { inspectSpatialAudioCapabilities, isAudioSourceUrlOriginSafe, isMediaElementAudioOriginSafe, planSpatialAudio, SpatialAudioEngine } from './spatial-audio';

function createMockAudioContext() {
  const contextRef: { current?: Record<string, unknown> } = {};
  const state = { value: 'suspended' as AudioContextState };
  const makeNode = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const createPanner = () => {
    const panner = Object.assign(makeNode(), {
      panningModel: 'equalpower',
      distanceModel: 'inverse',
      refDistance: 1,
      maxDistance: 1,
      rolloffFactor: 1,
      positionX: { setValueAtTime: vi.fn() },
      positionY: { setValueAtTime: vi.fn() },
      positionZ: { setValueAtTime: vi.fn() },
      setPosition: vi.fn(),
      context: null as unknown,
    });
    panner.context = contextRef.current;
    return panner;
  };
  const context: Record<string, unknown> = {
    get state() { return state.value; },
    currentTime: 0,
    destination: { maxChannelCount: 2 },
    outputLatency: 0.02,
    createPanner: vi.fn(createPanner),
    createMediaElementSource: vi.fn(makeNode),
    createGain: vi.fn(() => Object.assign(makeNode(), {
      gain: { value: 1, setTargetAtTime: vi.fn() },
    })),
    createChannelSplitter: vi.fn(() => Object.assign(makeNode(), { channelInterpretation: 'speakers' })),
    resume: vi.fn(async () => { state.value = 'running'; }),
    close: vi.fn(async () => { state.value = 'closed'; }),
  };
  contextRef.current = context;
  return context as unknown as AudioContext;
}

describe('planSpatialAudio', () => {
  it('keeps the original route when spatial processing is off', () => {
    expect(planSpatialAudio('off', 6, true).route).toBe('bypass');
  });

  it('requires an explicitly verified 5.1 speaker layout before binaural routing', () => {
    expect(planSpatialAudio('headphone-surround', 6, true).route).toBe('bypass');
    const plan = planSpatialAudio('headphone-surround', 6, true, '5.1');
    expect(plan.route).toBe('surround-5.1-binaural');
    expect(plan.label).toContain('5.1');
  });

  it('labels stereo fallback honestly instead of claiming surround', () => {
    const plan = planSpatialAudio('headphone-surround', 2, true);
    expect(plan.route).toBe('stereo-virtualization');
    expect(plan.reason).toContain('不会伪称为真实 5.1 或 Atmos');
  });

  it('bypasses unknown and unsupported channel layouts', () => {
    expect(planSpatialAudio('headphone-stereo', 0, true).route).toBe('bypass');
    expect(planSpatialAudio('headphone-surround', 6, true, 'unknown').reason).toContain('未验证扬声器顺序');
    expect(planSpatialAudio('headphone-surround', 0, true).route).toBe('bypass');
    expect(planSpatialAudio('headphone-surround', 8, true).route).toBe('bypass');
    expect(planSpatialAudio('headphone-stereo', 2, false).route).toBe('bypass');
  });

  it('allows stereo headphone virtualization for two-channel input', () => {
    expect(planSpatialAudio('headphone-stereo', 2, true).route).toBe('stereo-virtualization');
  });
});

describe('inspectSpatialAudioCapabilities', () => {
  it('returns a safe unavailable profile when no AudioContext exists', () => {
    expect(inspectSpatialAudioCapabilities(null)).toEqual({
      webAudio: false,
      mediaElementSource: false,
      hrtfPanner: false,
      outputMaxChannels: null,
      outputLatencyMs: null,
    });
  });
});

describe('isMediaElementAudioOriginSafe', () => {
  const media = (currentSrc: string, crossOrigin: string | null = null) => ({
    currentSrc,
    src: currentSrc,
    crossOrigin,
  }) as unknown as HTMLMediaElement;

  it('allows same-origin and MediaSource blob URLs', () => {
    expect(isMediaElementAudioOriginSafe(media('/media/movie.mp4'), 'https://libretv.example')).toBe(true);
    expect(isMediaElementAudioOriginSafe(media('blob:https://libretv.example/abc'), 'https://libretv.example')).toBe(true);
  });

  it('rejects blob URLs created by a different origin', () => {
    expect(isMediaElementAudioOriginSafe(media('blob:https://evil.example/abc'), 'https://libretv.example')).toBe(false);
  });

  it('rejects direct cross-origin media without an explicit CORS mode', () => {
    expect(isMediaElementAudioOriginSafe(media('https://cdn.example/movie.mp4'), 'https://libretv.example')).toBe(false);
  });

  it('allows cross-origin media only when the element is configured for CORS', () => {
    expect(isMediaElementAudioOriginSafe(media('https://cdn.example/movie.mp4', 'anonymous'), 'https://libretv.example')).toBe(true);
    expect(isMediaElementAudioOriginSafe(media('https://cdn.example/movie.mp4', 'use-credentials'), 'https://libretv.example')).toBe(true);
  });
});

describe('isAudioSourceUrlOriginSafe', () => {
  it('checks a prospective source URL before it is assigned to a media element', () => {
    expect(isAudioSourceUrlOriginSafe('blob:https://libretv.example/abc', 'https://libretv.example')).toBe(true);
    expect(isAudioSourceUrlOriginSafe('https://cdn.example/movie.mp4', 'https://libretv.example')).toBe(false);
    expect(isAudioSourceUrlOriginSafe('https://cdn.example/movie.mp4', 'https://libretv.example', 'anonymous')).toBe(true);
  });
});

describe('SpatialAudioEngine lifecycle', () => {
  const media = () => ({
    currentSrc: 'https://libretv.example/movie.mp4',
    src: 'https://libretv.example/movie.mp4',
    crossOrigin: null,
  }) as unknown as HTMLMediaElement;

  it('creates one source node per media element and resumes only on explicit invocation', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://libretv.example' } });
    const element = media();
    const context = createMockAudioContext();
    const factory = vi.fn(() => context);
    const engine = SpatialAudioEngine.attach(element, { inputChannels: 2 }, factory);
    expect(SpatialAudioEngine.attach(element, { inputChannels: 2 }, factory)).toBe(engine);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(context.createMediaElementSource).toHaveBeenCalledTimes(1);
    expect(context.state).toBe('suspended');
    await engine.resumeFromUserGesture();
    expect(context.state).toBe('running');
    expect(engine.setMode('headphone-stereo').route).toBe('stereo-virtualization');
    engine.disable();
    expect(engine.status.route).toBe('bypass');
    vi.unstubAllGlobals();
  });

  it('rejects reattachment after final element teardown', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://libretv.example' } });
    const element = media();
    const context = createMockAudioContext();
    const engine = SpatialAudioEngine.attach(element, { inputChannels: 2 }, () => context);
    await engine.destroyAfterMediaElementRemoval();
    expect(engine.isDestroyed).toBe(true);
    expect(context.state).toBe('closed');
    expect(() => SpatialAudioEngine.attach(element, { inputChannels: 2 }, createMockAudioContext)).toThrow(/生命周期已结束|不能再次创建/);
    vi.unstubAllGlobals();
  });

  it('closes the context if source graph construction fails', () => {
    vi.stubGlobal('window', { location: { origin: 'https://libretv.example' } });
    const context = createMockAudioContext();
    (context.createGain as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('gain unavailable'); });
    expect(() => SpatialAudioEngine.attach(media(), { inputChannels: 2 }, () => context)).toThrow('gain unavailable');
    expect(context.close).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
