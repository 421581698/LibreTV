'use client';

import { SPATIAL_SPACE_META, SPATIAL_SPACES, type SpatialSpace } from './SpatialRouter';

type PrimaryNavigationProps = {
  activeSpace: SpatialSpace;
  onSpaceChange: (space: SpatialSpace) => void;
};

/** One navigation model; CSS rearranges it for desktop, iPad and iPhone. */
export function PrimaryNavigation({ activeSpace, onSpaceChange }: PrimaryNavigationProps) {
  return (
    <nav className="spatial-v4-primary-nav" aria-label="主要空间">
      <div className="spatial-v4-primary-nav-list" role="group" aria-label="切换工作空间">
        {SPATIAL_SPACES.map((space) => {
          const active = activeSpace === space;
          const meta = SPATIAL_SPACE_META[space];
          return (
            <button
              key={space}
              type="button"
              className="spatial-v4-nav-item"
              data-active={active ? 'true' : 'false'}
              aria-current={active ? 'page' : undefined}
              aria-label={meta.label}
              onClick={() => onSpaceChange(space)}
            >
              <span className="spatial-v4-nav-item-label">{meta.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
