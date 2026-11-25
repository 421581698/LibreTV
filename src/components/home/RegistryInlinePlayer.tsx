'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '@/lib/store';
import type { RegistrySearchResource } from '@/lib/types';

const PlayerShell = dynamic(
  () => import('@/components/player-shell').then((module) => module.PlayerShell),
  { ssr: false, loading: () => <div className="aspect-video w-full animate-pulse bg-black" /> },
);

export function RegistryInlinePlayer({
  resource,
  onClose,
}: {
  resource: RegistrySearchResource | null;
  onClose: () => void;
}) {
  const adFilter = useAppStore((state) => state.adFilter);
  const autoSkipSegments = useAppStore((state) => state.autoSkipSegments);
  const autoplayNext = useAppStore((state) => state.autoplayNext);
  const [pendingStart, setPendingStart] = useState<number | null>(null);
  const [assetLookupNonce, setAssetLookupNonce] = useState(0);
  const [immutableAsset, setImmutableAsset] = useState<{
    resourceId: string;
    assetId: string;
    url: string;
    mediaType: 'hls' | 'mp4' | 'webm';
  } | null>(null);

  const resourceId = resource?.id;
  const resourceMediaFormat = resource?.media_format;

  useEffect(() => {
    setImmutableAsset(null);
    if (!resourceId || !['hls', 'mp4', 'webm'].includes(resourceMediaFormat ?? '')) return;

    const controller = new AbortController();
    const retryDelays = assetLookupNonce > 0 ? [3_000, 6_000, 12_000, 20_000, 30_000, 45_000, 60_000, 90_000, 120_000, 180_000, 240_000, 300_000, 360_000, 480_000, 600_000, 900_000, 1_200_000] : [];
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const lookup = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/dolby-vision/resources/${encodeURIComponent(resourceId)}/asset`, {
          method: 'GET',
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (response.ok) {
          const payload: unknown = await response.json().catch(() => null);
          if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
            const asset = payload as Record<string, unknown>;
            if (asset.resourceId === resourceId &&
                typeof asset.assetId === 'string' && /^[A-Za-z0-9:_-]{1,200}$/.test(asset.assetId) &&
                typeof asset.sha256 === 'string' && /^[a-f0-9]{64}$/.test(asset.sha256) &&
                typeof asset.byteLength === 'number' && Number.isSafeInteger(asset.byteLength) && asset.byteLength > 0 &&
                ['video/mp4', 'video/webm', 'application/vnd.apple.mpegurl'].includes(String(asset.contentType))) {
              const assetMediaType = asset.contentType === 'video/webm' ? 'webm'
                : asset.contentType === 'application/vnd.apple.mpegurl' ? 'hls' : 'mp4';
              if (assetMediaType === resourceMediaFormat && !controller.signal.aborted) {
                setImmutableAsset({
                  resourceId,
                  assetId: asset.assetId,
                  url: `/api/dolby-vision/assets/${encodeURIComponent(asset.assetId)}/content`,
                  mediaType: assetMediaType as 'hls' | 'mp4' | 'webm',
                });
                return;
              }
            }
          }
        } else if (![404, 409, 429].includes(response.status) && response.status < 500) {
          return;
        }
      } catch {
        if (controller.signal.aborted) return;
      }

      if (!controller.signal.aborted && attempts < retryDelays.length) {
        retryTimer = setTimeout(() => {
          attempts += 1;
          void lookup();
        }, retryDelays[attempts]);
      }
    };

    void lookup();
    return () => {
      controller.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [resourceId, resourceMediaFormat, assetLookupNonce]);

  const confirmPlayback = useCallback((evidence: { mediaType: string; observedSeconds: number; progressedSeconds: number; decodedWidth: number; decodedHeight: number; selectedRenditionHeight: number; selectedRenditionBitrateKbps: number }) => {
    if (!resource?.candidate_id) return;
    void fetch(`/api/resource-collector/candidates/${resource.candidate_id}/playback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media_type: evidence.mediaType,
        observed_seconds: evidence.observedSeconds,
        progressed_seconds: evidence.progressedSeconds,
        decoded_width: evidence.decodedWidth,
        decoded_height: evidence.decodedHeight,
        selected_rendition_height: evidence.selectedRenditionHeight,
        selected_rendition_bitrate_kbps: evidence.selectedRenditionBitrateKbps,
      }),
    }).then(async (response) => {
      if (!response.ok) return;
      const payload: unknown = await response.json().catch(() => null);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
      const mediaIngestion = (payload as Record<string, unknown>).media_ingestion;
      if (!mediaIngestion || typeof mediaIngestion !== 'object' || Array.isArray(mediaIngestion)) return;
      const status = (mediaIngestion as Record<string, unknown>).status;
      if (status === 'queued' || status === 'running' || status === 'succeeded' || status === 'registered') {
        setAssetLookupNonce((value) => value + 1);
      }
    }).catch(() => {
      // Playback remains available if the audit writeback service is temporarily offline.
    });
  }, [resource?.candidate_id]);

  if (!resource) return null;
  const activeImmutableAsset = immutableAsset?.resourceId === resource.id && immutableAsset.mediaType === resource.media_format ? immutableAsset : null;
  const mediaType = activeImmutableAsset?.mediaType ?? resource.media_format;
  if (!resource.candidate_id || !mediaType || !['hls', 'mp4', 'webm'].includes(mediaType)) return null;

  return (
    <div
      className="home-inline-player fixed inset-0 z-[300] flex items-center justify-center overflow-y-auto bg-black/95 p-3 sm:p-6"
      role="presentation"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section className="w-full max-w-5xl overflow-hidden rounded-2xl border border-white/15 bg-[#101014] text-white shadow-2xl" role="dialog" aria-modal="true" aria-label={`正在播放：${resource.title}`}>
        <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold sm:text-lg">{resource.title}</h2>
            <p className="truncate text-xs text-white/55">{resource.source_name ?? 'LibreTV Registry'} · 已验证资源</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-xl" aria-label="关闭播放器">×</button>
        </header>
        <div className="aspect-video w-full bg-black">
          <PlayerShell
            key={activeImmutableAsset ? `${resource.id}:${activeImmutableAsset.assetId}` : resource.id}
            url={activeImmutableAsset?.url ?? resource.url}
            title={resource.title}
            mediaType={mediaType as 'hls' | 'mp4' | 'webm'}
            onPlaybackConfirmed={confirmPlayback}
            adFilter={adFilter}
            autoplayNext={autoplayNext}
            autoSkipSegments={autoSkipSegments}
            pendingStart={pendingStart}
            onPendingStart={setPendingStart}
            episodeKey={`registry:${resource.id}`}
            dolbyVisionAssetId={activeImmutableAsset?.assetId}
            dolbyVisionSourceKind="registry"
            dolbyVisionSourceIdentity={resource.id}
          />
        </div>
      </section>
    </div>
  );
}
