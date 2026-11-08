'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { SpatialLayout } from './SpatialLayout';
import { resolveSpatialSpace, type SpatialSpace } from '../navigation/SpatialRouter';

type SpatialAppShellProps = {
  children: ReactNode;
  activeSpace?: SpatialSpace;
  initialSpace?: SpatialSpace;
  onSpaceChange?: (space: SpatialSpace) => void;
  fridayEntry?: ReactNode;
  utilityActions?: ReactNode;
  brand?: ReactNode;
};

/**
 * V4 application shell. Space selection is in-memory view state only at P1;
 * persistence is intentionally deferred to the dedicated P6 state layer.
 * The shell never owns Friday voice or task lifecycle.
 */
export function SpatialAppShell({
  children,
  activeSpace,
  initialSpace = 'cinematic',
  onSpaceChange,
  fridayEntry,
  utilityActions,
  brand,
}: SpatialAppShellProps) {
  const [internalSpace, setInternalSpace] = useState<SpatialSpace>(resolveSpatialSpace(initialSpace));
  const currentSpace = resolveSpatialSpace(activeSpace ?? internalSpace);

  const handleSpaceChange = useCallback((nextSpace: SpatialSpace) => {
    if (activeSpace === undefined) setInternalSpace(nextSpace);
    onSpaceChange?.(nextSpace);
  }, [activeSpace, onSpaceChange]);

  const header = (
    <div className="spatial-v4-header-inner">
      <div className="spatial-v4-brand">{brand ?? <span>LibreTV</span>}</div>
      <div className="spatial-v4-header-actions">
        {fridayEntry ? <div className="spatial-v4-friday-slot">{fridayEntry}</div> : null}
        {utilityActions ? <div className="spatial-v4-utility-slot">{utilityActions}</div> : null}
      </div>
    </div>
  );

  return (
    <div className="spatial-v4 spatial-v4-shell">
      <SpatialLayout
        activeSpace={currentSpace}
        onSpaceChange={handleSpaceChange}
        header={header}
      >
        <div className="spatial-v4-space-content" data-space={currentSpace}>
          {children}
        </div>
      </SpatialLayout>
    </div>
  );
}
