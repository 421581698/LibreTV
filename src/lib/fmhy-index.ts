export const FMHY_CATEGORIES = [
  { id: 'privacy', title: '广告拦截 / 隐私', sourceTitle: 'Adblocking / Privacy', file: 'privacy.md' },
  { id: 'ai', title: '人工智能', sourceTitle: 'Artificial Intelligence', file: 'ai.md' },
  { id: 'video', title: '影视 / 电视 / 动漫', sourceTitle: 'Movies / TV / Anime', file: 'video.md' },
  { id: 'audio', title: '音乐 / 播客 / 广播', sourceTitle: 'Music / Podcasts / Radio', file: 'audio.md' },
  { id: 'gaming', title: '游戏 / 模拟器', sourceTitle: 'Gaming / Emulation', file: 'gaming.md' },
  { id: 'reading', title: '书籍 / 漫画 / Manga', sourceTitle: 'Books / Comics / Manga', file: 'reading.md' },
  { id: 'downloading', title: '下载工具', sourceTitle: 'Downloading', file: 'downloading.md' },
  { id: 'torrenting', title: 'BT / Torrent', sourceTitle: 'Torrenting', file: 'torrenting.md' },
  { id: 'educational', title: '教育资源', sourceTitle: 'Educational', file: 'educational.md' },
  { id: 'mobile', title: 'Android / iOS', sourceTitle: 'Android / iOS', file: 'mobile.md' },
  { id: 'linux-macos', title: 'Linux / macOS', sourceTitle: 'Linux / macOS', file: 'linux-macos.md' },
  { id: 'non-english', title: '非英语资源', sourceTitle: 'Non-English', file: 'non-english.md' },
  { id: 'misc', title: '其他工具', sourceTitle: 'Miscellaneous Tools', file: 'misc.md' },
] as const;

export type FmhyCategoryId = (typeof FMHY_CATEGORIES)[number]['id'];

export type FmhyResource = {
  id: string;
  title: string;
  href: string;
  domain: string;
  categoryId: FmhyCategoryId;
  categoryTitle: string;
  description: string;
  starred: boolean;
  sourceUrl: string;
};

function cleanMarkdownText(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[*_`~]/g, '')
    .replace(/\\s+/g, ' ')
    .trim();
}

export function parseFmhyMarkdown(markdown: string, categoryId: FmhyCategoryId): FmhyResource[] {
  const category = FMHY_CATEGORIES.find((item) => item.id === categoryId);
  if (!category) return [];
  const resources = new Map<string, FmhyResource>();

  for (const rawLine of markdown.split(/\r?\n/)) {
    const bullet = rawLine.match(/^\s*[*-]\s+(.+)$/);
    if (!bullet) continue;
    const line = bullet[1];
    const links = [...line.matchAll(/\[([^\]]{1,180})\]\((https?:\/\/[^)\s]+)\)/g)];
    if (links.length === 0) continue;

    const primary = links[0];
    const title = cleanMarkdownText(primary[1]).replace(/^[⭐🌟★\s]+/, '').slice(0, 160);
    if (!title) continue;

    let parsed: URL;
    try {
      parsed = new URL(primary[2]);
    } catch {
      continue;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue;
    if (parsed.hostname === 'github.com' && parsed.pathname.toLowerCase().startsWith('/fmhy/')) continue;

    const description = cleanMarkdownText(line.slice((primary.index ?? 0) + primary[0].length)
      .replace(/^\s*[-–—:|]\s*/, '')).slice(0, 700);
    const href = parsed.toString();
    const id = `${category.id}:${href}`;
    if (resources.has(id)) continue;

    resources.set(id, {
      id,
      title,
      href,
      domain: parsed.hostname.replace(/^www\./, ''),
      categoryId: category.id,
      categoryTitle: category.title,
      description,
      starred: /⭐|🌟|★/.test(line.slice(0, primary.index ?? 0)),
      sourceUrl: `https://github.com/fmhy/edit/blob/main/docs/${category.file}`,
    });
  }
  return [...resources.values()];
}
