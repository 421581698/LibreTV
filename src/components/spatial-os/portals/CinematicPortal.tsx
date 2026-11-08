import type {ReactNode} from 'react';
/** Existing homepage, recommendation data and player entrypoints remain the source of truth. */
export function CinematicPortal({children}:{children:ReactNode}) {
 return <div className="spatial-os-cinematic">{children}</div>;
}
