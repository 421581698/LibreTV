import { matchesMovieTitle } from '../movie-title-match';

export interface IpadMovieIdentity {
  titles: readonly string[];
  year?: string;
  type?: 'movie' | 'tv';
}

export interface IpadCandidateIdentity {
  title: string;
  originalTitle?: string;
  /** Detail metadata first, search metadata second (lower confidence). */
  years?: readonly (string | undefined)[];
  typeNames?: readonly (string | undefined)[];
}

export type IpadIdentityStatus = 'verified' | 'uncertain' | 'rejected';
export type IpadIdentityReason = 'missing-title' | 'different-title' | 'different-original-title'
  | 'different-year' | 'conflicting-year-metadata' | 'different-media-type' | 'missing-corroboration';

export interface IpadIdentityAssessment {
  status: IpadIdentityStatus;
  reasons: IpadIdentityReason[];
}

const yearOf = (value?: string): string | undefined => value?.match(/(?:19|20)\d{2}/)?.[0];

function incompatibleType(expected: IpadMovieIdentity['type'], typeNames: readonly (string | undefined)[]): boolean {
  if (!expected) return false;
  const known = typeNames.filter((value): value is string => Boolean(value?.trim()));
  if (expected === 'movie') return known.some((name) =>
    /电视剧|電視劇|连续剧|連續劇|国产剧|美剧|韩剧|日剧|劇集|剧集|影集|短剧|短劇|\b(?:tv\s*(?:series|show|drama)|series|short drama)\b/i.test(name));
  return known.some((name) => /^(?:电影|電影|movie|film)$/i.test(name.trim()));
}

/**
 * A CMS title is not proof of the underlying video contents.
 * Reject confirmed different works, but treat conflicting auxiliary metadata as
 * uncertain rather than blocking on a single unreliable provider field.
 */
export function assessIpadMovieIdentity(
  expected: IpadMovieIdentity,
  actual: IpadCandidateIdentity,
): IpadIdentityAssessment {
  const titles = expected.titles.map((value) => value.trim()).filter(Boolean);
  if (!titles.length || !actual.title.trim()) return { status: 'rejected', reasons: ['missing-title'] };
  if (!titles.some((title) => matchesMovieTitle(title, actual.title))) {
    return { status: 'rejected', reasons: ['different-title'] };
  }
  if (incompatibleType(expected.type, actual.typeNames ?? [])) {
    return { status: 'rejected', reasons: ['different-media-type'] };
  }

  const reasons: IpadIdentityReason[] = [];
  const expectedYear = yearOf(expected.year);
  const detailsYear = yearOf(actual.years?.[0]);
  const searchYear = yearOf(actual.years?.[1]);
  const originalConflicts = Boolean(actual.originalTitle?.trim() &&
    !titles.some((title) => matchesMovieTitle(title, actual.originalTitle!)));

  // An exact expected year in detailed metadata outweighs a stale search-list
  // year. Missing years are unknown; they must not be treated as a match.
  if (expectedYear && detailsYear && detailsYear !== expectedYear) {
    return { status: 'uncertain', reasons: ['different-year'] };
  }
  if (expectedYear && !detailsYear && searchYear && searchYear !== expectedYear) {
    return { status: 'uncertain', reasons: ['different-year'] };
  }
  if (expectedYear && detailsYear === expectedYear && searchYear && searchYear !== expectedYear) {
    reasons.push('conflicting-year-metadata');
  }
  if (originalConflicts) {
    // CMS "original title" is often a subtitle, file name or a stale field.
    // Require a corroborating release year before accepting the main exact title.
    if (!expectedYear || (detailsYear !== expectedYear && searchYear !== expectedYear)) {
      return { status: 'uncertain', reasons: ['different-original-title', 'missing-corroboration'] };
    }
    reasons.push('different-original-title');
  }
  return { status: 'verified', reasons };
}

/** Backwards-compatible allow-list predicate: uncertain candidates are never played. */
export function matchesIpadMovieIdentity(expected: IpadMovieIdentity, actual: IpadCandidateIdentity): boolean {
  return assessIpadMovieIdentity(expected, actual).status === 'verified';
}
