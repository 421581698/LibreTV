import type { VideoInfo } from './types';

/**
 * Build real CMS search terms for related-title discovery.
 * Actor and director names are the strongest metadata available in Apple CMS
 * search; use the current title only when the source provides no people metadata.
 */
export function buildRelatedSearchTerms(info?: Pick<VideoInfo, 'actor' | 'director'>, fallbackTitle = ''): string[] {
  const splitPeople = (value?: string) => (value ?? '')
    .split(/[、,，;；|/]+/)
    .map((name) => name.trim())
    .filter((name) => name.length >= 2);

  const people = [
    ...splitPeople(info?.actor).slice(0, 2),
    ...splitPeople(info?.director).slice(0, 1),
  ];
  const seen = new Set<string>();
  const terms = people.filter((name) => {
    const key = name.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (terms.length > 0) return terms.slice(0, 2);
  const title = fallbackTitle.trim();
  return title ? [title.slice(0, 50)] : [];
}
