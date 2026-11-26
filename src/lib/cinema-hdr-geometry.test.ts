import { describe, expect, it } from 'vitest';
import { cinemaCanvasGeometry } from './cinema-hdr-geometry';

const host = { left: 100, top: 50, width: 1000, height: 600 };
const video = { left: 100, top: 50, width: 1000, height: 600 };
describe('Cinema GPU picture geometry', () => {
  it('keeps 16:9 source letterboxed without stretching', () => {
    const g = cinemaCanvasGeometry(video, host, 1920, 1080, 'contain');
    expect(g.width).toBeCloseTo(1000);
    expect(g.height).toBeCloseTo(562.5);
    expect(g.top).toBeCloseTo(18.75);
    expect(g.uvScaleX).toBe(1);
  });
  it('crops only source-visible UV range in cover mode', () => {
    const g = cinemaCanvasGeometry(video, host, 1920, 1080, 'cover');
    expect(g.height).toBe(600);
    expect(g.uvScaleX).toBeCloseTo((1000/600) / (1920/1080));
    expect(g.uvOffsetX).toBeCloseTo((1 - g.uvScaleX)/2);
  });
  it('returns safe geometry for unknown dimensions', () => {
    expect(cinemaCanvasGeometry(video,host,0,0,'contain').width).toBe(1000);
  });
  it('retains pixels for scale-down images smaller than their host', () => {
    const g=cinemaCanvasGeometry(video,host,300,200,'scale-down');
    expect(g.width).toBe(300);
    expect(g.height).toBe(200);
    expect(g.left).toBe(350);
    expect(g.top).toBe(200);
  });
});