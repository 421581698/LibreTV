import { NextResponse } from 'next/server';
import { guardPrivateFeatureRequest } from '@/lib/api-guard';
import { collectorRequest } from '@/lib/resource-collector-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ candidateId: string }> },
) {
  const guarded = guardPrivateFeatureRequest(request);
  if (guarded) return guarded;

  const { candidateId } = await context.params;
  if (!/^[a-f0-9]{32}$/i.test(candidateId)) {
    return NextResponse.json({ error: 'Invalid candidate ID.' }, { status: 400 });
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > 2_048) {
    return NextResponse.json({ error: 'Request body is too large.' }, { status: 413 });
  }

  let body: unknown;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 2_048) {
      return NextResponse.json({ error: 'Request body is too large.' }, { status: 413 });
    }
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid playback evidence.' }, { status: 400 });
  }

  const evidence = body as Record<string, unknown>;
  const normalized = {
    media_type: evidence.mediaType ?? evidence.media_type,
    observed_seconds: evidence.observedSeconds ?? evidence.observed_seconds,
    progressed_seconds: evidence.progressedSeconds ?? evidence.progressed_seconds,
    decoded_width: evidence.decodedWidth ?? evidence.decoded_width ?? 0,
    decoded_height: evidence.decodedHeight ?? evidence.decoded_height ?? 0,
    selected_rendition_height: evidence.selectedRenditionHeight ?? evidence.selected_rendition_height ?? 0,
    selected_rendition_bitrate_kbps: evidence.selectedRenditionBitrateKbps ?? evidence.selected_rendition_bitrate_kbps ?? 0,
  };

  return collectorRequest(
    `/v1/candidates/${candidateId}/playback`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalized),
    },
    10_000,
    request,
  );
}
