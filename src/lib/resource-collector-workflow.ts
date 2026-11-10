import type { SourceConfig } from './types';

export interface CollectorCmsCandidate {
  id?: string;
  url: string;
  kind: string;
  host: string;
  title?: string;
}

export interface CollectorCmsValidation {
  cms_shape?: boolean;
  reachable?: boolean;
  source_url?: string | null;
  access?: { access_state?: string };
  reason?: string;
}

export interface CollectorSourceStore {
  customAPIs: SourceConfig[];
  envSources: SourceConfig[];
  addCustomApi: (source: Omit<SourceConfig, 'key'>) => void;
}

function normalizedSourceUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

/**
 * Register only a publicly reachable, structurally verified Apple/MacCMS VOD API.
 * Direct media and webpage/player URLs intentionally remain outside the VOD source store.
 */
export function registerValidatedCmsSource(
  store: CollectorSourceStore,
  candidate: CollectorCmsCandidate,
  validation: CollectorCmsValidation,
  detail?: string,
): { registered: boolean; duplicate: boolean; sourceUrl?: string; reason?: string } {
  if (candidate.kind !== 'cms-api-candidate') {
    return { registered: false, duplicate: false, reason: '该候选不是 CMS 点播 API。' };
  }
  if (validation.cms_shape !== true || validation.reachable !== true ||
      validation.access?.access_state !== 'PUBLIC') {
    return {
      registered: false,
      duplicate: false,
      reason: validation.reason || 'CMS API 结构或公开访问验证未通过。',
    };
  }

  const sourceUrl = normalizedSourceUrl(
    typeof validation.source_url === 'string' && validation.source_url
      ? validation.source_url
      : candidate.url,
  );
  if (!/^https:\/\//i.test(sourceUrl)) {
    return { registered: false, duplicate: false, reason: 'CMS API 地址无效。' };
  }

  const duplicate = [...store.customAPIs, ...store.envSources]
    .some((source) => normalizedSourceUrl(source.url) === sourceUrl);
  if (duplicate) return { registered: false, duplicate: true, sourceUrl };

  store.addCustomApi({
    name: candidate.title || candidate.host,
    url: sourceUrl,
    ...(detail ? { detail } : {}),
  });
  return { registered: true, duplicate: false, sourceUrl };
}
