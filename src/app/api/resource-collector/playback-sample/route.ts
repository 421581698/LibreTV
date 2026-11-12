import { NextResponse } from 'next/server';
import { guardPrivateFeatureRequest } from '@/lib/api-guard';
import { collectorRequest } from '@/lib/resource-collector-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const guarded = guardPrivateFeatureRequest(request);
  if (guarded) return guarded;

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > 2_048) {
    return NextResponse.json({ error: 'Request body is too large.' }, { status: 413 });
  }
  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 2_048) {
      return NextResponse.json({ error: 'Request body is too large.' }, { status: 413 });
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid playback sample.' }, { status: 400 });
  }
  const sample = body as Record<string, unknown>;
  const normalized = {
    host: sample.host,
    media_type: sample.mediaType ?? sample.media_type,
    observed_seconds: sample.observedSeconds ?? sample.observed_seconds,
    progressed_seconds: sample.progressedSeconds ?? sample.progressed_seconds,
    decoded_width: sample.decodedWidth ?? sample.decoded_width ?? 0,
    decoded_height: sample.decodedHeight ?? sample.decoded_height ?? 0,
    selected_rendition_height: sample.selectedRenditionHeight ?? sample.selected_rendition_height ?? 0,
    selected_rendition_bitrate_kbps: sample.selectedRenditionBitrateKbps ?? sample.selected_rendition_bitrate_kbps ?? 0,
  };
  return collectorRequest('/v1/playback-samples', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(normalized),
  }, 10_000, request);
}
