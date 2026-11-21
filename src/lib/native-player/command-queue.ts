/** Serializes stateful backend commands without letting one rejection poison the queue. */
export class PlaybackCommandQueue {
  private tail: Promise<void> = Promise.resolve();
  private closed = false;
  private pending = 0;

  get size(): number { return this.pending; }
  get isClosed(): boolean { return this.closed; }

  enqueue<T>(command: () => Promise<T> | T): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Playback command queue is closed.'));
    this.pending += 1;
    const result = this.tail.then(() => {
      if (this.closed) throw new Error('Playback command queue is closed.');
      return command();
    });
    this.tail = result.then(
      () => { this.pending -= 1; },
      () => { this.pending -= 1; },
    );
    return result;
  }

  async drain(): Promise<void> {
    await this.tail;
  }

  close(): void {
    this.closed = true;
  }
}
