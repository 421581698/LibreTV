export type QualityEvidence=
 |{kind:'player-decoded';decodedHeight:number;codec?:string;observedAt:number}
 |{kind:'playlist-declared';declaredHeight:number;bandwidth?:number;observedAt:number}
 |{kind:'segment-probe';segmentHeight?:number;bytes?:number;observedAt:number}
 |{kind:'unknown';reason:string};
export interface QualityAssessment{label:string;height:number|null;confidence:'verified'|'indicative'|'unknown';source:QualityEvidence['kind'];}
export function assessQuality(e:QualityEvidence):QualityAssessment{
 if(e.kind==='player-decoded'&&e.decodedHeight>0)return{label:`${e.decodedHeight}p 实际解码`,height:e.decodedHeight,confidence:'verified',source:e.kind};
 if(e.kind==='playlist-declared'&&e.declaredHeight>0)return{label:`${e.declaredHeight}p 清单声明`,height:e.declaredHeight,confidence:'indicative',source:e.kind};
 if(e.kind==='segment-probe'&&e.segmentHeight&&e.segmentHeight>0)return{label:`${e.segmentHeight}p 分片探测`,height:e.segmentHeight,confidence:'indicative',source:e.kind};
 return{label:'画质未知',height:null,confidence:'unknown',source:e.kind};
}
