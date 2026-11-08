import type {PanelDock,PanelRect,SpatialPanel,SpatialSnapshot} from '../core/types';
export const SPATIAL_PANELS:SpatialPanel[]=['search','sources','quality','tasks','history','settings'];
const DEFAULT_RECT:Omit<PanelRect,'zIndex'>={x:8,y:12,width:360,height:520,dock:'floating',minimized:false};
export function bringPanelToFront(state:SpatialSnapshot,panel:SpatialPanel):SpatialSnapshot {
 if(!SPATIAL_PANELS.includes(panel))return state;
 const order=[...state.panelOrder.filter(item=>item!==panel),panel];
 const zIndex=Math.max(20,...Object.values(state.panelLayouts).map(rect=>rect?.zIndex??0))+1;
 return {...state,focusedPanel:panel,panelOrder:order,panelLayouts:{...state.panelLayouts,[panel]:{...(state.panelLayouts[panel]??DEFAULT_RECT),zIndex}},updatedAt:Date.now()};
}
export function setExpandedPanel(state:SpatialSnapshot,panel:SpatialPanel|null):SpatialSnapshot {
 if(panel!==null&&!SPATIAL_PANELS.includes(panel))return state;
 if(panel===null)return {...state,expandedPanel:null,focusedPanel:null,updatedAt:Date.now()};
 const focused=bringPanelToFront(state,panel);
 return {...focused,expandedPanel:panel,focusedPanel:panel};
}
export function setPanelDock(state:SpatialSnapshot,panel:SpatialPanel,dock:PanelDock):SpatialSnapshot {
 if(!SPATIAL_PANELS.includes(panel)||!['floating','left','right','bottom'].includes(dock))return state;
 const current=state.panelLayouts[panel]??{...DEFAULT_RECT,zIndex:20};
 const rect:PanelRect=dock==='left'?{...current,x:0,y:0,width:Math.min(420,current.width),height:1000,dock}
  :dock==='right'?{...current,x:0,y:0,width:Math.min(420,current.width),height:1000,dock}
  :dock==='bottom'?{...current,x:0,y:0,width:1000,height:Math.min(420,current.height),dock}
  :{...current,dock};
 return {...state,panelLayouts:{...state.panelLayouts,[panel]:rect},updatedAt:Date.now()};
}
export function setPanelRect(state:SpatialSnapshot,panel:SpatialPanel,rect:Partial<PanelRect>):SpatialSnapshot {
 if(!SPATIAL_PANELS.includes(panel))return state;
 const current=state.panelLayouts[panel]??{...DEFAULT_RECT,zIndex:20};
 const next:PanelRect={...current,...rect,x:Math.max(0,rect.x??current.x),y:Math.max(0,rect.y??current.y),width:Math.max(240,rect.width??current.width),height:Math.max(160,rect.height??current.height)};
 return {...state,panelLayouts:{...state.panelLayouts,[panel]:next},updatedAt:Date.now()};
}
export function placePanelAvoidingOverlap(state:SpatialSnapshot,panel:SpatialPanel,viewport:{width:number;height:number}):SpatialSnapshot {
 const current=state.panelLayouts[panel]??{...DEFAULT_RECT,zIndex:20};
 const width=Math.min(current.width,Math.max(240,viewport.width-24));
 const height=Math.min(current.height,Math.max(160,viewport.height-24));
 const candidates=[{x:12,y:12},{x:viewport.width-width-12,y:12},{x:12,y:viewport.height-height-12},{x:viewport.width-width-12,y:viewport.height-height-12},{x:(viewport.width-width)/2,y:(viewport.height-height)/2}];
 const occupied=Object.entries(state.panelLayouts).filter(([id,rect])=>id!==panel&&!rect?.minimized).map(([,rect])=>rect!);
 const score=(x:number,y:number)=>occupied.reduce((total,r)=>{const overlap=Math.max(0,Math.min(x+width,r.x+r.width)-Math.max(x,r.x))*Math.max(0,Math.min(y+height,r.y+r.height)-Math.max(y,r.y));return total+overlap;},0);
 const best=candidates.sort((a,b)=>score(a.x,a.y)-score(b.x,b.y))[0];
 return setPanelRect(state,panel,{x:Math.max(0,best.x),y:Math.max(0,best.y),width,height,dock:'floating'});
}
