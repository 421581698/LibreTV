'use client';

import type { SpatialSpace } from '../navigation/SpatialRouter';
import { SPATIAL_SPACE_META } from '../navigation/SpatialRouter';

const descriptions: Record<SpatialSpace, string> = {
  cinematic: '影视首页、推荐与播放。',
  intelligence: 'Friday 对话、影视 Agent 与任务工作流。',
  resources: 'FMHY 资源分类、目录与收藏。',
  identity: '个人偏好、历史记录与空间设置。',
};

/** Explicitly marks spaces that have not yet been migrated; never renders fake content. */
export function SpatialSpacePlaceholder({ space }: { space: SpatialSpace }) {
  return (
    <section className="spatial-v4-space-placeholder" aria-labelledby="spatial-space-title">
      <p className="spatial-v4-space-eyebrow">FRIDAY SPATIAL OS</p>
      <h1 id="spatial-space-title">{SPATIAL_SPACE_META[space].label}</h1>
      <p>{descriptions[space]}</p>
      <span>此空间尚未迁移接入，现有业务能力保持原样。</span>
    </section>
  );
}
