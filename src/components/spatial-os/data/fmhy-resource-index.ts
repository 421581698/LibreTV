export interface FMHYResource {
  id: string;
  title: string;
  url: string;
  section: string[];
  links: Array<{label:string;url:string}>;
  tags: string[];
  flags: {recommended:boolean;thirdParty:boolean;section:boolean};
  categoryId: string;
  categoryTitle: string;
  sourcePage: string;
  sourceRevision: string;
  sourceBlobSha: string;
  sourceRetrievedAt: string;
  sourcePath: string;
}

type FMHYSourceSnapshot = {
  repository: string;
  path: string;
  sha: string;
  retrievedAt: string;
};

type FMHYDataset = {
  category: {id:string;title:string};
  source: FMHYSourceSnapshot;
  records: Array<Omit<FMHYResource,'categoryId'|'categoryTitle'|'sourcePage'|'sourceRevision'|'sourceBlobSha'|'sourceRetrievedAt'|'sourcePath'>>;
};

const SOURCE_COMMITS: Record<string,string> = {
  privacy: '46a32832774933b149739050d669d73a672c905a',
  ai: '1e66cc9ddebc326008932a5d6fef4ee31b862f18',
  video: '46a32832774933b149739050d669d73a672c905a',
  audio: '46a32832774933b149739050d669d73a672c905a',
  gaming: '46a32832774933b149739050d669d73a672c905a',
  reading: '1e66cc9ddebc326008932a5d6fef4ee31b862f18',
  downloading: '46a32832774933b149739050d669d73a672c905a',
  torrenting: '5fbf2d3b6a6f478f36a90f1108f88c2f1f08f336',
  educational: '46a32832774933b149739050d669d73a672c905a',
  mobile: '46a32832774933b149739050d669d73a672c905a',
  'linux-macos': '46a32832774933b149739050d669d73a672c905a',
  'non-english': '46a32832774933b149739050d669d73a672c905a',
  misc: '46a32832774933b149739050d669d73a672c905a',
};

const loaders: Record<string, () => Promise<{default:FMHYDataset}>> = {
  privacy: () => import('./fmhy-resources/privacy.json'),
  ai: () => import('./fmhy-resources/ai.json'),
  video: () => import('./fmhy-resources/video.json'),
  audio: () => import('./fmhy-resources/audio.json'),
  gaming: () => import('./fmhy-resources/gaming.json'),
  reading: () => import('./fmhy-resources/reading.json'),
  downloading: () => import('./fmhy-resources/downloading.json'),
  torrenting: () => import('./fmhy-resources/torrenting.json'),
  educational: () => import('./fmhy-resources/educational.json'),
  mobile: () => import('./fmhy-resources/mobile.json'),
  'linux-macos': () => import('./fmhy-resources/linux-macos.json'),
  'non-english': () => import('./fmhy-resources/non-english.json'),
  misc: () => import('./fmhy-resources/misc.json'),
};

export async function loadFMHYCategory(categoryId: string): Promise<FMHYResource[]> {
  const load = loaders[categoryId];
  const sourceCommit = SOURCE_COMMITS[categoryId];
  if (!load || !sourceCommit) return [];
  const {default:data} = await load();
  return data.records.map(record => ({
    ...record,
    categoryId: data.category.id,
    categoryTitle: data.category.title,
    sourcePage: `${data.source.repository}/blob/${sourceCommit}/${data.source.path}`,
    sourceRevision: sourceCommit,
    sourceBlobSha: data.source.sha,
    sourceRetrievedAt: data.source.retrievedAt,
    sourcePath: data.source.path,
  }));
}

export async function loadAllFMHYCategories(): Promise<FMHYResource[]> {
  const groups = await Promise.all(Object.keys(loaders).map(loadFMHYCategory));
  return groups.flat();
}

export const FMHY_RESOURCE_SOURCE = {
  name: 'FMHY',
  repository: 'https://github.com/fmhy/edit',
  api: 'https://api.fmhy.net/single-page',
  retrievedAt: '2026-11-08',
  attribution: 'FMHY is a community-maintained directory. LibreTV stores a local index of resource names, URLs, section paths and short tags; destination sites are independently operated and are not verified by LibreTV.',
} as const;
