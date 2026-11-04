import type { CapacitorConfig } from '@capacitor/cli';

const appId = process.env.IOS_BUNDLE_ID || 'com.libretv.friday';
const remoteUrl = process.env.FRIDAY_WEB_URL?.trim();

const config: CapacitorConfig = {
  appId,
  appName: 'Friday',
  webDir: 'native/www',
  bundledWebRuntime: false,
  ...(remoteUrl
    ? {
        server: {
          url: remoteUrl,
          cleartext: false,
          allowNavigation: [new URL(remoteUrl).hostname],
        },
      }
    : {}),
};

export default config;
