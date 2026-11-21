import { describe, expect, it } from 'vitest';
import { PlaybackCommandQueue } from './command-queue';

describe('PlaybackCommandQueue', () => {
  it('runs commands in order and continues after a rejection', async () => {
    const queue = new PlaybackCommandQueue();
    const order: number[] = [];
    const first = queue.enqueue(async () => { await Promise.resolve(); order.push(1); });
    const failed = queue.enqueue(async () => { order.push(2); throw new Error('expected'); });
    const third = queue.enqueue(() => { order.push(3); return 'ok'; });
    await first;
    await expect(failed).rejects.toThrow('expected');
    await expect(third).resolves.toBe('ok');
    expect(order).toEqual([1, 2, 3]);
    expect(queue.size).toBe(0);
  });

  it('rejects commands after close and skips queued commands not yet started', async () => {
    const queue = new PlaybackCommandQueue();
    let release!: () => void;
    let markStarted!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const first = queue.enqueue(() => {
      markStarted();
      return gate;
    });
    await started;
    const second = queue.enqueue(() => 'should not run');
    // Attach a rejection handler immediately so a deliberate cancellation cannot
    // create an unhandled-rejection window while the active command is gated.
    const secondOutcome = second.then(
      () => null,
      error => error,
    );
    queue.close();
    release();
    await first;
    const secondError = await secondOutcome;
    expect(secondError).toBeInstanceOf(Error);
    expect((secondError as Error).message).toContain('closed');
    expect(queue.isClosed).toBe(true);
  });
});
