import { describe, expect, it, vi } from 'vitest';
import { auditImage, runImageAudit } from './image-audit';
describe('image audit live gate and retry', () => {
  it('does not inspect images while inactive', () => {
    const image = { getAttribute: vi.fn(() => '/a.jpg'), currentSrc: '/a.jpg', complete: false, naturalWidth: 0 } as unknown as HTMLImageElement;
    const onIssue = vi.fn();
    expect(runImageAudit({ queryImages: () => [image], isLive: () => false, onIssue })).toBe(0);
    expect(onIssue).not.toHaveBeenCalled();
  });
  it('rechecks the same image element after it becomes loaded', () => {
    const image = { getAttribute: () => '/a.jpg', currentSrc: '/a.jpg', complete: false, naturalWidth: 0 } as unknown as HTMLImageElement;
    expect(auditImage(image)?.reason).toBe('not-loaded');
    Object.defineProperty(image, 'complete', { value: true, configurable: true });
    Object.defineProperty(image, 'naturalWidth', { value: 640, configurable: true });
    expect(auditImage(image)).toBeNull();
  });
  it('reports a broken image only while live', () => {
    const image = { getAttribute: () => '/a.jpg', currentSrc: '/a.jpg', complete: true, naturalWidth: 0 } as unknown as HTMLImageElement;
    const onIssue = vi.fn();
    const host = { queryImages: () => [image], isLive: () => true, onIssue };
    expect(runImageAudit(host)).toBe(1);
    expect(onIssue).toHaveBeenCalledWith({ element: image, reason: 'broken' });
  });
});
