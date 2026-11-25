import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IpadCinemaDetailLayout } from './IpadCinemaDetailLayout';

const base = {
  title: '蜘蛛侠：崭新之日',
  eyebrow: 'FEATURE FILM',
  imageMode: 'direct' as const,
  metadata: <span>2026</span>,
  overview: '影片的完整简介。',
  actions: <button type="button">开始播放</button>,
  onBack: () => {},
};

describe('iPad Cinema Detail V3 shell', () => {
  it('keeps the original text title and existing actions when no logo exists', () => {
    const html = renderToStaticMarkup(<IpadCinemaDetailLayout {...base} />);
    expect(html).toContain('蜘蛛侠：崭新之日');
    expect(html).toContain('开始播放');
    // Overflow is measured on the client; no unnecessary More button during SSR.
    expect(html).not.toContain('ipad-cinema-overview-toggle');
    expect(html).not.toContain('ipad-cinema-title-logo');
  });

  it('shows a transparent title artwork slot and lower-right credits when available', () => {
    const html = renderToStaticMarkup(
      <IpadCinemaDetailLayout
        {...base}
        titleLogoUrl="https://image.tmdb.org/t/p/w500/logo.png"
        credits={<p><span>导演</span>影片导演</p>}
      />,
    );
    expect(html).toContain('ipad-cinema-title-logo');
    expect(html).toContain('ipad-cinema-title--logo');
    expect(html).toContain('ipad-cinema-hero-credits');
    expect(html).toContain('影片导演');
    expect(html).toContain('开始播放');
  });
});
