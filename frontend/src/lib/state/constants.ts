import type { AppLibraryCategoryId, NodeType } from "../types";

export const STORAGE_KEY = "homie_snapshot_v7";
export const ETAG_KEY = "homie_etag_v7";
export const WORKSPACE_STORAGE_KEY = "homie_active_workspace_id";
export const APP_USAGE_STORAGE_KEY = "homie_app_usage_v1";
export const APPEARANCE_STORAGE_KEY = "homie_appearance_v1";

export const GRID_COLS = 16;
export const GRID_ROWS = 8;
export const MAX_ICON_BYTES = 100 * 1024; // 100 KB

export interface WidgetSizePreset {
  label: string;
  shortLabel: string;
  w: number;
  h: number;
}

export const WIDGET_SIZE_PRESETS: Record<NodeType, WidgetSizePreset[]> = {
  action: [{ label: "App Icon", shortLabel: "1×1", w: 1, h: 1 }],
  container: [
    { label: "Folder", shortLabel: "1×1", w: 1, h: 1 },
    { label: "Small", shortLabel: "S", w: 2, h: 2 },
    { label: "Medium", shortLabel: "M", w: 4, h: 2 },
    { label: "Large", shortLabel: "L", w: 4, h: 4 },
  ],
  clock: [
    { label: "Small", shortLabel: "S", w: 2, h: 2 },
    { label: "Medium", shortLabel: "M", w: 4, h: 2 },
    { label: "Large", shortLabel: "L", w: 4, h: 4 },
  ],
  search: [
    { label: "Compact", shortLabel: "S", w: 4, h: 1 },
    { label: "Medium", shortLabel: "M", w: 6, h: 1 },
    { label: "Wide", shortLabel: "L", w: 8, h: 1 },
  ],
  todo: [
    { label: "Small", shortLabel: "S", w: 2, h: 2 },
    { label: "Medium", shortLabel: "M", w: 4, h: 2 },
    { label: "Large", shortLabel: "L", w: 4, h: 4 },
  ],
  calendar: [
    { label: "Small", shortLabel: "S", w: 2, h: 2 },
    { label: "Medium", shortLabel: "M", w: 4, h: 2 },
    { label: "Large", shortLabel: "L", w: 4, h: 4 },
  ],
};

export const DEFAULT_NODE_SIZES: Record<NodeType, { w: number; h: number }> = {
  action: { w: 1, h: 1 },
  container: { w: 4, h: 2 },
  clock: { w: 2, h: 2 },
  search: { w: 6, h: 1 },
  todo: { w: 4, h: 2 },
  calendar: { w: 4, h: 2 },
};

export interface GridRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ScreenBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ContextMenuState {
  open: boolean;
  nodeId: string | null;
  x: number;
  y: number;
  anchorRect: ScreenBounds | null;
  inDock: boolean;
  transformOrigin: string;
}

export const CATEGORY_LABELS: Record<AppLibraryCategoryId, string> = {
  productivity: "Productivity & Work",
  dev: "Development & Cloud",
  media: "Media & Entertainment",
  social: "Social & Reading",
  utilities: "Utilities & Web",
};
