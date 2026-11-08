import type { SpatialPanel, SpatialSnapshot } from '../core/types';
const PANEL_ORDER: SpatialPanel[] = ['search', 'sources', 'quality', 'tasks', 'history', 'settings'];
export function setExpandedPanel(state: SpatialSnapshot, panel: SpatialPanel | null): SpatialSnapshot {
  if (panel !== null && !PANEL_ORDER.includes(panel)) return state;
  return { ...state, expandedPanel: panel, updatedAt: Date.now() };
}
export function normalizePanel(panel: unknown): SpatialPanel | null {
  return typeof panel === 'string' && PANEL_ORDER.includes(panel as SpatialPanel) ? panel as SpatialPanel : null;
}
