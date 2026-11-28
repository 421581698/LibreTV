import type { IpadResourceDiagnostic } from './playback-coordinator';

const KEY = 'libretv:ipad:resource-verdicts:v1';
const MAX_RECORDS = 64;
const TTL_MS = 10 * 60_000;

interface StoredVerdict extends IpadResourceDiagnostic {
  at: number;
}

function read(now = Date.now()): StoredVerdict[] {
  if (typeof window === 'undefined') return [];
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is StoredVerdict =>
      entry && typeof entry.sourceKey === 'string' &&
      typeof entry.vodId === 'string' &&
      typeof entry.at === 'number' && now >= entry.at && now - entry.at <= TTL_MS &&
      (entry.verdict === 'verified' || entry.verdict === 'uncertain' ||
       entry.verdict === 'rejected' || entry.verdict === 'unavailable')).slice(-MAX_RECORDS);
  } catch {
    return [];
  }
}

/** Session-scoped metadata only; no URLs, tokens, playback histories or private media data. */
export function recordIpadResourceVerdict(result: IpadResourceDiagnostic): void {
  if (typeof window === 'undefined' || !result.sourceKey || !result.vodId) return;
  try {
    const previous = read().filter((entry) =>
      !(entry.sourceKey === result.sourceKey && entry.vodId === result.vodId));
    previous.push({ ...result, reasons: [...result.reasons].slice(0, 4), at: Date.now() });
    window.sessionStorage.setItem(KEY, JSON.stringify(previous.slice(-MAX_RECORDS)));
  } catch {
    // Private browsing and disabled storage must not stop playback.
  }
}

/** Only confirmed wrong title/type identities are excluded briefly. */
export function getRejectedIpadResourceKeys(): Set<string> {
  return new Set(read().filter((entry) => entry.verdict === 'rejected' &&
    entry.reasons.some((reason) => reason === 'different-title' || reason === 'different-media-type'))
    .map((entry) => entry.sourceKey + ':' + entry.vodId));
}
