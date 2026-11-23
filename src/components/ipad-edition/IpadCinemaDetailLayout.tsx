'use client';

import type { ReactNode } from 'react';
import { SmartImage } from '@/components/smart-image';

type IpadCinemaDetailLayoutProps = {
  title: string;
  eyebrow: string;
  backdropUrl?: string;
  posterUrl?: string;
  backdropFallbackUrl?: string;
  imageMode: 'direct' | 'proxy' | 'custom';
  customImageProxy?: string;
  originalTitle?: string;
  metadata?: ReactNode;
  overview?: string;
  actions: ReactNode;
  onBack: () => void;
  children?: ReactNode;
};

/**
 * The single visual shell for every iPad Edition title detail route.
 * Providers keep their own metadata/playback lookup, but never own page layout.
 */
export function IpadCinemaDetailLayout({
  title,
  eyebrow,
  backdropUrl,
  posterUrl,
  backdropFallbackUrl,
  imageMode,
  customImageProxy,
  originalTitle,
  metadata,
  overview,
  actions,
  onBack,
  children,
}: IpadCinemaDetailLayoutProps) {
  return (
    <main className="ipad-cinema-detail" data-ipad-detail-page="true">
      <section className="ipad-cinema-hero" aria-label={title}>
        {posterUrl ? (
          <SmartImage
            url={posterUrl}
            mode={imageMode}
            customProxy={customImageProxy}
            alt=""
            loading="eager"
            className="ipad-cinema-hero__poster"
            minimumWidth={1000}
            expectedOrientation="portrait"
            showDefaultFallback={false}
          />
        ) : null}
        {backdropUrl ? (
          <SmartImage
            url={backdropUrl}
            fallbackUrl={backdropFallbackUrl}
            mode={imageMode}
            customProxy={customImageProxy}
            alt=""
            loading="eager"
            className="ipad-cinema-hero__image"
            minimumWidth={1600}
            expectedOrientation="landscape"
            showDefaultFallback={false}
          />
        ) : !posterUrl ? (
          <div className="ipad-cinema-hero__placeholder">暂无影片海报</div>
        ) : null}
        <div className="ipad-cinema-hero__shade" aria-hidden="true" />
        <header className="ipad-cinema-hero__header">
          <button type="button" onClick={onBack} className="ipad-cinema-back" aria-label="返回">‹</button>
          <span>LIBRETV CINEMA</span>
        </header>
        <div className="ipad-cinema-hero__content">
          <div className="ipad-cinema-kicker">{eyebrow}</div>
          <h1>{title}</h1>
          {originalTitle && originalTitle !== title ? <p className="ipad-cinema-original">{originalTitle}</p> : null}
          {metadata ? <div className="ipad-cinema-meta">{metadata}</div> : null}
          {overview ? <p className="ipad-cinema-overview">{overview}</p> : null}
          <div className="ipad-cinema-actions">{actions}</div>
        </div>
        <div className="ipad-cinema-bottom-fade" aria-hidden="true" />
      </section>
      <div className="ipad-cinema-details">{children}</div>
    </main>
  );
}
