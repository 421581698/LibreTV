import Link from 'next/link';
import { V4HomepageHeader } from '@/components/home/V4HomepageHeader';

const categories = [
  { href: '/movies', title: '电影', subtitle: '热门、新片与经典电影', icon: 'film' },
  { href: '/tv', title: '电视剧', subtitle: '国产剧与全球剧集', icon: 'tv' },
  { href: '/anime', title: '动漫', subtitle: '当季新番与经典动画', icon: 'sparkles' },
  { href: '/overseas', title: '海外剧', subtitle: '美剧、英剧、韩剧与日剧', icon: 'globe' },
  { href: '/variety', title: '综艺', subtitle: '热门节目与综艺内容', icon: 'clapper' },
  { href: '/live', title: '直播', subtitle: '频道、节目单与直播源', icon: 'radio' },
] as const;

function CategoryIcon({ name }: { name: (typeof categories)[number]['icon'] }) {
  if (name === 'film') return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4m-4 8h4m10-8h4m-4 8h4"/></svg>;
  if (name === 'tv') return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 22h8m-4-4v4"/></svg>;
  if (name === 'sparkles') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z"/></svg>;
  if (name === 'globe') return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>;
  if (name === 'clapper') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h18v13H3zM3 8l2-5h16l-2 5M8 3l3 5m3-5 3 5"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19 5a10 10 0 0 1 0 14M5 19A10 10 0 0 1 5 5"/></svg>;
}

export default function CategoriesPage() {
  return (
    <div className="v4-category-page min-h-screen">
      <V4HomepageHeader />
      <main className="v4-category-main">
        <header className="v4-category-heading">
          <span>LIBRARY</span>
          <h1>分类</h1>
          <p>选择你想看的内容。</p>
        </header>
        <nav className="v4-category-grid" aria-label="影视分类">
          {categories.map((category) => (
            <Link key={category.href} href={category.href} className="v4-category-card">
              <span className="v4-category-icon"><CategoryIcon name={category.icon}/></span>
              <strong>{category.title}</strong>
              <small>{category.subtitle}</small>
              <span className="v4-category-arrow" aria-hidden="true">›</span>
            </Link>
          ))}
        </nav>
      </main>
    </div>
  );
}
