import { matchesMovieTitle } from '../movie-title-match';

export interface IpadMovieIdentity {
  titles: readonly string[];
  year?: string;
  type?: 'movie' | 'tv';
}

export interface IpadCandidateIdentity {
  title: string;
  originalTitle?: string;
  years?: readonly (string | undefined)[];
  typeNames?: readonly (string | undefined)[];
}

/** Reject conflicting CMS metadata before playback/quality ranking. Missing metadata stays unknown. */
export function matchesIpadMovieIdentity(expected: IpadMovieIdentity, actual: IpadCandidateIdentity): boolean {
  const titles = expected.titles.map((title) => title.trim()).filter(Boolean);
  if (!titles.length || !titles.some((title) => matchesMovieTitle(title, actual.title))) return false;
  if (actual.originalTitle?.trim() && !titles.some((title) => matchesMovieTitle(title, actual.originalTitle!))) return false;
  const releaseYear = expected.year?.match(/(?:19|20)\d{2}/)?.[0];
  if (releaseYear && (actual.years ?? []).some((year) => {
    const candidateYears = year?.match(/(?:19|20)\d{2}/g);
    return Boolean(candidateYears?.length && !candidateYears.includes(releaseYear));
  })) return false;
  const categories = (actual.typeNames ?? []).filter((value): value is string => Boolean(value?.trim()));
  if (expected.type === 'movie' && categories.some((category) =>
    /电视剧|電視劇|连续剧|連續劇|国产剧|美剧|韩剧|日剧|劇集|剧集|影集|短剧|短劇|\b(?:tv\s*(?:series|show|drama)|series|short drama)\b/i.test(category))) return false;
  if (expected.type === 'tv' && categories.some((category) =>
    /^(?:电影|電影|movie|film)$/i.test(category.trim()))) return false;
  return true;
}
