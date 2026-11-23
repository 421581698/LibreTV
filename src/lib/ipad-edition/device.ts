export type DeviceSignals = {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
};

/** Recognizes iPadOS desktop-mode devices without relying on pointer precision. */
export function isIpadEditionDevice(device: DeviceSignals): boolean {
  if (/iPhone|iPod/i.test(device.userAgent)) return false;
  if (/iPad/i.test(device.userAgent)) return true;
  return device.platform === 'MacIntel' && device.maxTouchPoints > 1;
}
