import { describe, expect, it } from 'vitest';
import { refractKnownBackground } from './refraction';

const width = 120;
const height = 64;
const fixture = new Uint8ClampedArray(width * height * 4);
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const index = (y * width + x) * 4;
    fixture[index] = (x * 19 + y * 3) % 256;
    fixture[index + 1] = (x * 7 + y * 23) % 256;
    fixture[index + 2] = (x * 3 + y * 17) % 256;
    fixture[index + 3] = 255;
  }
}

const lens = {
  centerX: 60, centerY: 32, radiusX: 48, radiusY: 24,
  displacement: 22, chromatic: 2,
};

describe('Friday controlled background refraction', () => {
  it('changes actual source pixels when glass displacement is enabled', () => {
    const result = refractKnownBackground(fixture, width, height, lens);
    expect(result.changedPixels).toBeGreaterThan(0);
    expect(result.pixels).not.toEqual(fixture);
    expect(fixture[0]).toBe(0);
  });

  it('remains bit identical when optics are disabled', () => {
    const result = refractKnownBackground(fixture, width, height, { ...lens, displacement: 0 });
    expect(result.changedPixels).toBe(0);
    expect(result.pixels).toEqual(fixture);
  });

  it('preserves outside-lens pixels, transparency and original source', () => {
    const result = refractKnownBackground(fixture, width, height, lens);
    expect(result.pixels.slice(0, width * 4)).toEqual(fixture.slice(0, width * 4));
    for (let i = 3; i < fixture.length; i += 4) {
      expect(result.pixels[i]).toBe(fixture[i]);
    }
  });

  it('rejects malformed source buffers and lens geometry', () => {
    expect(() => refractKnownBackground(fixture, width, height + 1, lens)).toThrow();
    expect(() => refractKnownBackground(fixture, width, height, { ...lens, radiusX: 0 })).toThrow();
  });
});
