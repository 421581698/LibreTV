import { createHash } from 'node:crypto';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { NextResponse } from 'next/server';
vi.mock('@/lib/api-guard',()=>({guardPrivateFeatureRequest:vi.fn(()=>null)}));
vi.mock('@/lib/auth',()=>({isAuthDisabled:vi.fn(()=>false)}));
vi.mock('@/lib/resource-collector-client',()=>({
  fetchDolbyVisionHlsGraph:vi.fn(),fetchDolbyVisionRegistryAsset:vi.fn(),
}));
import { fetchDolbyVisionHlsGraph,fetchDolbyVisionRegistryAsset } from '@/lib/resource-collector-client';
import { isAuthDisabled } from '@/lib/auth';
import { GET } from './route';
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const master='#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-STREAM-INF:BANDWIDTH=600000\nvariant.m3u8\n';
const media='#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:6\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6,\n0.m4s\n#EXT-X-ENDLIST\n';
const mk=(assetId:string,s:string,contentType:string)=>{
 const sha256=digest(s);
 return {assetId,resourceId:'res_1',sha256,byteLength:Buffer.byteLength(s),contentType,
   objectKey:`sha256/${sha256.slice(0,2)}/${sha256}`};
};
const root=mk('root_1',master,'application/vnd.apple.mpegurl');
const variant=mk('var_1',media,'application/vnd.apple.mpegurl');
const init=mk('init_1','init','video/mp4');
const segment=mk('seg_1','abcdefghi','video/iso.segment');
const graph={resourceId:'res_1',graph:{graph_id:'root_1',root_asset_id:'root_1',resource_id:'res_1'},
 rootAsset:root,members:[variant,init,segment],
 edges:[
 {parentAssetId:'root_1',childAssetId:'var_1',relativeUri:'variant.m3u8',role:'playlist',ordinal:0},
 {parentAssetId:'var_1',childAssetId:'init_1',relativeUri:'init.mp4',role:'initialization',ordinal:0},
 {parentAssetId:'var_1',childAssetId:'seg_1',relativeUri:'0.m4s',role:'segment',ordinal:1},
 ]};
function upstream(asset:typeof root,content:string,range?:string){
 const headers:Record<string,string>={'content-type':asset.contentType,'x-dv-asset-id':asset.assetId,
   'x-dv-asset-sha256':asset.sha256,'etag':'"'+asset.sha256+'"','accept-ranges':'bytes',
   'content-length':String(content.length)};
 if(range)headers['content-range']=range;
 return new Response(content,{status:range?206:200,headers});
}
const ctx=(assetId:string,rootAssetId='root_1')=>({params:Promise.resolve({resourceId:'res_1',rootAssetId,assetId})});
const request=(assetId:string,range?:string)=>new Request(
 'https://example.com/api/dolby-vision/resources/res_1/verified-hls/root_1/'+assetId,
 {headers:range?{Range:range}:{}});
beforeEach(()=>{
 vi.mocked(isAuthDisabled).mockReturnValue(false);
 vi.mocked(fetchDolbyVisionHlsGraph).mockImplementation(async () => NextResponse.json(graph));
 vi.mocked(fetchDolbyVisionRegistryAsset).mockImplementation(async () => upstream(root,master));
});
afterEach(()=>vi.clearAllMocks());
describe('authenticated immutable HLS playback gateway',()=>{
 it('rewrites only graph-known VOD playlists after independently hashing root bytes',async()=>{
  const result=await GET(request('root_1'),ctx('root_1'));
  expect(result.status).toBe(200);
  expect(result.headers.get('x-cinema-manifest-source-sha256')).toBe(root.sha256);
  const text=await result.text();
  expect(text).toContain('/api/dolby-vision/resources/res_1/verified-hls/root_1/var_1');
  expect(text).not.toContain('variant.m3u8');
 });
 it('streams exact registered media bytes with checked identity and content length',async()=>{
  vi.mocked(fetchDolbyVisionRegistryAsset).mockResolvedValue(upstream(segment,'abcdefghi'));
  const result=await GET(request('seg_1'),ctx('seg_1'));
  expect(result.status).toBe(200);
  expect(await result.text()).toBe('abcdefghi');
  expect(result.headers.get('x-cinema-playback-bytes')).toBe('registry-verified');
  expect(fetchDolbyVisionRegistryAsset).toHaveBeenCalledWith('seg_1',20000,undefined);
 });
 it('requires byte-accurate single range and correct full immutable asset identity',async()=>{
  vi.mocked(fetchDolbyVisionRegistryAsset).mockResolvedValue(upstream(segment,'abc','bytes 0-2/9'));
  const result=await GET(request('seg_1','bytes=0-2'),ctx('seg_1'));
  expect(result.status).toBe(206);
  expect(result.headers.get('content-range')).toBe('bytes 0-2/9');
  expect(await result.text()).toBe('abc');
  const wrong=upstream(segment,'abc','bytes 2-4/9');
  vi.mocked(fetchDolbyVisionRegistryAsset).mockResolvedValue(wrong);
  expect((await GET(request('seg_1','bytes=0-2'),ctx('seg_1'))).status).toBe(502);
 });
 it('rejects mismatched graph roots, missing assets, tampering and disabled authentication',async()=>{
  expect((await GET(request('root_1'),ctx('root_1','wrong_root'))).status).toBe(409);
  expect((await GET(request('unknown'),ctx('unknown'))).status).toBe(409);
  const changed=upstream(root,master+'#tampered');
  vi.mocked(fetchDolbyVisionRegistryAsset).mockResolvedValue(changed);
  expect((await GET(request('root_1'),ctx('root_1'))).status).toBe(502);
  vi.mocked(isAuthDisabled).mockReturnValue(true);
  expect((await GET(request('root_1'),ctx('root_1'))).status).toBe(503);
 });
});
