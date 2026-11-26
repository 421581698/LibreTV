/**
 * Bounded HDR10+ (SMPTE ST 2094-40, Application 4) ITU-T T.35 payload parser.
 * Data begins with B5 003C 0001 04 01. The bitstream grammar follows
 * CTA-861-H/FFmpeg's public interoperability format, not FFmpeg source code.
 *
 * This parses metadata bytes, but does NOT independently prove the bytes
 * belong to the selected HLS rendition or decoded frame. A trusted demux
 * must supply verified immutable source identity and sample PTS separately.
 */
export interface CinemaHdr10PlusWindow {
  maxSclNits:readonly [number,number,number];
  averageMaxRgbNits:number;
  distribution:readonly {percentage:number;luminanceNits:number}[];
  fractionBrightPixels:number;
  kneeX:number|null;
  kneeY:number|null;
  bezierAnchors:readonly number[];
  colorSaturationWeight:number|null;
}
export interface CinemaHdr10PlusPayload {
  applicationVersion:1;
  targetedDisplayNits:number;
  windowCount:number;
  windows:readonly CinemaHdr10PlusWindow[];
  bytesRead:number;
}
class Bits {
  private cursor=0;
  constructor(private readonly data:Uint8Array){}
  take(n:number):number {
    if(!Number.isSafeInteger(n)||n<1||n>27||
       this.cursor+n>this.data.length*8) throw new Error('HDR10+ truncated or invalid bitstream');
    let value=0;
    for(let k=0;k<n;k++){
      const bit=this.cursor++;
      value=value*2+((this.data[bit>>>3]>>>(7-(bit&7)))&1);
    }
    return value;
  }
  skip(n:number):void {
    if(!Number.isSafeInteger(n)||n<0||this.cursor+n>this.data.length*8) {
      throw new Error('HDR10+ invalid metadata geometry or grid');
    }
    this.cursor+=n;
  }
  get remaining():number {return this.data.length*8-this.cursor;}
  get position():number {return this.cursor;}
}
function skipLuminanceGrid(reader:Bits):void {
  const rows=reader.take(5),cols=reader.take(5);
  if(rows<2||rows>25||cols<2||cols>25) throw new Error('HDR10+ invalid luminance grid');
  reader.skip(rows*cols*4);
}
export function cinemaParseHdr10PlusT35(data:Uint8Array):CinemaHdr10PlusPayload {
  if(!(data instanceof Uint8Array)||data.length<21||data.length>16384)
    throw new Error('HDR10+ registered payload length outside safe bounds');
  const header=[0xb5,0x00,0x3c,0x00,0x01,0x04,0x01];
  if(header.some((byte,index)=>data[index]!==byte))
    throw new Error('Not supported HDR10+ application 4 version 1 registered payload');
  const bits=new Bits(data.subarray(7));
  const windowCount=bits.take(2);
  if(windowCount<1||windowCount>3) throw new Error('HDR10+ invalid window count');
  for(let w=1;w<windowCount;w++)bits.skip(153);
  const targetedDisplayNits=bits.take(27);
  if(targetedDisplayNits<=0||targetedDisplayNits>10000)
    throw new Error('HDR10+ invalid targeted peak luminance');
  if(bits.take(1))skipLuminanceGrid(bits);
  const windows:Array<{
    maxSclNits:readonly [number,number,number];
    averageMaxRgbNits:number;
    distribution:Array<{percentage:number;luminanceNits:number}>;
    fractionBrightPixels:number;
    kneeX:number|null;
    kneeY:number|null;
    bezierAnchors:number[];
    colorSaturationWeight:number|null;
  }>=[];
  for(let w=0;w<windowCount;w++){
    const rawMax:[number,number,number]=[bits.take(17),bits.take(17),bits.take(17)];
    const average=bits.take(17);
    if(rawMax.some(n=>n>100000)||average>100000)throw new Error('HDR10+ invalid MaxSCL luminance');
    const distribution=[];
    const count=bits.take(4);
    let previousPercentage=-1;
    for(let k=0;k<count;k++){
      const percentage=bits.take(7),value=bits.take(17);
      if(percentage>100||percentage<=previousPercentage||value>100000)
        throw new Error('HDR10+ invalid distribution percentile');
      distribution.push({percentage,luminanceNits:value/10});
      previousPercentage=percentage;
    }
    const fractionBrightPixels=bits.take(10)/1000;
    if(fractionBrightPixels>1)throw new Error('HDR10+ invalid fraction bright');
    windows.push({
      maxSclNits:rawMax.map(v=>v/10) as [number,number,number],
      averageMaxRgbNits:average/10,
      distribution,fractionBrightPixels,
      kneeX:null,kneeY:null,bezierAnchors:[],colorSaturationWeight:null,
    });
  }
  if(bits.take(1))skipLuminanceGrid(bits);
  for(const window of windows){
    if(bits.take(1)){
      window.kneeX=bits.take(12)/4095;
      window.kneeY=bits.take(12)/4095;
      const count=bits.take(4);
      for(let i=0;i<count;i++)window.bezierAnchors.push(bits.take(10)/1023);
    }
    if(bits.take(1))window.colorSaturationWeight=bits.take(6)/8;
  }
  // Only allow 0-7 final padding bits, all zero; reject concatenated payload
  // substitution or unknown trailing unparsed metadata.
  if(bits.remaining>7)throw new Error('HDR10+ unexpected trailing data');
  if(bits.remaining>0&&bits.take(bits.remaining)!==0)throw new Error('HDR10+ nonzero padding');
  return {
    applicationVersion:1,targetedDisplayNits,windowCount,
    windows,bytesRead:7+Math.ceil(bits.position/8),
  };
}
