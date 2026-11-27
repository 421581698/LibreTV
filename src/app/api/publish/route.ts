import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { MAX_LIVE_SOURCES, MAX_VOD_SOURCES } from '@/lib/source-list';
import { MAX_PUBLISH_BYTES, publishSourceList } from '@/lib/source-list-publish';

export const runtime = 'nodejs';

/** 单个字段长度上限：源名与地址再长也不该超过这个量级 */
const MAX_FIELD_LEN = 2048;
const MAX_REQUEST_BYTES = 512 * 1024;

async function readBoundedPublishBody(req: Request): Promise<string> {
  const declared = Number(req.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) throw new Error('REQUEST_TOO_LARGE');
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new Error('REQUEST_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

interface VodOut {
  name: string;
  url: string;
}

interface LiveOut {
  name: string;
  url: string;
  epg?: string;
}

/**
 * 只抽取已知字段并重新序列化。
 * 本接口的语义是「发布源列表」，不是通用上传通道：白名单式取字段 + 条数上限，
 * 避免它被当作任意内容的中转（服务端会向固定第三方域名 POST，这一点必须守住）。
 */
function normalizePayload(raw: unknown): { name?: string; sources: VodOut[]; liveSources: LiveOut[] } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const text = (v: unknown, max = MAX_FIELD_LEN) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const url = (v: unknown) => {
    const s = text(v);
    return /^https?:\/\//i.test(s) ? s : '';
  };

  const sources = (Array.isArray(record.sources) ? record.sources : [])
    .slice(0, MAX_VOD_SOURCES)
    .map((item) => {
      const o = (item ?? {}) as Record<string, unknown>;
      return { name: text(o.name, 128), url: url(o.url) };
    })
    .filter((s) => s.url);

  const liveSources = (Array.isArray(record.liveSources) ? record.liveSources : [])
    .slice(0, MAX_LIVE_SOURCES)
    .map((item) => {
      const o = (item ?? {}) as Record<string, unknown>;
      const epg = url(o.epg);
      return { name: text(o.name, 128), url: url(o.url), ...(epg ? { epg } : {}) };
    })
    .filter((s) => s.url);

  if (sources.length === 0 && liveSources.length === 0) return null;
  return { name: text(record.name, 64) || undefined, sources, liveSources };
}

/** 把当前源列表发布到第三方粘贴板，返回可直接填入订阅框的 URL */
export async function POST(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  let raw: unknown;
  try {
    raw = JSON.parse(await readBoundedPublishBody(req));
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === 'REQUEST_TOO_LARGE';
    return NextResponse.json(
      { error: tooLarge ? '源列表请求体超过 512KB' : '请求内容不是合法 JSON' },
      { status: tooLarge ? 413 : 400 },
    );
  }

  const normalized = normalizePayload(raw);
  if (!normalized) {
    return NextResponse.json({ error: '没有可发布的源（当前没有已勾选启用的点播源或直播源）' }, { status: 400 });
  }

  // 与「导出数据源」保持同一种格式，发布出去的链接可以直接被本站或他人订阅
  const payload = JSON.stringify(
    {
      name: normalized.name ?? 'LibreTV-SourceList',
      version: 2,
      exportedAt: Date.now(),
      sources: normalized.sources,
      liveSources: normalized.liveSources,
    },
    null,
    2
  );

  if (Buffer.byteLength(payload, 'utf8') > MAX_PUBLISH_BYTES) {
    return NextResponse.json({ error: '源列表体积超出公开粘贴板的限制，无法发布' }, { status: 413 });
  }

  try {
    const { url, provider } = await publishSourceList(payload);
    return NextResponse.json({
      url,
      provider,
      sources: normalized.sources.length,
      liveSources: normalized.liveSources.length,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '发布失败' }, { status: 502 });
  }
}
