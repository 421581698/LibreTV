import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { collectorRequest } from '@/lib/resource-collector-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guarded = guardRequest(request);
  if (guarded) return guarded;
  return collectorRequest('/v1/tasks', {}, 10_000);
}
