'use client';
import {useEffect,useRef} from 'react';
import {SpatialPanelContent} from './SpatialPanelContent';
import type {CSSProperties} from 'react';
import type {PanelDock,SpatialPanel} from './core/types';
import {spatialStateStore,useSpatialState} from './runtime/SpatialStateStore';
const PANELS:{id:SpatialPanel;label:string;description:string}[]=[
 {id:'search',label:'搜索',description:'自然语言意图与影视搜索入口'},
 {id:'sources',label:'资源',description:'影视来源与资源目录入口'},
 {id:'quality',label:'画质',description:'播放器解码证据与来源质量'},
 {id:'tasks',label:'任务',description:'Friday Agent DAG、进度与恢复检查点'},
 {id:'history',label:'历史',description:'最近会话与观看记录入口'},
 {id:'settings',label:'设置',description:'空间、显示与偏好设置入口'},
];
const DOCKS:{id:PanelDock;label:string}[]=[{id:'floating',label:'浮动'},{id:'left',label:'左停靠'},{id:'right',label:'右停靠'},{id:'bottom',label:'底部'}];
export function SpatialPanelWorkspace(){
 const state=useSpatialState();
 const panelRef=useRef<HTMLElement|null>(null);
 const triggerRefs=useRef<Partial<Record<SpatialPanel,HTMLButtonElement|null>>>({});
 const previousPanel=useRef<SpatialPanel|null>(null);
 const active=state.focusedPanel;
 const selected=PANELS.find(item=>item.id===active);
 const rect=active?state.panelLayouts[active]:undefined;
 useEffect(()=>{if(active&&!rect?.minimized){previousPanel.current=active;panelRef.current?.focus();}else if(!active&&previousPanel.current){triggerRefs.current[previousPanel.current]?.focus();previousPanel.current=null;}},[active,rect?.minimized]);
 const style:CSSProperties=rect?{zIndex:rect.zIndex,...(rect.dock==='left'?{left:12,top:12,bottom:12,width:Math.min(rect.width,480)}:rect.dock==='right'?{right:12,top:12,bottom:12,width:Math.min(rect.width,480)}:rect.dock==='bottom'?{left:12,right:12,bottom:12,height:Math.min(rect.height,420)}:{left:rect.x,top:rect.y,width:rect.width,height:rect.height})}:{};
 return <div className="spatial-panel-workspace">
  {selected&&<section ref={node=>{panelRef.current=node;}} className="spatial-panel-window" data-dock={rect?.dock??'floating'} style={style} tabIndex={-1} aria-label={selected.label+'面板'}>
   <header className="spatial-panel-window-header"><strong>{selected.label}</strong><span>{selected.description}</span><div className="spatial-panel-window-actions">
    <button type="button" onClick={()=>spatialStateStore.focus(selected.id)} aria-label="将面板置于最前">置顶</button>
    <button type="button" onClick={()=>spatialStateStore.setPanelRect(selected.id,{minimized:!rect?.minimized})}>{rect?.minimized?'展开':'收起'}</button>
    <button type="button" onClick={()=>spatialStateStore.expand(null)} aria-label="关闭面板">关闭</button>
   </div></header>
   {!rect?.minimized&&<><div className="spatial-panel-window-body"><SpatialPanelContent panel={selected.id}/></div>
   <footer className="spatial-panel-docks"><span>布局</span>{DOCKS.map(dock=><button key={dock.id} type="button" aria-pressed={(rect?.dock??'floating')===dock.id} onClick={()=>spatialStateStore.dock(selected.id,dock.id)}>{dock.label}</button>)}<button type="button" onClick={()=>spatialStateStore.avoidPanelOverlap(selected.id,{width:windowSafeWidth(),height:windowSafeHeight()})}>自动避让</button></footer></>}
  </section>}
 </div>;
}
function windowSafeWidth(){return typeof window==='undefined'?1024:window.innerWidth;}
function windowSafeHeight(){return typeof window==='undefined'?768:window.innerHeight;}
