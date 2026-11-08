import type { ReactNode } from 'react';
import type { SpatialSpace } from '../navigation/SpatialRouter';
import { PrimaryNavigation } from '../navigation/PrimaryNavigation';

type SpatialLayoutProps = {
  activeSpace: SpatialSpace;
  onSpaceChange: (space: SpatialSpace) => void;
  header: ReactNode;
  children: ReactNode;
};

export function SpatialLayout({ activeSpace, onSpaceChange, header, children }: SpatialLayoutProps) {
  return (
    <div className="spatial-v4-layout">
      <header className="spatial-v4-app-header">{header}</header>
      <PrimaryNavigation activeSpace={activeSpace} onSpaceChange={onSpaceChange} />
      <main className="spatial-v4-main" id="spatial-v4-main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
