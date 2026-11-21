/** Owns listeners, timers, workers and other disposable resources for one session. */
export class PlaybackResourceScope {
  private cleanups: Array<() => void> = [];
  private disposed = false;

  get isDisposed(): boolean { return this.disposed; }
  get size(): number { return this.cleanups.length; }

  add(cleanup: () => void): () => void {
    if (this.disposed) {
      cleanup();
      return () => undefined;
    }
    let active = true;
    const disposeOne = () => {
      if (!active) return;
      active = false;
      const index = this.cleanups.indexOf(disposeOne);
      if (index >= 0) this.cleanups.splice(index, 1);
      cleanup();
    };
    this.cleanups.push(disposeOne);
    return disposeOne;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const pending = this.cleanups.splice(0).reverse();
    const errors: unknown[] = [];
    for (const cleanup of pending) {
      try { cleanup(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'One or more playback resources failed to dispose.');
  }
}
