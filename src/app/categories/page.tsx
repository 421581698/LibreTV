import { V4HomepageHeader } from '@/components/home/V4HomepageHeader';
import { CategoriesGallery } from '@/components/home/CategoriesGallery';

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
        <CategoriesGallery />
      </main>
    </div>
  );
}
