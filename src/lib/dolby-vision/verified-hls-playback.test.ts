import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { parseVerifiedHlsGraph, rewriteVerifiedHlsPlaylist, verifyVerifiedHlsByteHeaders, verifyVerifiedHlsManifestBytes } from './verified-hls-playback';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const resourceId='resource_1', root='root_1', variant='variant_1', init='init_1', segment='seg_1';
const master = '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,CODECS="hvc1.2.4.L120.B0"\nvideo.m3u8\n';
const media = '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:6\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6,\nseg0.m4s\n#EXT-X-ENDLIST\n';
function asset(assetId: string, payload: string, contentType: string) {
  const digest=sha(payload);
  return { assetId, resourceId, sha256:digest, byteLength:Buffer.byteLength(payload), contentType,
    objectKey:`sha256/${digest.slice(0,2)}/${digest}` };
}
const graph = {
  resourceId, graph: { graph_id:root, resource_id:resourceId, root_asset_id:root },
  rootAsset:asset(root,master,'application/vnd.apple.mpegurl'),
  members:[asset(variant,media,'application/vnd.apple.mpegurl'),asset(init,'initbytes','video/mp4'),asset(segment,'segbytes','video/iso.segment')],
  edges:[
    {parentAssetId:root,childAssetId:variant,relativeUri:'video.m3u8',role:'playlist',ordinal:0},
    {parentAssetId:variant,childAssetId:init,relativeUri:'init.mp4',role:'initialization',ordinal:0},
    {parentAssetId:variant,childAssetId:segment,relativeUri:'seg0.m4s',role:'segment',ordinal:1},
  ],
};
describe('registered byte HLS gateway contract',()=>{
  it('rewrites all playable URIs to graph-bound asset IDs, never CMS/CDN URLs',()=>{
    const g=parseVerifiedHlsGraph(graph,resourceId,root);
    expect(g).not.toBeNull();
    const base='/api/dolby-vision/resources/resource_1/verified-hls/root_1';
    expect(rewriteVerifiedHlsPlaylist(g!,root,master,base)).toContain(base+'/variant_1');
    const v=rewriteVerifiedHlsPlaylist(g!,variant,media,base);
    expect(v).toContain('URI="'+base+'/init_1"');
    expect(v).toContain(base+'/seg_1');
    expect(v).not.toContain('seg0.m4s');
  });
  it('rejects graph substitution, detached assets and unsafe external or encrypted references',()=>{
    expect(parseVerifiedHlsGraph({...graph,graph:{...graph.graph,root_asset_id:'different'}},resourceId,root)).toBeNull();
    expect(parseVerifiedHlsGraph({...graph,members:graph.members.slice(0,2)},resourceId,root)).toBeNull();
    const g=parseVerifiedHlsGraph(graph,resourceId,root)!;
    for (const unsafe of [
      media.replace('seg0.m4s','https://other.example/media.m4s'),
      media.replace('seg0.m4s','missing.m4s'),
      media.replace('#EXT-X-ENDLIST','#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-ENDLIST'),
      media.replace('#EXT-X-PLAYLIST-TYPE:VOD',''),
      media.replace('#EXT-X-MAP:URI="init.mp4"','#EXT-X-MAP:URI="https://other.example/init.mp4"'),
    ]) expect(()=>rewriteVerifiedHlsPlaylist(g,variant,unsafe,'/api/hls')).toThrow();
  });
  it('checks upstream ID/hash/length/ETag and independently verifies playlist bytes',()=>{
    const a=graph.rootAsset;
    const response = new Response(master,{headers:{
      'content-type':a.contentType,'content-length':String(a.byteLength),
      'x-dv-asset-id':a.assetId,'x-dv-asset-sha256':a.sha256,'etag':'"'+a.sha256+'"',
      'accept-ranges':'bytes',
    }});
    expect(verifyVerifiedHlsByteHeaders(response,a)).toBe(true);
    expect(verifyVerifiedHlsManifestBytes(new TextEncoder().encode(master),a.sha256)).toBe(true);
    expect(verifyVerifiedHlsManifestBytes(new TextEncoder().encode(master+'X'),a.sha256)).toBe(false);
    response.headers.set('x-dv-asset-sha256','0'.repeat(64));
    expect(verifyVerifiedHlsByteHeaders(response,a)).toBe(false);
  });
});
