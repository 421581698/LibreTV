import './ipad-edition.css';

const navigation = ['搜索', '首页', '电影', '电视剧', '动漫', '资料库'];
const paths = ['/search', '', '/movies', '/series', '/anime', '/library'];

export const metadata = {
  title: 'LibreTV iPad Edition',
  description: 'LibreTV iPad 独立影院体验',
};

export default function IpadEditionPage() {
  return (
    <div className="ipad-edition" data-ipad-edition="true">
      <aside className="ipad-edition__sidebar" aria-label="iPad 影院导航">
        <div className="ipad-edition__brand">LibreTV</div>
        <nav className="ipad-edition__nav">
          {navigation.map((item, index) => (
            <a
              key={item}
              href={'/ipad-edition' + paths[index]}
              className={index === 1 ? 'is-active' : ''}
              aria-current={index === 1 ? 'page' : undefined}
            >
              {item}
            </a>
          ))}
        </nav>
        <div className="ipad-edition__sidebar-footer">
          <a href="/ipad-edition/settings">设置</a>
          <a href="/ipad-edition/about">关于</a>
        </div>
      </aside>

      <main className="ipad-edition__main">
        <header className="ipad-edition__topbar">
          <button className="ipad-edition__menu" type="button" aria-label="打开导航">☰</button>
          <nav className="ipad-edition__capsule" aria-label="快捷导航">
            {navigation.slice(1, 5).map((item) => {
              const index = navigation.indexOf(item);
              return <a key={item} href={'/ipad-edition' + paths[index]}>{item}</a>;
            })}
          </nav>
          <div className="ipad-edition__top-actions">
            <a href="/ipad-edition/search">搜索</a>
            <a href="/ipad-edition/settings">设置</a>
          </div>
        </header>

        <section className="ipad-edition__hero" aria-labelledby="ipad-edition-title">
          <div className="ipad-edition__hero-copy">
            <p className="ipad-edition__eyebrow">LIBRETV · IPAD EDITION</p>
            <h1 id="ipad-edition-title">影院大堂</h1>
            <p>为 iPad 独立打造的沉浸式影视空间。</p>
            <span className="ipad-edition__foundation-note">独立应用入口与影院布局基础已建立，真实影视内容将在项目二接入。</span>
          </div>
        </section>

        <section className="ipad-edition__content" aria-label="影院内容区域">
          <div className="ipad-edition__section-heading">
            <div>
              <p className="ipad-edition__eyebrow">YOUR CINEMA</p>
              <h2>精选内容</h2>
            </div>
            <span>项目一 · 应用基础</span>
          </div>
          <div className="ipad-edition__empty-state">
            <span className="ipad-edition__empty-mark" aria-hidden="true">✦</span>
            <h3>等待接入真实推荐内容</h3>
            <p>项目一先完成独立入口、导航与视觉基础；不会使用虚构海报填充内容轨道。</p>
          </div>
        </section>
      </main>
    </div>
  );
}
