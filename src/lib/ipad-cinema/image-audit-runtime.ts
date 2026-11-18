import { runImageAudit, type ImageAuditHost, type ImageAuditIssue } from './image-audit';
export function attachImageAuditRuntime(args: {
  root: Document | HTMLElement;
  onIssue: (issue: ImageAuditIssue) => void;
  isLive?: () => boolean;
}) {
  let detached = false;
  let live = true;
  const host: ImageAuditHost = {
    queryImages: () => Array.from(args.root.querySelectorAll('img')),
    isLive: () => !detached && live && (args.isLive?.() ?? true),
    onIssue: args.onIssue,
  };
  const audit = () => { if (host.isLive()) runImageAudit(host); };
  const onLoad = (event: Event) => {
    const target = event.target;
    if (target instanceof HTMLImageElement && host.isLive()) {
      const issue = (target.complete && target.naturalWidth === 0)
        ? { element: target, reason: 'broken' as const }
        : null;
      if (issue) host.onIssue(issue);
    }
  };
  args.root.addEventListener('load', onLoad, true);
  args.root.addEventListener('error', onLoad, true);
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
      args.root.removeEventListener('load', onLoad, true);
      args.root.removeEventListener('error', onLoad, true);
    },
  };
}
