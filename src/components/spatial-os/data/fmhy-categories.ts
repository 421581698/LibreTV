/** 13 个顶级分类取自 FMHY 官方目录；不把 Streaming 子页误当作顶级分类。 */
export const FMHY_CATEGORIES = [
  { id: 'privacy', title: 'Adblocking / Privacy', zh: '广告拦截与隐私', href: 'https://fmhy.fyi/' },
  { id: 'ai', title: 'Artificial Intelligence', zh: '人工智能', href: 'https://fmhy.fyi/' },
  { id: 'video', title: 'Movies / TV / Anime', zh: '影视 / 动漫', href: 'https://fmhy.fyi/' },
  { id: 'music', title: 'Music / Podcasts / Radio', zh: '音乐 / 播客 / 电台', href: 'https://fmhy.fyi/' },
  { id: 'gaming', title: 'Gaming / Emulation', zh: '游戏 / 模拟器', href: 'https://fmhy.fyi/' },
  { id: 'books', title: 'Books / Comics / Manga', zh: '电子书 / 漫画', href: 'https://fmhy.fyi/' },
  { id: 'downloading', title: 'Downloading', zh: '下载资源', href: 'https://fmhy.fyi/' },
  { id: 'torrenting', title: 'Torrenting', zh: 'BT / P2P', href: 'https://fmhy.fyi/' },
  { id: 'education', title: 'Educational', zh: '教育 / 学习', href: 'https://fmhy.fyi/' },
  { id: 'mobile', title: 'Android / iOS', zh: '移动设备', href: 'https://fmhy.fyi/' },
  { id: 'linux', title: 'Linux / macOS', zh: 'Linux / macOS', href: 'https://fmhy.fyi/' },
  { id: 'languages', title: 'Non-English', zh: '多语言资源', href: 'https://fmhy.fyi/' },
  { id: 'misc', title: 'Miscellaneous Tools', zh: '其他工具', href: 'https://fmhy.fyi/' },
] as const;
