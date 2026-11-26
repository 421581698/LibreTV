import {describe,expect,it,vi} from 'vitest';
import {cinemaPackP010,createCinemaP010VideoFrameRenderer} from './cinema-v51-frame-renderer';
const frame={
  range:'limited' as const,width:2,height:2,y:Uint16Array.from([64<<6,200<<6,400<<6,940<<6]),
  uv:Uint16Array.from([512<<6,512<<6]),
};
class FakeFrame {
  static created:FakeFrame[]=[];
  timestamp:number;
  closed=false;
  format:string;
  colorSpace:unknown;
  constructor(data:BufferSource,info:{timestamp:number;format:string;colorSpace:unknown}){
    if((data as ArrayBufferView).byteLength!==12)throw new Error('invalid buffer');
    this.timestamp=info.timestamp;this.format=info.format;this.colorSpace=info.colorSpace;
    FakeFrame.created.push(this);
  }
  close(){this.closed=true;}
}
describe('Cinema true P010 VideoFrame presentation adapter',()=>{
 it('packs exact 16-bit high-aligned sample bytes without an RGBA8 conversion',()=>{
  const packed=cinemaPackP010(frame);
  expect(packed.byteLength).toBe(12);
  const data=new DataView(packed.buffer);
  expect(data.getUint16(0,true)).toBe(64<<6);
  expect(data.getUint16(8,true)).toBe(512<<6);
 });
 it('constructs a PQ/BT2020 10-bit VideoFrame with the decoded presentation timestamp',async()=>{
  const present=vi.fn(async()=>true);
  const renderer=createCinemaP010VideoFrameRenderer({
    transfer:'pq',primaries:'bt2020',onPresent:present,
  },FakeFrame as never);
  expect(await renderer.render(frame,710001)).toBe(true);
  expect(FakeFrame.created.at(-1)?.format).toBe('P010');
  expect(FakeFrame.created.at(-1)?.colorSpace).toEqual({
    primaries:'bt2020',transfer:'smpte2084',matrix:'bt2020-ncl',fullRange:false,
  });
  expect(FakeFrame.created.at(-1)?.closed).toBe(true);
  expect(await renderer.render(frame,710001)).toBe(false);
  renderer.stop();
  expect(await renderer.render(frame,720001)).toBe(false);
 });
 it('fails closed on unsupported output and rejected upload',async()=>{
  const failed=createCinemaP010VideoFrameRenderer({transfer:'hlg',primaries:'bt2020'},FakeFrame as never);
  expect(await failed.render(frame,1)).toBe(false);
  const noRenderer=createCinemaP010VideoFrameRenderer({transfer:'sdr',primaries:'bt709',onPresent:async()=>true},null);
  expect(await noRenderer.render(frame,1)).toBe(false);
  const rejected=createCinemaP010VideoFrameRenderer({transfer:'pq',primaries:'bt2020',onPresent:async()=>false},FakeFrame as never);
  expect(await rejected.render(frame,1)).toBe(false);
  expect(FakeFrame.created.at(-1)?.closed).toBe(true);
 });
 it('rejects nonaligned samples before allocating P010 VideoFrames',()=>{
  expect(()=>cinemaPackP010({...frame,y:new Uint16Array([1,2,3,4])})).toThrow();
 });
});
