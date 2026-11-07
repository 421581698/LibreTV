export function getSigilParticleCount(width: number): number {
  if (width < 80) return 80;
  if (width < 420) return 240;
  return 520;
}

export function getSigilFrameInterval(width: number, reducedMotion: boolean): number {
  if (reducedMotion) return 100;
  return width < 600 ? 1000 / 30 : 1000 / 45;
}
