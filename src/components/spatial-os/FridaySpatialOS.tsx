'use client';
import type { ReactNode } from 'react';
import { FMHY_CATEGORIES } from './data/fmhy-categories';
import { useSpatialState, spatialStateStore } from './runtime/SpatialStateStore';
import type { SpatialSpace } from './core/types';

const SPACES: { id: SpatialSpace; label: string; sub: string }[] = [
  { id: 'cinematic', label: 'CINEMATIC', sub: '影视空间' },
  { id: 'intelligence', label: 'INTELLIGENCE', sub: '智能空间' },
  { id: 'resources', label: 'RESOURCE UNIVERSE', sub: '资源宇宙' },
  { id: 'identity', label: 'IDENTITY', sub: '个人空间' },
];
export function FridaySpatialOS({ children, friday }: { children: ReactNode; friday?: ReactNode }) {
  const state = useSpatialState();
  return <div className="spatial-os" data-space={state.activeSpace}>
    <div className="spatial-os-core">{friday}</div>
    <nav className="spatial-os-nav" aria-label="Spatial OS 空间导航">
      {SPACES.map(space => <button key={space.id} type="button" aria-current={state.activeSpace === space.id ? 'page' : undefined} onClick={() => spatialStateStore.activate(space.id)}>
        <span>{space.label}</span><small>{space.sub}</small>
      </button>)}
    </nav>
    {state.activeSpace === 'cinematic' && <div className="spatial-os-cinematic">{children}</div>}
    {state.activeSpace === 'intelligence' && <section className="spatial-os-panel" aria-label="Friday 智能任务空间">
      <p className="spatial-os-eyebrow">FRIDAY / INTELLIGENCE</p><h2>智能任务中心</h2>
      <p>语音、Agent DAG、任务事件与播放器能力继续由现有 Friday V3 Runtime 管理；此处只呈现空间入口。</p>
      <div className="spatial-os-actions">{(['tasks','quality','sources'] as const).map(panel => <button key={panel} onClick={() => spatialStateStore.expand(state.expandedPanel === panel ? null : panel)}>{panel === 'tasks' ? '任务运行' : panel === 'quality' ? '画质证据' : '来源检测'}</button>)}</div>
      {state.expandedPanel && <p className="spatial-os-note">已选择：{state.expandedPanel}。运行状态仍以现有 Task Runtime 与质量探测结果为准。</p>}
    </section>}
    {state.activeSpace === 'resources' && <section className="spatial-os-panel" aria-label="FMHY 资源目录">
      <p className="spatial-os-eyebrow">FMHY / RESOURCE UNIVERSE</p><h2>13 个顶级资源分类</h2>
      <p>分类来自 FMHY 官方目录；打开官方目录浏览实时条目，LibreTV 不复制或伪造资源数据。</p>
      <div className="spatial-os-category-grid">{FMHY_CATEGORIES.map(category => <a key={category.id} href={category.href} target="_blank" rel="noopener noreferrer"><strong>{category.zh}</strong><small>{category.title}</small></a>)}</div>
      <a className="spatial-os-source" href="https://fmhy.fyi/" target="_blank" rel="noopener noreferrer">打开 FMHY 官方目录 ↗</a>
    </section>}
    {state.activeSpace === 'identity' && <section className="spatial-os-panel" aria-label="个人空间">
      <p className="spatial-os-eyebrow">IDENTITY SPACE</p><h2>个人空间</h2><p>观看历史、收藏、偏好与设置继续使用 LibreTV 现有数据与设置模块。</p>
      <button onClick={() => spatialStateStore.reset()}>恢复默认空间布局</button>
    </section>}
  </div>;
}
