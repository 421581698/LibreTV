/**
 * Deterministic, source-aware refraction for Friday's controlled Glass Lab.
 * This deliberately samples only a background the application owns. Web
 * browsers do not expose arbitrary pixels underneath an unrelated DOM node.
 * The pixel-difference count makes the controlled refraction observable.
 */
export interface RefractionLens {
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
  displacement: number;
  chromatic: number;
}

export interface RefractionResult {
  pixels: Uint8ClampedArray;
  changedPixels: number;
}

const clamp = (value: number, max: number) => Math.min(max - 1, Math.max(0, Math.round(value)));

export function refractKnownBackground(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  lens: RefractionLens,
): RefractionResult {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 1 || height < 1 || source.length !== width * height * 4 ||
      !Number.isFinite(lens.radiusX) || !Number.isFinite(lens.radiusY) ||
      lens.radiusX <= 0 || lens.radiusY <= 0) {
    throw new Error('Invalid Friday refraction buffer or lens');
  }
  const pixels = new Uint8ClampedArray(source);
  if (!Number.isFinite(lens.displacement) || lens.displacement <= 0) {
    return { pixels, changedPixels: 0 };
  }
  const displacement = Math.min(30, lens.displacement);
  const chromatic = Number.isFinite(lens.chromatic) ? Math.max(0, Math.min(4, lens.chromatic)) : 0;
  const minX = Math.max(0, Math.floor(lens.centerX - lens.radiusX));
  const maxX = Math.min(width - 1, Math.ceil(lens.centerX + lens.radiusX));
  const minY = Math.max(0, Math.floor(lens.centerY - lens.radiusY));
  const maxY = Math.min(height - 1, Math.ceil(lens.centerY + lens.radiusY));
  let changedPixels = 0;

  const sample = (x: number, y: number, channel: number) =>
    source[(clamp(y, height) * width + clamp(x, width)) * 4 + channel];

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const nx = (x - lens.centerX) / lens.radiusX;
      const ny = (y - lens.centerY) / lens.radiusY;
      const radial = nx * nx + ny * ny;
      if (radial >= 1) continue;
      // A glass-like rim creates a stronger distortion than the optical center.
      const rim = Math.pow(radial, 1.35) * (1 - Math.pow(radial, 5)) + .055;
      const offsetX = nx * displacement * rim;
      const offsetY = ny * displacement * rim;
      const index = (y * width + x) * 4;
      const sx = x + offsetX;
      const sy = y + offsetY;
      const red = sample(sx + chromatic * rim, sy, 0);
      const green = sample(sx, sy, 1);
      const blue = sample(sx - chromatic * rim, sy, 2);
      if (red !== source[index] || green !== source[index + 1] || blue !== source[index + 2]) {
        changedPixels += 1;
      }
      pixels[index] = red;
      pixels[index + 1] = green;
      pixels[index + 2] = blue;
    }
  }
  return { pixels, changedPixels };
}
