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
): WidgetSizePreset {
  const presets = WIDGET_SIZE_PRESETS[nodeType] ?? WIDGET_SIZE_PRESETS.action;
  let best = presets[0];
  let bestScore = Infinity;

  for (const preset of presets) {
    const dist = Math.abs(preset.w - rawW) + Math.abs(preset.h - rawH) * 1.25;
    if (dist < bestScore) {
      bestScore = dist;
      best = preset;
    }
  }
  return best;
}

export function clampToGrid(x: number, y: number, width: number, height: number): GridRect {
  const w = Math.max(1, Math.min(width, GRID_COLS));
  const h = Math.max(1, Math.min(height, GRID_ROWS));
  const clampedX = Math.max(1, Math.min(x, GRID_COLS - w + 1));
  const clampedY = Math.max(1, Math.min(y, GRID_ROWS - h + 1));
  return { x: clampedX, y: clampedY, w, h };
}

export function rectsOverlap(a: GridRect, b: GridRect): boolean {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

export function canFitRectAmong(rect: GridRect, placed: GridRect[]): boolean {
  if (
    rect.x < 1 ||
    rect.y < 1 ||
    rect.x + rect.w - 1 > GRID_COLS ||
    rect.y + rect.h - 1 > GRID_ROWS
  ) {
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
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestDist = Infinity;

  for (let y = 1; y <= GRID_ROWS - h + 1; y++) {
    for (let x = 1; x <= GRID_COLS - w + 1; x++) {
      if (canFitRectAmong({ x, y, w, h }, placed)) {
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
): boolean {
  if (x < 1 || y < 1 || x + width - 1 > GRID_COLS || y + height - 1 > GRID_ROWS) {
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
): { x: number; y: number } | null {
  for (let y = 1; y <= GRID_ROWS - height + 1; y++) {
    for (let x = 1; x <= GRID_COLS - width + 1; x++) {
      if (canFitAmongNodes(x, y, width, height, existing)) {
        return { x, y };
      }
    }
  }
  return null;
}
