import { describe, expect, it, vi } from 'vitest';
import { PlaybackResourceScope } from './resource-scope';

describe('PlaybackResourceScope', () => {
  it('disposes resources in reverse order and only once', () => {
    const scope = new PlaybackResourceScope();
    const order: number[] = [];
    scope.add(() => order.push(1));
    scope.add(() => order.push(2));
    scope.dispose();
    scope.dispose();
    expect(order).toEqual([2, 1]);
  });

  it('runs cleanup immediately when added after disposal', () => {
    const scope = new PlaybackResourceScope();
    scope.dispose();
    const cleanup = vi.fn();
    scope.add(cleanup);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('allows an individual resource to be released early', () => {
    const scope = new PlaybackResourceScope();
    const cleanup = vi.fn();
    const release = scope.add(cleanup);
    release();
    scope.dispose();
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
