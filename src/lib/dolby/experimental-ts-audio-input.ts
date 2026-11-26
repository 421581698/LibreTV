import { Ec3TsPesExtractor } from './ec3-ts-pes';
import { timedEc3PesFrames } from './ec3-timed-pes';
import type { ExperimentalAudioSession } from './experimental-audio-session';

/** Explicitly supplied clear TS segment, verified audio PID and media origin.
 * No network requests, PID discovery, decryption or automatic activation.
 */
export class ExperimentalTsAudioInput {
  private readonly extractor: Ec3TsPesExtractor;
  private failed = false;
  constructor(pid: number, private readonly origin90k: number,
    private readonly session: Pick<ExperimentalAudioSession, 'push' | 'fail'>) {
    this.extractor = new Ec3TsPesExtractor(pid);
  }

  pushSegment(bytes: Uint8Array): boolean {
    if (this.failed) return false;
    try {
      if (!bytes.length || bytes.length % 188 !== 0 || bytes.length > 8 * 1024 * 1024) {
        throw new Error('Invalid TS segment size');
      }
      for (let offset = 0; offset < bytes.length; offset += 188) {
        const pes = this.extractor.push(bytes.subarray(offset, offset + 188));
        if (pes) this.feed(pes);
      }
      const tail = this.extractor.finish();
      if (tail) this.feed(tail);
      return true;
    } catch {
      this.failed = true;
      this.extractor.reset();
      this.session.fail();
      return false;
    }
  }

  private feed(pes: NonNullable<ReturnType<Ec3TsPesExtractor['finish']>>): void {
    for (const frame of timedEc3PesFrames(pes, this.origin90k)) {
      if (!this.session.push(frame.bytes, frame.ptsSamples)) throw new Error('Audio session rejected frame');
    }
  }
}
