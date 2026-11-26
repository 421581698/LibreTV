import { discoverEc3Pid } from './ec3-psi';
import { ExperimentalTsAudioInput } from './experimental-ts-audio-input';
import type { ExperimentalAudioSession } from './experimental-audio-session';

/** Generation-scoped input for explicitly authorized clear TS fragments.
 * The caller owns HLS event registration and timeline origin verification.
 */
export class ExperimentalHlsAudioInput {
  private generation = 0;
  private seen = new Set<string>();
  private input: ExperimentalTsAudioInput | null = null;
  private pid: number | null = null;
  private failed = false;
  constructor(private readonly session: Pick<ExperimentalAudioSession, 'push' | 'fail' | 'onSourceChange'>) {}
  begin(): number {
    this.generation++;
    this.seen.clear();
    this.input = null;
    this.pid = null;
    this.origin = null;
    this.failed = false;
    this.session.onSourceChange();
    return this.generation;
  }
  push(generation: number, identity: string, bytes: Uint8Array, origin90k: number): boolean {
    if (generation !== this.generation || this.failed) return false;
    if (this.seen.has(identity)) return true;
    try {
      if (!identity || identity.length > 512 || this.seen.size >= 8192) throw new Error('Fragment identity limit');
      const discovered = discoverEc3Pid(bytes);
      if (discovered !== null && this.pid !== null && discovered !== this.pid) throw new Error('Changed audio PID');
      // Subsequent TS segments need not repeat their PAT/PMT: reuse only the
      // PID established from CRC-valid PSI in this exact playback generation.
      const pid = discovered ?? this.pid;
      if (pid === null) throw new Error('EC-3 PID not established');
      let hasAudioPackets = false;
      for (let i = 0; i < bytes.length; i += 188) {
        if ((((bytes[i + 1] & 31) << 8) | bytes[i + 2]) === pid) {
          hasAudioPackets = true;
          break;
        }
      }
      if (!hasAudioPackets) throw new Error('No EC-3 audio TS packets');
      if (!this.input) {
        this.pid = pid;
        this.input = new ExperimentalTsAudioInput(pid, origin90k, this.session);
        this.origin = origin90k;
      }
      if (origin90k !== this.origin) throw new Error('Changed media timeline');
      if (!this.input.pushSegment(bytes)) { this.failed = true; return false; }
      this.seen.add(identity);
      return true;
    } catch {
      this.failed = true;
      this.session.fail();
      return false;
    }
  }
  private origin: number | null = null;
}
