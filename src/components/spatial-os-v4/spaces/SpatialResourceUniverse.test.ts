import { describe, expect, it } from 'vitest';
import { spatialResourceCategoryCount } from './SpatialResourceUniverse';

describe('V4 Resource Universe', () => {
  it('uses the 13 categories declared by the official FMHY sitemap', () => {
    expect(spatialResourceCategoryCount).toBe(13);
  });
});
