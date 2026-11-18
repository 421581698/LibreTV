export type ImageAuditIssue = { readonly element: HTMLImageElement; readonly reason: 'missing-src' | 'not-loaded' | 'broken' };
export type ImageAuditHost = {
  queryImages(): readonly HTMLImageElement[];
  isLive(): boolean;
  onIssue(issue: ImageAuditIssue): void;
};
export function auditImage(image: HTMLImageElement): ImageAuditIssue | null {
  if (!image.getAttribute('src') && !image.currentSrc) return { element: image, reason: 'missing-src' };
  if (image.complete && image.naturalWidth === 0) return { element: image, reason: 'broken' };
  if (!image.complete) return { element: image, reason: 'not-loaded' };
  return null;
}
export function runImageAudit(host: ImageAuditHost): number {
  if (!host.isLive()) return 0;
  let count = 0;
  for (const image of host.queryImages()) {
    const issue = auditImage(image);
    if (issue) { count += 1; host.onIssue(issue); }
  }
  return count;
}
