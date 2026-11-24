'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const isPlayable = Boolean(
    resource?.candidate_id &&
    resource.media_format &&
    ['hls', 'mp4', 'webm'].includes(resource.media_format),
  );

  useEffect(() => {
    if (!resource || !isPlayable) return;
    const previousOverflow = document.body.style.overflow;
    const activeElement = document.activeElement;
    previousFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !dialog.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !dialog.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      const previousFocus = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [resource?.id, isPlayable]);

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
    }).catch(() => {
      // Playback remains available if the audit writeback service is temporarily offline.
    });
  }, [resource?.candidate_id]);

  if (!resource || !isPlayable) return null;
  const mediaType = resource.media_format;

  return (
    <div
      className="home-inline-player fixed inset-0 z-[300] flex items-center justify-center overflow-y-auto bg-black/95 p-3 sm:p-6"
      role="presentation"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section ref={dialogRef} tabIndex={-1} className="w-full max-w-5xl overflow-hidden rounded-2xl border border-white/15 bg-[#101014] text-white shadow-2xl outline-none" role="dialog" aria-modal="true" aria-label={`正在播放：${resource.title}`}>
        <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold sm:text-lg">{resource.title}</h2>
            <p className="truncate text-xs text-white/55">{resource.source_name ?? 'LibreTV Registry'} · 已验证资源</p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-xl" aria-label="关闭播放器">×</button>
        </header>
        <div className="aspect-video w-full bg-black">
          <PlayerShell
            key={resource.id}
            url={resource.url}
            title={resource.title}
            mediaType={mediaType ?? undefined}
            onPlaybackConfirmed={confirmPlayback}
            adFilter={adFilter}
            autoplayNext={autoplayNext}
            autoSkipSegments={autoSkipSegments}
            pendingStart={pendingStart}
            onPendingStart={setPendingStart}
            episodeKey={`registry:${resource.id}`}
          />
        </div>
      </section>
    </div>
  );
}
