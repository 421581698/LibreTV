import {FMHY_CATEGORIES} from '../data/fmhy-categories';
export function ResourcePortal(){
 return <section className="spatial-os-panel" aria-label="FMHY 资源宇宙">
  <p className="spatial-os-eyebrow">FMHY / RESOURCE UNIVERSE</p><h2>13 个顶级资源分类</h2>
  <p>目录结构来自 FMHY 官方分类页。每张卡片直达对应分类页，条目内容以官方实时数据为准。</p>
  <div className="spatial-os-category-grid">{FMHY_CATEGORIES.map(c=><a key={c.id} href={c.href} target="_blank" rel="noopener noreferrer"><strong>{c.zh}</strong><small>{c.title}</small></a>)}</div>
  <a className="spatial-os-source" href="https://fmhy.fyi/" target="_blank" rel="noopener noreferrer">打开 FMHY 官方目录 ↗</a>
 </section>;
}
