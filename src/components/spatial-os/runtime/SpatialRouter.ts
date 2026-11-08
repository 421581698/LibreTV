import { DEFAULT_SPATIAL_STATE, SPATIAL_SPACES, type SpatialSnapshot, type SpatialSpace } from '../core/types';

export function activateSpace(state: SpatialSnapshot, next: SpatialSpace): SpatialSnapshot {
  if (!SPATIAL_SPACES.includes(next)) return state;
  if (state.activeSpace === next) return state;
  return { ...state, activeSpace: next, expandedPanel: null, history: [...state.history.slice(-7), next], updatedAt: Date.now() };
}
export function goBackSpace(state: SpatialSnapshot): SpatialSnapshot {
  if (state.history.length < 2) return { ...state, expandedPanel: null };
  const history = state.history.slice(0, -1);
  return { ...state, activeSpace: history[history.length - 1] ?? DEFAULT_SPATIAL_STATE.activeSpace, history, expandedPanel: null, updatedAt: Date.now() };
}
