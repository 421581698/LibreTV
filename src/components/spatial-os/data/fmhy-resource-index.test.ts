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

  it('preserves an immutable upstream revision and retrieval date for every category',async()=>{
    const rows=await loadAllFMHYCategories();
    for(const row of rows){
      expect(row.sourceRevision,row.id).toMatch(/^[a-f0-9]{40}$/);
      expect(row.sourceRetrievedAt,row.id).toMatch(/^\\d{4}-\\d{2}-\\d{2}$/);
      expect(row.sourcePath,row.id).toBe(`docs/${row.categoryId}.md`);
      expect(row.sourcePage,row.id).toBe(`https://github.com/fmhy/edit/blob/${row.sourceRevision}/${row.sourcePath}`);
    }
  });

  it('keeps related link labels present for display',async()=>{
    const rows=await loadAllFMHYCategories();
    for(const row of rows){
      expect(row.links.every(link=>link.label.trim().length>0),row.id).toBe(true);
    }
  });

  it('keeps stable ids unique within each category',async()=>{
    for(const category of FMHY_CATEGORIES){
      const rows=await loadFMHYCategory(category.id);
      expect(new Set(rows.map(row=>row.id)).size).toBe(rows.length);
    }
  });
});
