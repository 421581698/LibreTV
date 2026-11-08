import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

const markdown = [
  '* ⭐ **[Example AI Tool](https://example.org/ai)** - A useful assistant for research',
  '* [Second Tool](https://second.example/tool) - Another utility',
].join(String.fromCharCode(10));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /api/fmhy', () => {
  it('returns category results from the fixed official FMHY source', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(markdown, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(new NextRequest('https://libretv.test/api/fmhy?category=ai'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results).toHaveLength(2);
    expect(body.results[0].title).toBe('Example AI Tool');
    expect(String(fetchMock.mock.calls[0][0])).toContain('raw.githubusercontent.com/fmhy/edit/main/docs/ai.md');
  });

  it('searches across all official category documents and ranks starred results', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(markdown, { status: 200 })));

    const response = await GET(new NextRequest('https://libretv.test/api/fmhy?q=example'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results[0].title).toBe('Example AI Tool');
    expect(body.results.length).toBeGreaterThan(0);
  });

  it('paginates category results without truncating the directory at the first page', async () => {
    const largeMarkdown = Array.from({ length: 120 }, (_, index) =>
      `* [Resource ${index}](https://resource-${index}.example/) - Directory entry ${index}`
    ).join(String.fromCharCode(10));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(largeMarkdown, { status: 200 })));

    const first = await GET(new NextRequest('https://libretv.test/api/fmhy?category=ai'));
    const firstBody = await first.json();
    expect(firstBody.results).toHaveLength(100);
    expect(firstBody.total).toBe(120);
    expect(firstBody.hasMore).toBe(true);

    const second = await GET(new NextRequest('https://libretv.test/api/fmhy?category=ai&offset=100'));
    const secondBody = await second.json();
    expect(secondBody.results).toHaveLength(20);
    expect(secondBody.offset).toBe(100);
    expect(secondBody.hasMore).toBe(false);
  });

  it('rejects unknown categories without fetching an arbitrary URL', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(new NextRequest('https://libretv.test/api/fmhy?category=unknown'));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns resource details only when the URL exactly matches an official entry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(markdown, { status: 200 })));

    const response = await GET(new NextRequest('https://libretv.test/api/fmhy?category=ai&url=' + encodeURIComponent('https://example.org/ai')));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.resource).toMatchObject({ title: 'Example AI Tool', href: 'https://example.org/ai' });
  });
});
