import { describe, expect, it, vi } from 'vitest';
import { ExperimentalAudioSession, type ExperimentalAudioDecoder, type ExperimentalAudioOutput } from './experimental-audio-session';
import type { ExperimentalPcm } from './openjoc-experimental-decoder';

function fixture() {
  const media = { currentTime: 2, playbackRate: 1, paused: false, muted: false };
  const pcm: ExperimentalPcm = {
    pcm: new Float32Array([0.1, -0.1]), samples: 1, channels: 2,
    sampleRate: 48000, ptsSamples: 96000n,
  };
  const decoder = {
    push: vi.fn(() => 0), receive: vi.fn<() => ExperimentalPcm | null>()
      .mockReturnValueOnce(pcm).mockReturnValue(null),
    reset: vi.fn(), close: vi.fn(),
  };
  const output = { enqueue: vi.fn(() => 'schedule' as const), reset: vi.fn() };
  const session = new ExperimentalAudioSession(media);
  return { media, pcm, decoder, output, session };
}
const packet = new Uint8Array([1, 2, 3]);

describe('explicit experimental audio lifecycle', () => {
  it('does not mute native media before the first scheduled PCM', () => {
    const { media, decoder, output, session } = fixture();
    expect(media.muted).toBe(false);
    expect(session.push(packet, 96000n)).toBe(false);
    expect(session.arm(decoder, output)).toBe(true);
    expect(media.muted).toBe(false);
    expect(session.push(packet, 96000n)).toBe(true);
    expect(media.muted).toBe(true);
    expect(session.state).toBe('active');
    expect(output.enqueue).toHaveBeenCalledWith(expect.anything(), 2, 1);
  });

  it('refuses output while user-muted or paused', () => {
    const { media, decoder, output, session } = fixture();
    media.muted = true;
    expect(session.arm(decoder, output)).toBe(false);
    media.muted = false;
    media.paused = true;
    expect(session.arm(decoder, output)).toBe(false);
    expect(decoder.push).not.toHaveBeenCalled();
  });

  it.each(['onPause', 'onSeek', 'onRateChange', 'onTrackChange'] as const)(
    '%s stops old PCM before restoring native sound', (method) => {
      const { media, decoder, output, session } = fixture();
      expect(session.arm(decoder, output)).toBe(true);
      expect(session.push(packet, 96000n)).toBe(true);
      output.reset.mockImplementationOnce(() => { expect(media.muted).toBe(true); });
      session[method]();
      expect(output.reset).toHaveBeenCalledTimes(1);
      expect(decoder.reset).toHaveBeenCalledTimes(1);
      expect(media.muted).toBe(false);
      expect(session.state).toBe('armed');
    },
  );

  it('uses current video media clock and playback rate for new PCM after seek', () => {
    const { media, decoder, output, session, pcm } = fixture();
    session.arm(decoder, output);
    session.onSeek();
    media.currentTime = 14;
    media.playbackRate = 1.5;
    decoder.receive.mockReset().mockReturnValueOnce(pcm).mockReturnValue(null);
    expect(session.push(packet, 96000n)).toBe(true);
    expect(output.enqueue).toHaveBeenCalledWith(pcm, 14, 1.5);
  });

  it('cleans up old decoder/queue on source change and permits a new source', () => {
    const { media, decoder, output, session } = fixture();
    session.arm(decoder, output);
    session.push(packet, 96000n);
    session.onSourceChange();
    expect(output.reset).toHaveBeenCalledTimes(1);
    expect(decoder.close).toHaveBeenCalledTimes(1);
    expect(media.muted).toBe(false);
    expect(session.state).toBe('idle');
    expect(session.push(packet, 96000n)).toBe(false);
    const next = fixture();
    expect(session.arm(next.decoder, next.output)).toBe(true);
  });

  it('falls back safely when decoder fails; failed session cannot process more packets', () => {
    const { media, decoder, output, session } = fixture();
    session.arm(decoder, output);
    session.push(packet, 96000n);
    decoder.push.mockImplementationOnce(() => { throw new Error('JOC unavailable'); });
    expect(session.push(packet, 96000n)).toBe(false);
    expect(output.reset).toHaveBeenCalled();
    expect(media.muted).toBe(false);
    expect(decoder.close).toHaveBeenCalledTimes(1);
    expect(session.state).toBe('failed');
    expect(session.push(packet, 96000n)).toBe(false);
  });

  it('never unmutes normal native sound when Web Audio rejects a PCM frame', () => {
    const { media, decoder, output, session } = fixture();
    output.enqueue.mockReturnValueOnce('reset' as never);
    session.arm(decoder, output);
    expect(session.push(packet, 96000n)).toBe(false);
    expect(media.muted).toBe(false);
    expect(session.state).toBe('failed');
  });

  it('closes idempotently without replaying native or PCM audio', () => {
    const { media, decoder, output, session } = fixture();
    session.arm(decoder, output);
    session.push(packet, 96000n);
    session.close();
    session.close();
    expect(output.reset).toHaveBeenCalledTimes(1);
    expect(decoder.close).toHaveBeenCalledTimes(1);
    expect(media.muted).toBe(false);
    expect(session.state).toBe('closed');
    expect(session.arm(decoder, output)).toBe(false);
  });
});
