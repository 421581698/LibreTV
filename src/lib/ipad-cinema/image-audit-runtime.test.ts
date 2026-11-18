import { describe, expect, it, vi } from 'vitest';
import { attachImageAuditRuntime } from './image-audit-runtime';

describe('image audit runtime', () => {
  it('deduplicates unchanged issues and reports again after recovery', () => {
    const image = {
      getAttribute: () => '/poster.jpg',
      currentSrc: '/poster.jpg',
      complete: false,
      naturalWidth: 0,
    } as unknown as HTMLImageElement;
    const root = {
      querySelectorAll: () => [image],
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Document;
    const onIssue = vi.fn();
    const runtime = attachImageAuditRuntime({ root, onIssue });

    runtime.audit();
    runtime.audit();
    expect(onIssue).not.toHaveBeenCalled();

    Object.defineProperty(image, 'complete', { configurable: true, value: true });
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 640 });
    runtime.audit();
    expect(onIssue).not.toHaveBeenCalled();

    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 0 });
    runtime.audit();
    expect(onIssue).toHaveBeenCalledTimes(1);
    runtime.detach();
    runtime.detach();
    expect(root.removeEventListener).toHaveBeenCalledTimes(2);
  });
});
