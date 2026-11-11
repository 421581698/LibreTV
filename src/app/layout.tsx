import type { Metadata, Viewport } from 'next';
import './globals.css';
import './glass-system.css';
import './eight-screen-glass.css';
import './ipad-glass.css';
import './iphone-glass.css';
// Shared by the homepage header and every V4 spatial channel route.
import './v4-homepage.css';
// Last-loaded contract: identical header surface and navigation on every route.
import './v4-shared-header.css';
// Keep header text and controls contrasted with the active light/dark surface.
import './v4-header-theme.css';
// Final theme layer: keep iOS Safari's bottom safe area in sync with dark mode.
import './theme-safe-area.css';
// Final global contrast layer: dark mode must remain legible on every device and route.
import './theme-global-compat.css';
// Final mobile-only layout contract for LibreTV iPhone Minimal UI V1.0.
import './iphone-minimal-ui.css';
// Final iPhone homepage overrides must win over shared header/theme layers.
import './iphone-home-inline.css';
// Apple-inspired minimal settings surface and multicolor outline category icons.
import './settings-apple-minimal.css';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: {
    default: 'LibreTV - 免费在线视频搜索与观看平台',
    template: '%s - LibreTV',
  },
  description:
    'LibreTV 是一个免费的在线视频搜索平台，无广告、安全，提供来自多个视频源的内容搜索与观看服务，无需注册即可使用。',
  manifest: '/manifest.webmanifest',
  // 图标与门户站（LibreTV-portal）同一套：同一张 artwork 导出的多尺寸 + 根目录 favicon.ico 兜底。
  // 只声明单张 512 时，抓取端只能拿大图缩放，小尺寸下易糊、看起来「没填满」。
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '48x48' },
      { url: '/icons/icon-96.png', sizes: '96x96', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#08080A',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 首屏前同步主题，避免亮暗闪烁 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('libretv-theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=d?'dark':'light';document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=r;var m=document.querySelector('meta[name=\"theme-color\"]');if(m)m.content=d?'#08080A':'#F5F7FA';}catch(e){}})()",
          }}
        />
      </head>
      <body>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
