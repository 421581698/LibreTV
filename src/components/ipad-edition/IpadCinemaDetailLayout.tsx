'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  titleLogoUrl?: string;
  credits?: ReactNode;
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
  titleLogoUrl,
  credits,
  metadata,
  overview,
  actions,
  onBack,
  children,
}: IpadCinemaDetailLayoutProps) {
  const displayTitle = title.replace(/([：:])\s+/g, '$1');
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const [overviewCanExpand, setOverviewCanExpand] = useState(false);
  const overviewRef = useRef<HTMLParagraphElement>(null);
  const [unavailableLogoUrl, setUnavailableLogoUrl] = useState('');
  const showLogo = Boolean(titleLogoUrl && unavailableLogoUrl !== titleLogoUrl);

  useEffect(() => {
    if (!overview || overviewExpanded || !overviewRef.current) return;
    const paragraph = overviewRef.current;
    const measure = () => setOverviewCanExpand(paragraph.scrollHeight > paragraph.clientHeight + 1);
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(paragraph);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [overview, overviewExpanded]);

  return (
    <main className="ipad-cinema-detail" data-ipad-detail-page="true">
      <section className="ipad-cinema-hero" aria-label={displayTitle}>
        {posterUrl ? (
          <SmartImage
            url={posterUrl}
            preferNativeImage
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
            preferNativeImage
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
        <div className={overviewExpanded ? 'ipad-cinema-hero__content is-overview-expanded' : 'ipad-cinema-hero__content'}>
          <div className="ipad-cinema-kicker">{eyebrow}</div>
          <h1 className={showLogo ? 'ipad-cinema-title--logo' : undefined}>
            {showLogo ? (
              <SmartImage
                url={titleLogoUrl}
                preferNativeImage
                mode={imageMode}
                customProxy={customImageProxy}
                className="ipad-cinema-title-logo"
                alt={displayTitle}
                loading="eager"
                showDefaultFallback={false}
                minimumWidth={180}
                onExhausted={() => setUnavailableLogoUrl(titleLogoUrl || '')}
              />
            ) : displayTitle}
          </h1>
          {originalTitle && originalTitle !== title ? <p className="ipad-cinema-original">{originalTitle}</p> : null}
          {metadata ? <div className="ipad-cinema-meta">{metadata}</div> : null}
          {overview ? (
            <div className="ipad-cinema-overview-wrap">
              <p ref={overviewRef} className={overviewExpanded ? 'ipad-cinema-overview is-expanded' : 'ipad-cinema-overview'}>{overview}</p>
              {overviewCanExpand ? (
                <button type="button" className="ipad-cinema-overview-toggle" aria-expanded={overviewExpanded} onClick={() => setOverviewExpanded((current) => !current)}>
                  {overviewExpanded ? '收起' : '更多 ›'}
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="ipad-cinema-actions">{actions}</div>
        </div>
        {credits ? <aside className="ipad-cinema-hero-credits" aria-label="演职员">{credits}</aside> : null}
        <div className="ipad-cinema-bottom-fade" aria-hidden="true" />
      </section>
      <div className="ipad-cinema-details">{children}</div>
    </main>
  );
}
