import type Hls from 'hls.js';

export type JocHlsFragmentKind = 'init' | 'media';

export interface JocHlsFragmentDescriptor {
  readonly kind: JocHlsFragmentKind;
  readonly trackType: 'main' | 'audio';
  readonly level: number;
  readonly sequence: number | string;
  readonly bytes: Uint8Array;
}

export interface JocHlsFragmentTapOptions {
  readonly maxFragmentBytes?: number;
  /** Must bind callbacks to the current HLS instance and playback generation. */
  readonly isCurrent: () => boolean;
  readonly onFragment: (fragment: JocHlsFragmentDescriptor) => void;
  readonly onRejected?: (reason: string) => void;
}

export interface HlsFragmentLoadedLike {
  readonly frag?: {
    readonly type?: string;
    readonly level?: number;
    readonly sn?: number | string;
  };
  readonly payload?: ArrayBuffer | Uint8Array;
}

const DEFAULT_MAX_FRAGMENT_BYTES = 16 * 1024 * 1024;

function toBytes(payload: ArrayBuffer | Uint8Array): Uint8Array {
  return payload instanceof Uint8Array ? payload : new Uint8Array(payload);
}

/**
 * Read-only hls.js FRAG_LOADED adapter for the future software-JOC lane.
 *
 * It observes only complete main/audio init and media fragments. It never
 * changes loader ownership, appends to MSE, modifies payload bytes, or changes
 * the active audio output. The owner must bind isCurrent to its HLS instance
 * and playback generation and must unregister the listener on teardown.
 */
export class HlsJocFragmentTap {
  private readonly maxFragmentBytes: number;
  private disposed = false;

  constructor(private readonly options: JocHlsFragmentTapOptions) {
    this.maxFragmentBytes = options.maxFragmentBytes ?? DEFAULT_MAX_FRAGMENT_BYTES;
    if (!Number.isInteger(this.maxFragmentBytes) || this.maxFragmentBytes < 1) {
      throw new Error('HLS JOC fragment byte limit must be a positive integer.');
    }
  }

  handle = (_event: string, data: HlsFragmentLoadedLike): void => {
    if (this.disposed || !this.options.isCurrent()) return;
    const frag = data.frag;
    if (!frag || (frag.type !== 'main' && frag.type !== 'audio')) return;
    if (frag.sn === undefined || frag.level === undefined || !Number.isInteger(frag.level) || frag.level < -1) {
      this.options.onRejected?.('Fragment metadata is incomplete.');
      return;
    }
    const payload = data.payload;
    if (!payload) {
      this.options.onRejected?.('Fragment payload is unavailable.');
      return;
    }
    const bytes = toBytes(payload);
    if (bytes.byteLength === 0 || bytes.byteLength > this.maxFragmentBytes) {
      this.options.onRejected?.('Fragment payload is empty or exceeds the configured byte limit.');
      return;
    }
    const kind: JocHlsFragmentKind = frag.sn === 'initSegment' ? 'init' : 'media';
    this.options.onFragment({
      kind,
      trackType: frag.type,
      level: frag.level,
      sequence: frag.sn,
      // Copy the view so downstream parsing cannot observe buffer reuse/mutation
      // by a future loader implementation.
      bytes: bytes.slice(),
    });
  };

  dispose(): void {
    this.disposed = true;
  }
}

/** Type-only anchor: the observer is attached through hls.on(Hls.Events.FRAG_LOADED, tap.handle). */
export type JocHlsInstance = Pick<Hls, 'on' | 'off'>;
