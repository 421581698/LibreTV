'use client';

import { useEffect, useState } from 'react';
import { buildImageCandidates } from '@/lib/utils';
import { preferOriginalCinemaImage } from '@/lib/ipad-edition/cinema-artwork-policy';
import type { PosterAsset } from '@/lib/poster';
import { matchesArtworkOrientation, meetsMinimumImageWidth } from '@/lib/poster/poster-normalizer';

const DEFAULT_POSTER_SRC =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 450'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop stop-color='%231b2940'/%3E%3Cstop offset='1' stop-color='%23090f1c'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='300' height='450' fill='url(%23g)'/%3E%3Crect x='105' y='165' width='90' height='90' rx='18' fill='none' stroke='%237d91ad' stroke-width='7'/%3E%3Cpath d='M135 185v50l42-25z' fill='%237d91ad'/%3E%3Ctext x='150' y='310' text-anchor='middle' fill='%2393a4bb' font-size='17' font-family='Arial,sans-serif'%3ELibreTV%3C/text%3E%3C/svg%3E";

interface SmartImageProps {
  /** Source-neutral asset metadata; originalUrl remains the only image source. */
  asset?: PosterAsset;
  /** SDR 图片地址；HDR 不可用或加载失败时的可靠回退 */
  url?: string;
  /** 主图候选全部失败后继续尝试的备用图片地址 */
  fallbackUrl?: string;
  /** 可选的独立 HDR / gain-map 图片地址。只有高动态范围显示设备会优先尝试 */
  hdrUrl?: string;
  /** On iPad preserve original image bytes (gain maps / P3 ICC) before any image proxy. */
  preferNativeImage?: boolean;
  mode: 'direct' | 'proxy' | 'custom';
  customProxy?: string;
  alt: string;
  className?: string;
  loading?: 'lazy' | 'eager';
  /** 是否在所有图片候选失败后显示通用海报占位；剧集卡片应关闭并显示自身占位 */
  showDefaultFallback?: boolean;
  /** 候选链耗尽后回调，调用方切换占位图等兜底 UI */
  onExhausted?: () => void;
  /** 仅在需要审计的关键海报上记录浏览器实际解码尺寸。 */
  measureNaturalSize?: boolean;
  /** Reject an image that decodes below the required source width; never upscale it. */
  minimumWidth?: number;
  /** Reject a source whose decoded geometry does not match its artwork slot. */
  expectedOrientation?: 'portrait' | 'landscape';
}

/**
 * 统一海报解码入口：
 * - 原图若内嵌 Ultra HDR / gain map，交给浏览器原生解码，避免 CSS filter 破坏 HDR 高光；
 * - 有独立 HDR 地址时，仅在 dynamic-range: high 设备优先尝试；
 * - HDR 候选失败自动回退 SDR 候选，再回退占位图；
 * - 不对图片像素做 canvas 重绘，避免丢失增益图、广色域和原始细节。
 */
export function SmartImage({
  asset,
  url,
  fallbackUrl,
  hdrUrl,
  preferNativeImage = false,
  mode,
  customProxy = '',
  alt,
  className,
  loading = 'lazy',
  showDefaultFallback = true,
  onExhausted,
  measureNaturalSize = false,
  minimumWidth,
  expectedOrientation,
}: SmartImageProps) {
  const sourceUrl = asset?.originalUrl ?? url;
  const primaryCandidates = preferOriginalCinemaImage(buildImageCandidates(sourceUrl, mode, customProxy), sourceUrl, mode, preferNativeImage);
  const fallbackCandidates = [...new Set(preferOriginalCinemaImage(buildImageCandidates(fallbackUrl, mode, customProxy), fallbackUrl, mode, preferNativeImage))]
    .filter((candidate) => !primaryCandidates.includes(candidate));
  const candidates = [...primaryCandidates, ...fallbackCandidates];
  const hdrCandidates = preferOriginalCinemaImage(buildImageCandidates(hdrUrl, mode, customProxy), hdrUrl, mode, preferNativeImage);
  const [supportsHdr, setSupportsHdr] = useState(false);
  const [hdrFailed, setHdrFailed] = useState(false);
  const [idx, setIdx] = useState(0);
  const [fallback, setFallback] = useState(false);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const useHdrSource = supportsHdr && hdrCandidates.length > 0 && !hdrFailed;
  const activeCandidates = useHdrSource ? hdrCandidates : candidates;
  const noCandidates = activeCandidates.length === 0;
  const showingPlaceholder = fallback || noCandidates;
  const src = showingPlaceholder
    ? (showDefaultFallback ? DEFAULT_POSTER_SRC : undefined)
    : activeCandidates[idx];

  useEffect(() => {
    const query = window.matchMedia('(dynamic-range: high)');
    const update = () => setSupportsHdr(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  // 地址、代理或显示能力变化时重新尝试首选候选
  useEffect(() => {
    setIdx(0);
    setHdrFailed(false);
    setFallback(false);
    if (measureNaturalSize) setNaturalSize(null);
  }, [sourceUrl, fallbackUrl, hdrUrl, mode, customProxy, preferNativeImage, supportsHdr, measureNaturalSize, minimumWidth, expectedOrientation]);

  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      decoding="async"
      data-cinema-image-tier={showingPlaceholder ? 'placeholder' : useHdrSource ? 'explicit-hdr-candidate' : 'source-unverified'}
      referrerPolicy="no-referrer"
      data-natural-width={measureNaturalSize ? naturalSize?.width : undefined}
      data-natural-height={measureNaturalSize ? naturalSize?.height : undefined}
      data-resolution-tier={measureNaturalSize ? (naturalSize ? (naturalSize.width >= (minimumWidth ?? 1200) ? 'meets-minimum-width' : 'below-minimum-width') : 'pending') : undefined}
      onLoad={measureNaturalSize || minimumWidth || expectedOrientation ? (event) => {
        if (showingPlaceholder) return;
        const image = event.currentTarget;
        if (measureNaturalSize) setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
        const widthIsInsufficient = Boolean(minimumWidth && !meetsMinimumImageWidth(image.naturalWidth, minimumWidth));
        const orientationIsWrong = Boolean(expectedOrientation && !matchesArtworkOrientation(image.naturalWidth, image.naturalHeight, expectedOrientation));
        if (widthIsInsufficient || orientationIsWrong) {
          if (measureNaturalSize) setNaturalSize(null);
          // Try the next candidate in the current tier before downgrading.
          if (idx + 1 < activeCandidates.length) {
            setIdx((current) => current + 1);
            return;
          }
          if (useHdrSource) {
            setHdrFailed(true);
            setIdx(0);
            return;
          }
          setFallback(true);
          onExhausted?.();
        }
      } : undefined}
      onError={() => {
        if (measureNaturalSize) setNaturalSize(null);
        if (showingPlaceholder) return;
        if (idx + 1 < activeCandidates.length) {
          setIdx((current) => current + 1);
          return;
        }
        if (useHdrSource) {
          setHdrFailed(true);
          setIdx(0);
          return;
        }
        setFallback(true);
        onExhausted?.();
      }}
    />
  );
}
