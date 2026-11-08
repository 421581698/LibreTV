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
      expect(rows.some(row=>row.flags.section),category.id).toBe(true);
    }
  });

  it('preserves the complete pinned Streaming / Video taxonomy and its nested paths',async()=>{
    const rows=await loadFMHYCategory('video');
    const paths=new Set(rows.map(row=>row.section.filter(Boolean).join(' / ')));
    const expected=[
      'Download Sites',
      'Download Sites / Anime Downloading',
      'Download Sites / Specialty Downloading',
      'Download Sites / Telegram Channels',
      'Helpful Sites / Tools',
      'Live TV / Sports / IPTV Players',
      'Live TV / Sports / IPTV Tools',
      'Live TV / Sports / Live Sports',
      'Live TV / Sports / Live TV',
      'Live TV / Sports / Sports Replays',
      'Smart TV',
      'Smart TV / Android TV / Firestick',
      'Specialty Streaming',
      'Specialty Streaming / Anime Streaming',
      'Specialty Streaming / Cartoon Streaming',
      'Specialty Streaming / Classics / Public Domain',
      'Specialty Streaming / Drama Streaming',
      'Specialty Streaming / Film Archives',
      'Specialty Streaming / TV Streaming',
      'Streaming Apps',
      'Streaming Apps / Anime Streaming Apps',
      'Streaming Sites / Dedicated-Server',
      'Streaming Sites / Free w/ Ads',
      'Streaming Sites / Multi-Server',
      'Streaming Sites / P-Stream Forks',
      'Streaming Sites / Stream Aggregators',
      'Streaming Sites / Stream Lounges',
      'Streaming Sites / Video Streaming',
      'Subtitle Tools',
      'Subtitle Tools / Download Subtitles',
      'Torrent Apps',
      'Torrent Apps / Stremio Tools',
      'Torrent Sites',
      'Torrent Sites / Anime Torrenting',
      'Tracking / Databases',
      'Tracking / Databases / Anime Tracking / Databases',
      'Tracking / Databases / Calendar / Upcoming',
      'Tracking / Databases / Recommendation Tools',
    ];
    expect([...paths].sort()).toEqual(expected.sort());
    expect(rows.length).toBe(914);
    expect(rows.every(row=>row.section.length>0)).toBe(true);
  });

  it('keeps resource and related destinations on http(s)',async()=>{
    const rows=await loadAllFMHYCategories();
    expect(rows.length).toBeGreaterThan(1000);
    expect(rows.some(row=>row.flags.section)).toBe(true);
    expect(rows.every(row=>Array.isArray(row.section))).toBe(true);
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
      expect(row.sourceBlobSha,row.id).toMatch(/^[a-f0-9]{40}$/);
      expect(row.sourceRetrievedAt,row.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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
