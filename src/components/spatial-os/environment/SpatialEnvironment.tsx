import type {ReactNode} from 'react';
/** Environment frame only; interaction and state remain owned by Spatial OS/runtime modules. */
export function SpatialEnvironment({children}:{children:ReactNode}){
 return <div className="spatial-environment">{children}</div>;
}
