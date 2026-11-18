import { auditImage, type ImageAuditIssue } from './image-audit';
export function attachImageAuditRuntime(args: {
  root: Document | HTMLElement;
  onIssue: (issue: ImageAuditIssue) => void;
  isLive?: () => boolean;
}) {
  let detached = false;
  let live = true;
  const reported = new WeakMap<HTMLImageElement, ImageAuditIssue['reason']>();
  const isLive = () => !detached && live && (args.isLive?.() ?? true);
  const audit = () => {
    if (!isLive()) return 0;
    let count = 0;
    for (const image of Array.from(args.root.querySelectorAll('img'))) {
      const issue = auditImage(image);
      if (!issue) {
        reported.delete(image);
        continue;
      }
      count += 1;
      if (reported.get(image) !== issue.reason) {
        reported.set(image, issue.reason);
        args.onIssue(issue);
      }
    }
    return count;
  };
  const onImageSettled = (event: Event) => {
    const target = event.target;
    if (typeof HTMLImageElement !== 'undefined' && target instanceof HTMLImageElement && isLive()) {
      const issue = auditImage(target);
      if (!issue) reported.delete(target);
      else if (reported.get(target) !== issue.reason) {
        reported.set(target, issue.reason);
        args.onIssue(issue);
      }
    }
  };
  args.root.addEventListener('load', onImageSettled, true);
  args.root.addEventListener('error', onImageSettled, true);
  const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(audit);
  observer?.observe(args.root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset'] });
  audit();
  return {
    audit,
    setLive(value: boolean) { live = value; if (live) audit(); },
    detach() {
      if (detached) return;
      detached = true;
      observer?.disconnect();
      args.root.removeEventListener('load', onImageSettled, true);
      args.root.removeEventListener('error', onImageSettled, true);
    },
  };
}
