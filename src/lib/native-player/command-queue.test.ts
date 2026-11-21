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
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = queue.enqueue(() => gate);
    const second = queue.enqueue(() => 'should not run');
    // Attach the rejection assertion before releasing the first command so
    // Node does not report the intentionally rejected queued promise as
    // temporarily unhandled.
    const secondRejected = expect(second).rejects.toThrow('closed');
    queue.close();
    release();
    await first;
    await secondRejected;
    expect(queue.isClosed).toBe(true);
  });
});
