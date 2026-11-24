import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardRequest } from '@/lib/api-guard';
import { getPdsVideoPreviewPlayInfo, PdsPreviewError } from '@/lib/pds-video-preview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  domainId: z.string().trim().min(2).max(64).regex(/^[a-zA-Z0-9-]+$/),
  fileId: z.string().trim().min(1).max(256),
  accessToken: z.string().min(1).max(8192).optional(),
  driveId: z.string().trim().min(1).max(256).optional(),
  shareId: z.string().trim().min(1).max(256).optional(),
  shareToken: z.string().min(1).max(8192).optional(),
  category: z.enum(['live_transcoding', 'quick_video', 'offline_video']).optional(),
  templateId: z.string().trim().min(1).max(128).optional(),
  urlExpireSec: z.number().int().min(60).max(14400).optional(),
  getMasterUrl: z.boolean().optional(),
}).strict().refine((value) => {
  if (value.shareId) return Boolean(value.shareToken);
  return Boolean(value.driveId && value.accessToken);
}, { message: '请提供 driveId + accessToken，或 shareId + shareToken' });

const MAX_BODY_BYTES = 16 * 1024;

export async function POST(request: Request) {
  const guarded = guardRequest(request);
  if (guarded) return guarded;

  const length = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: '请求内容过大' }, { status: 413 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'PDS 播放参数不完整或格式无效' }, { status: 400 });
  }

  try {
    const result = await getPdsVideoPreviewPlayInfo(parsed.data);
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' },
    });
  } catch (error) {
    if (error instanceof PdsPreviewError) {
      const status = error.status && error.status >= 400 && error.status <= 599
        ? error.status
        : error.code === 'UNAUTHORIZED' ? 401 : error.code === 'NOT_FOUND' ? 404 : 502;
      return NextResponse.json({
        error: error.message,
        code: error.code,
      }, {
        status,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    return NextResponse.json({ error: 'PDS 播放请求失败', code: 'UPSTREAM_ERROR' }, {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
