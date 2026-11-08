'use client';

const RESOURCE_CATEGORIES = [
  { id: 'adblocking', title: '广告拦截 / 隐私', sourceTitle: 'Adblocking / Privacy', href: 'https://freemediaheckyeah.org/categories/adblocking/' },
  { id: 'ai', title: '人工智能', sourceTitle: 'Artificial Intelligence', href: 'https://freemediaheckyeah.org/categories/ai/' },
  { id: 'streaming', title: '影视 / 电视 / 动漫', sourceTitle: 'Movies / TV / Anime', href: 'https://freemediaheckyeah.org/categories/streaming/' },
  { id: 'music', title: '音乐 / 播客 / 广播', sourceTitle: 'Music / Podcasts / Radio', href: 'https://freemediaheckyeah.org/categories/music/' },
  { id: 'gaming', title: '游戏 / 模拟器', sourceTitle: 'Gaming / Emulation', href: 'https://freemediaheckyeah.org/categories/gaming/' },
  { id: 'reading', title: '书籍 / 漫画 / Manga', sourceTitle: 'Books / Comics / Manga', href: 'https://freemediaheckyeah.org/categories/reading/' },
  { id: 'downloading', title: '下载工具', sourceTitle: 'Downloading', href: 'https://freemediaheckyeah.org/categories/downloading/' },
  { id: 'torrenting', title: 'BT / Torrent', sourceTitle: 'Torrenting', href: 'https://freemediaheckyeah.org/categories/torrenting/' },
  { id: 'educational', title: '教育资源', sourceTitle: 'Educational', href: 'https://freemediaheckyeah.org/categories/educational/' },
  { id: 'mobile', title: 'Android / iOS', sourceTitle: 'Android / iOS', href: 'https://freemediaheckyeah.org/categories/mobile/' },
  { id: 'linux-macos', title: 'Linux / macOS', sourceTitle: 'Linux / macOS', href: 'https://freemediaheckyeah.org/categories/linux-macos/' },
  { id: 'non-english', title: '非英语资源', sourceTitle: 'Non-English', href: 'https://freemediaheckyeah.org/categories/non-english/' },
  { id: 'tools', title: '其他工具', sourceTitle: 'Miscellaneous Tools', href: 'https://freemediaheckyeah.org/categories/tools/' },
] as const;

export function SpatialResourceUniverse() {
  return (
    <section className="spatial-v4-space-content" aria-labelledby="spatial-resources-title">
      <div className="spatial-v4-space-heading">
        <p className="spatial-v4-space-eyebrow">RESOURCE UNIVERSE · FMHY</p>
        <h1 id="spatial-resources-title">资源宇宙</h1>
        <p>按 FMHY 官方目录的 13 个分类浏览。分类名称与入口保留来源语义；资源详情、站点搜索和书签仍在 FMHY 官方目录中管理。</p>
      </div>
      <div className="spatial-v4-resource-grid">
        {RESOURCE_CATEGORIES.map((category, index) => (
          <a
            className="spatial-v4-resource-card"
            href={category.href}
            key={category.id}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="spatial-v4-resource-index">{String(index + 1).padStart(2, '0')}</span>
            <span className="spatial-v4-resource-title">{category.title}</span>
            <span className="spatial-v4-resource-source">{category.sourceTitle}</span>
            <span className="spatial-v4-resource-open" aria-hidden="true">↗</span>
          </a>
        ))}
      </div>
      <p className="spatial-v4-source-note">目录来源：<a href="https://freemediaheckyeah.org/sitemap/" target="_blank" rel="noopener noreferrer">FMHY 官方 Sitemap</a>。分类与条目可能随上游更新；点击后在新页面打开原始资源目录。</p>
    </section>
  );
}

export const spatialResourceCategoryCount = RESOURCE_CATEGORIES.length;
