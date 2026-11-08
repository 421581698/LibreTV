import { describe, expect, it } from 'vitest';
import { FMHY_CATEGORIES } from '@/lib/fmhy-index';

describe('V4 Resource Universe', () => {
  it('uses the 13 categories declared by the official FMHY sitemap', () => {
    expect(FMHY_CATEGORIES).toHaveLength(13);
  });
});
