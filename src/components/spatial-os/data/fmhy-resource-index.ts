import privacy from './fmhy-resources/privacy.json';
import ai from './fmhy-resources/ai.json';
import video from './fmhy-resources/video.json';
import audio from './fmhy-resources/audio.json';
import gaming from './fmhy-resources/gaming.json';
import reading from './fmhy-resources/reading.json';
import downloading from './fmhy-resources/downloading.json';
import torrenting from './fmhy-resources/torrenting.json';
import educational from './fmhy-resources/educational.json';
import mobile from './fmhy-resources/mobile.json';
import linuxMacos from './fmhy-resources/linux-macos.json';
import nonEnglish from './fmhy-resources/non-english.json';
import misc from './fmhy-resources/misc.json';

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

const sources = [privacy,ai,video,audio,gaming,reading,downloading,torrenting,educational,mobile,linuxMacos,nonEnglish,misc] as const;

export const FMHY_RESOURCES: FMHYResource[] = sources.flatMap(source =>
  source.records.map(record => ({
    ...record,
    categoryId: source.category.id,
    categoryTitle: source.category.title,
    sourcePage: `https://github.com/fmhy/edit/blob/main/docs/${source.category.id}.md`,
  })) as FMHYResource[]
);

export const FMHY_RESOURCE_SOURCE = {
  name: 'FMHY',
  repository: 'https://github.com/fmhy/edit',
  api: 'https://api.fmhy.net/single-page',
  retrievedAt: '2026-11-08',
  attribution: 'FMHY is a community-maintained directory. LibreTV stores a local index of resource names, URLs, section paths and short tags; destination sites are independently operated and are not verified by LibreTV.',
} as const;
