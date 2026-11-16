import type { DashboardNode, NodeType } from "../types";
import {
  GRID_COLS,
  GRID_ROWS,
  WIDGET_SIZE_PRESETS,
  type GridRect,
  type WidgetSizePreset,
} from "./constants";

export function snapToWidgetPreset(
  nodeType: NodeType,
  rawW: number,
  rawH: number,
  maxCols = GRID_COLS,
): WidgetSizePreset {
  const presets = WIDGET_SIZE_PRESETS[nodeType] ?? WIDGET_SIZE_PRESETS.action;
  let best = presets[0];
  let bestScore = Infinity;

  for (const preset of presets) {
    const effectiveW = Math.min(preset.w, maxCols);
    const dist = Math.abs(effectiveW - rawW) + Math.abs(preset.h - rawH) * 1.25;
    if (dist < bestScore) {
      bestScore = dist;
      best = { ...preset, w: effectiveW };
    }
  }
  return best;
}

export function clampToGrid(
  x: number,
  y: number,
  width: number,
  height: number,
  cols = GRID_COLS,
  rows = Infinity,
): GridRect {
  const w = Math.max(1, Math.min(width, cols));
  const h = Math.max(1, Number.isFinite(rows) ? Math.min(height, rows) : height);
  const clampedX = Math.max(1, Math.min(x, cols - w + 1));
  const maxY = Number.isFinite(rows) ? Math.max(1, rows - h + 1) : Infinity;
  const clampedY = Math.max(1, Math.min(y, maxY));
  return { x: clampedX, y: clampedY, w, h };
}

export function rectsOverlap(a: GridRect, b: GridRect): boolean {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

export function canFitRectAmong(
  rect: GridRect,
  placed: GridRect[],
  cols = GRID_COLS,
  rows = Infinity,
): boolean {
  if (rect.x < 1 || rect.y < 1 || rect.x + rect.w - 1 > cols) {
    return false;
  }
  if (Number.isFinite(rows) && rect.y + rect.h - 1 > rows) {
    return false;
  }
  for (const other of placed) {
    if (rectsOverlap(rect, other)) return false;
  }
  return true;
}

export function findClosestSlotAmong(
  prefX: number,
  prefY: number,
  w: number,
  h: number,
  placed: GridRect[],
  cols = GRID_COLS,
  rows = Infinity,
): { x: number; y: number } | null {
  let maxBottom = 0;
  for (const r of placed) {
    maxBottom = Math.max(maxBottom, r.y + r.h - 1);
  }
  const naturalLimit = Math.max(GRID_ROWS, prefY, maxBottom) + h + 16;
  const searchMaxY = Number.isFinite(rows) ? Math.min(rows - h + 1, naturalLimit) : naturalLimit;

  let best: { x: number; y: number } | null = null;
  let bestDist = Infinity;

  for (let y = 1; y <= searchMaxY; y++) {
    for (let x = 1; x <= cols - w + 1; x++) {
      if (canFitRectAmong({ x, y, w, h }, placed, cols, rows)) {
        const dist = Math.abs(x - prefX) + Math.abs(y - prefY) * 1.6 + y * 0.05 + x * 0.01;
        if (dist < bestDist) {
          bestDist = dist;
          best = { x, y };
        }
      }
    }
  }
  return best;
}

export function canFitAmongNodes(
  x: number,
  y: number,
  width: number,
  height: number,
  existing: DashboardNode[],
  cols = GRID_COLS,
  rows = Infinity,
): boolean {
  if (x < 1 || y < 1 || x + width - 1 > cols) {
    return false;
  }
  if (Number.isFinite(rows) && y + height - 1 > rows) {
    return false;
  }

  for (let dx = 0; dx < width; dx++) {
    for (let dy = 0; dy < height; dy++) {
      const cx = x + dx;
      const cy = y + dy;
      for (const other of existing) {
        if (
          cx >= other.grid_x &&
          cx < other.grid_x + (other.width || 1) &&
          cy >= other.grid_y &&
          cy < other.grid_y + (other.height || 1)
        ) {
          return false;
        }
      }
    }
  }
  return true;
}

export function findFreeSlotAmongNodes(
  width: number,
  height: number,
  existing: DashboardNode[],
  cols = GRID_COLS,
  rows = Infinity,
): { x: number; y: number } | null {
  let maxBottom = 0;
  for (const n of existing) {
    maxBottom = Math.max(maxBottom, n.grid_y + (n.height || 1) - 1);
  }
  const naturalLimit = Math.max(GRID_ROWS, maxBottom) + height + 16;
  const searchMaxY = Number.isFinite(rows)
    ? Math.min(rows - height + 1, naturalLimit)
    : naturalLimit;

  for (let y = 1; y <= searchMaxY; y++) {
    for (let x = 1; x <= cols - width + 1; x++) {
      if (canFitAmongNodes(x, y, width, height, existing, cols, rows)) {
        return { x, y };
      }
    }
  }
  return null;
}

/**
 * Computes a deterministic, non-overlapping responsive layout for 8-col (tablet)
 * or 4-col (mobile) viewports without overwriting the persisted 16-col desktop grid.
 */
export function computeResponsivePacking(
  rootNodes: DashboardNode[],
  cols: number,
): Record<string, GridRect> {
  const result: Record<string, GridRect> = {};
  if (cols >= GRID_COLS) {
    for (const n of rootNodes) {
      result[n.id] = {
        x: n.grid_x,
        y: n.grid_y,
        w: n.width || 1,
        h: n.height || 1,
      };
    }
    return result;
  }

  const key = String(cols);
  const placed: GridRect[] = [];
  const remaining: DashboardNode[] = [];

  // 1. Honor explicit per-breakpoint overrides first
  for (const n of rootNodes) {
    const ov = n.settings?.layouts?.[key];
    if (ov) {
      const w = Math.max(1, Math.min(ov.w || n.width || 1, cols));
      const h = Math.max(1, ov.h || n.height || 1);
      const clamped = clampToGrid(ov.x, ov.y, w, h, cols, Infinity);
      if (canFitRectAmong(clamped, placed, cols, Infinity)) {
        result[n.id] = clamped;
        placed.push(clamped);
        continue;
      }
    }
    remaining.push(n);
  }

  // 2. Pack remaining nodes in top-to-bottom, left-to-right reading order
  for (const n of remaining) {
    const w = Math.max(1, Math.min(n.width || 1, cols));
    const h = Math.max(1, n.height || 1);
    const slot = findClosestSlotAmong(1, 1, w, h, placed, cols, Infinity);
    const rect: GridRect = slot ? { x: slot.x, y: slot.y, w, h } : { x: 1, y: 1, w, h };
    result[n.id] = rect;
    placed.push(rect);
  }

  return result;
}
