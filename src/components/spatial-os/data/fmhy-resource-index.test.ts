import {describe,expect,it} from 'vitest';
import {loadAllFMHYCategories,loadFMHYCategory} from './fmhy-resource-index';
import {FMHY_CATEGORIES} from './fmhy-categories';

describe('FMHY local resource index',()=>{
  it('loads all 13 root categories from local data',async()=>{
    expect(FMHY_CATEGORIES).toHaveLength(13);
    for(const category of FMHY_CATEGORIES){
      const rows=await loadFMHYCategory(category.id);
      expect(rows.length,category.id).toBeGreaterThan(0);
      expect(rows.every(row=>row.categoryId===category.id)).toBe(true);
    }
  });

  it('keeps resource and related destinations on http(s)',async()=>{
    const rows=await loadAllFMHYCategories();
    expect(rows.length).toBeGreaterThan(1000);
    expect(rows.every(row=>!row.flags.section)).toBe(true);
    for(const row of rows){
      expect(()=>new URL(row.url)).not.toThrow();
      expect(['http:','https:']).toContain(new URL(row.url).protocol);
      for(const link of row.links){
        expect(['http:','https:']).toContain(new URL(link.url).protocol);
      }
    }
  });

  it('keeps stable ids unique within each category',async()=>{
    for(const category of FMHY_CATEGORIES){
      const rows=await loadFMHYCategory(category.id);
      expect(new Set(rows.map(row=>row.id)).size).toBe(rows.length);
    }
  });
});
