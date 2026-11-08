import { NextRequest, NextResponse } from 'next/server';
import { FMHY_CATEGORIES, parseFmhyMarkdown, type FmhyCategoryId, type FmhyResource } from '@/lib/fmhy-index';

export const runtime = 'nodejs';
export const revalidate = 1800;

const RAW_BASE = 'https://raw.githubusercontent.com/fmhy/edit/main/docs/';

async function loadCategory(categoryId: FmhyCategoryId): Promise<FmhyResource[]> {
  const category = FMHY_CATEGORIES.find((item) => item.id === categoryId);
  if (!category) return [];
  const response = await fetch(RAW_BASE + category.file, { next: { revalidate: 1800 } });
  if (!response.ok) throw new Error(`FMHY 上游暂不可用（${response.status}）`);
  return parseFmhyMarkdown(await response.text(), categoryId);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const query = (params.get('q') ?? '').trim().toLocaleLowerCase().slice(0, 100);
  const categoryParam = params.get('category');
  const resourceUrl = params.get('url');

  const selected = categoryParam
    ? FMHY_CATEGORIES.filter((item) => item.id === categoryParam)
    : query || resourceUrl
      ? [...FMHY_CATEGORIES]
      : [];

  if (categoryParam && selected.length === 0) {
    return NextResponse.json({ error: '未知的 FMHY 分类' }, { status: 400 });
  }
  if (!query && !resourceUrl && !categoryParam) {
    return NextResponse.json({ categories: FMHY_CATEGORIES, results: [] });
  }

  try {
    const groups = await Promise.all(selected.map((item) => loadCategory(item.id)));
    const all = groups.flat();

    if (resourceUrl) {
      const match = all.find((item) => item.href === resourceUrl);
      return match
        ? NextResponse.json({ resource: match, categories: FMHY_CATEGORIES })
        : NextResponse.json({ error: '资源不存在或已从上游目录移除' }, { status: 404 });
    }

    const terms = query.split(/\s+/).filter(Boolean);
    const results = all
      .map((item) => {
        const title = item.title.toLocaleLowerCase();
        const description = item.description.toLocaleLowerCase();
        const domain = item.domain.toLocaleLowerCase();
        const matches = terms.every((term) => title.includes(term) || description.includes(term) || domain.includes(term));
        const score = (title === query ? 100 : title.startsWith(query) ? 60 : title.includes(query) ? 35 : 0)
          + (item.starred ? 8 : 0)
          + (domain.includes(query) ? 5 : 0);
        return { item, matches, score };
      })
      .filter((entry) => query ? entry.matches : true)
      .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
      .slice(0, query ? 250 : 100)
      .map((entry) => entry.item);

    return NextResponse.json({
      categories: FMHY_CATEGORIES,
      results,
      total: results.length,
      source: 'fmhy/edit',
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'FMHY 目录加载失败' },
      { status: 502 }
    );
  }
}
