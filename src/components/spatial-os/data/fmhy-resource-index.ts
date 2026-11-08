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
}

type FMHYDataset = {category:{id:string;title:string};records:Array<Omit<FMHYResource,'categoryId'|'categoryTitle'|'sourcePage'>>};

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
  if (!load) return [];
  const {default:data} = await load();
  return data.records.filter(record => !record.flags.section).map(record => ({
    ...record,
    categoryId: data.category.id,
    categoryTitle: data.category.title,
    sourcePage: `https://github.com/fmhy/edit/blob/main/docs/${data.category.id}.md`,
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
