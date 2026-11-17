export type DeviceSignals = {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
};

/**
 * iPad class, including iPadOS desktop mode (Macintosh UA + MacIntel + touch).
 * Pointer type is intentionally not a gate: a Magic Keyboard reports a fine pointer.
 * iPhone and desktop Mac/PC stay outside this check.
 */
export function isIpadClassDevice(device: DeviceSignals): boolean {
  if (/iPhone|iPod/i.test(device.userAgent)) return false;
  if (/iPad/i.test(device.userAgent)) return true;
  return device.platform === 'MacIntel' && device.maxTouchPoints > 1;
}
