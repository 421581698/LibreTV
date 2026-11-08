import type {SpatialPanel,SpatialSnapshot} from '../core/types';
const PANELS:SpatialPanel[]=['search','sources','quality','tasks','history','settings'];
export function setExpandedPanel(state:SpatialSnapshot,panel:SpatialPanel|null):SpatialSnapshot {
 return panel!==null&&!PANELS.includes(panel)?state:{...state,expandedPanel:panel,updatedAt:Date.now()};
}
