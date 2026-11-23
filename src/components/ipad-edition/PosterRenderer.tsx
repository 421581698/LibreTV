'use client';
import type { ReactNode } from 'react';
import { SmartImage } from '@/components/smart-image';
import type { PosterAsset } from '@/lib/poster';
export type PosterRendererVariant = 'poster' | 'hero-poster' | 'backdrop' | 'anime' | 'result' | 'continue';
interface PosterRendererProps {
  variant: PosterRendererVariant; asset?: PosterAsset; url?: string; fallbackUrl?: string;
  mode: 'direct' | 'proxy' | 'custom'; customProxy?: string; alt: string;
  loading?: 'lazy' | 'eager'; frameClassName?: string; imageClassName?: string; measureNaturalSize?: boolean; minimumWidth?: number; expectedOrientation?: 'portrait' | 'landscape'; children?: ReactNode;
}
/** One iPad artwork frame; SmartImage remains the only image-loading and fallback path. */
export function PosterRenderer({variant,asset,url,fallbackUrl,mode,customProxy='',alt,loading='lazy',frameClassName='',imageClassName='',measureNaturalSize=false,minimumWidth,expectedOrientation,children}:PosterRendererProps) {
  const classes=['poster-engine','poster-engine--'+variant,frameClassName].filter(Boolean).join(' ');
  const imageClasses=['poster-engine__image',imageClassName].filter(Boolean).join(' ');
  const hasSource=Boolean(asset?.originalUrl||url);
  return <span className={classes} data-poster-provider={asset?.provider??'unknown'} data-poster-kind={asset?.kind??'unknown'} data-poster-variant={variant}>
    {hasSource?<SmartImage asset={asset} url={url} fallbackUrl={fallbackUrl} mode={mode} customProxy={customProxy} alt={alt} loading={loading} className={imageClasses} measureNaturalSize={measureNaturalSize} minimumWidth={minimumWidth} expectedOrientation={expectedOrientation}/>:<span className="poster-engine__fallback" aria-hidden="true">LibreTV</span>}
    {children}
  </span>;
}
