import type { DashboardNode } from "../types";
import { GRID_COLS, GRID_ROWS, RESPONSIVE_MAX_ROWS, type GridRect } from "./constants";
import { canFitRectAmong, clampToGrid, findClosestSlotAmong, rectsOverlap } from "./grid-math";
import { apiFetch } from "./session.svelte";

/**
 * Computes non-overlapping 2D grid positions when `activeNodeId` is dragged or resized
 * to `targetRect`, swapping or cascading displaced sibling nodes across `cols x rows`.
 */
export function computeGridReflow(
  allNodes: DashboardNode[],
  rootNodes: DashboardNode[],
  activeNodeId: string,
  targetRect: GridRect,
  cols = GRID_COLS,
  baseRects?: Record<string, GridRect>,
): Record<string, GridRect> | null {
  const rows = cols < GRID_COLS ? RESPONSIVE_MAX_ROWS : GRID_ROWS;
  const clampedTarget = clampToGrid(
    targetRect.x,
    targetRect.y,
    targetRect.w,
    targetRect.h,
    cols,
    rows,
  );

  const getNodeRect = (n: DashboardNode): GridRect => {
    const mapped = baseRects?.[n.id];
    if (mapped) return mapped;
    return {
      x: n.grid_x,
      y: n.grid_y,
      w: Math.min(n.width || 1, cols),
      h: n.height || 1,
    };
  };

  const activeNode = allNodes.find((n) => n.id === activeNodeId);
  const activeOrigin: GridRect | null =
    activeNode && !activeNode.parent_id && activeNode.grid_x > 0 ? getNodeRect(activeNode) : null;

  const others = rootNodes.filter((n) => n.id !== activeNodeId);

  const result: Record<string, GridRect> = {
    [activeNodeId]: clampedTarget,
  };
  const occupied: GridRect[] = [clampedTarget];
  const displaced: DashboardNode[] = [];

  for (const node of others) {
    const rect = getNodeRect(node);
    if (!rectsOverlap(clampedTarget, rect)) {
      result[node.id] = rect;
      occupied.push(rect);
    } else {
      displaced.push(node);
    }
  }

  let pass1Success = true;
  for (const node of displaced) {
    const cur = getNodeRect(node);

    if (
      activeOrigin &&
      canFitRectAmong(
        { x: activeOrigin.x, y: activeOrigin.y, w: cur.w, h: cur.h },
        occupied,
        cols,
        rows,
      )
    ) {
      const swapped = { x: activeOrigin.x, y: activeOrigin.y, w: cur.w, h: cur.h };
      result[node.id] = swapped;
      occupied.push(swapped);
      continue;
    }

    const closest = findClosestSlotAmong(cur.x, cur.y, cur.w, cur.h, occupied, cols, rows);
    if (closest) {
      const placedRect = { x: closest.x, y: closest.y, w: cur.w, h: cur.h };
      result[node.id] = placedRect;
      occupied.push(placedRect);
    } else {
      pass1Success = false;
      break;
    }
  }

  if (pass1Success) return result;

  const cascadeResult: Record<string, GridRect> = {
    [activeNodeId]: clampedTarget,
  };
  const cascadeOccupied: GridRect[] = [clampedTarget];

  for (const node of others) {
    const currentRect = getNodeRect(node);

    if (canFitRectAmong(currentRect, cascadeOccupied, cols, rows)) {
      cascadeResult[node.id] = currentRect;
      cascadeOccupied.push(currentRect);
    } else {
      const closest = findClosestSlotAmong(
        currentRect.x,
        currentRect.y,
        currentRect.w,
        currentRect.h,
        cascadeOccupied,
        cols,
        rows,
      );
      if (!closest) return null;
      const placedRect = { x: closest.x, y: closest.y, w: currentRect.w, h: currentRect.h };
      cascadeResult[node.id] = placedRect;
      cascadeOccupied.push(placedRect);
    }
  }

  return cascadeResult;
}

/**
 * Merges `sourceNode` into `targetNode` (either creating a Smart Stack for identical-size
 * widgets, dropping an action into an existing container, or creating a new 1x1 Folder).
 */
export async function executeNodeMerge(
  sourceNode: DashboardNode,
  targetNode: DashboardNode,
  ctx: {
    nodes: DashboardNode[];
    activeStackIndices: Record<string, number>;
    getChildren: (parentId: string) => DashboardNode[];
    persistSnapshot: () => void;
  },
): Promise<void> {
  if (sourceNode.id === targetNode.id) return;

  const isSourceWidget = sourceNode.node_type !== "action" && sourceNode.node_type !== "container";
  const isTargetWidget = targetNode.node_type !== "action" && targetNode.node_type !== "container";

  // 1. Smart Stack Merge for identical-dimension widgets
  if (
    isSourceWidget &&
    isTargetWidget &&
    !targetNode.parent_id &&
    (sourceNode.width || 2) === (targetNode.width || 2) &&
    (sourceNode.height || 2) === (targetNode.height || 2)
  ) {
    const existingChildren = ctx.getChildren(targetNode.id);
    sourceNode.parent_id = targetNode.id;
    sourceNode.sort_order = existingChildren.length + 1;
    ctx.activeStackIndices[targetNode.id] = existingChildren.length + 1;
    ctx.persistSnapshot();

    void apiFetch("/api/v1/nodes/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        {
          id: sourceNode.id,
          sort_order: sourceNode.sort_order,
          grid_x: targetNode.grid_x,
          grid_y: targetNode.grid_y,
          width: targetNode.width,
          height: targetNode.height,
          parent_id: targetNode.id,
        },
      ]),
    });
    return;
  }

  if (sourceNode.node_type !== "action") return;

  // 2. Drop Action into an existing Container / Folder
  if (targetNode.node_type === "container") {
    const existingChildren = ctx.getChildren(targetNode.id);
    sourceNode.parent_id = targetNode.id;
    sourceNode.grid_x = 1;
    sourceNode.grid_y = 1;
    sourceNode.width = 1;
    sourceNode.height = 1;
    sourceNode.sort_order = existingChildren.length + 1;
    ctx.persistSnapshot();

    void apiFetch("/api/v1/nodes/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        {
          id: sourceNode.id,
          sort_order: sourceNode.sort_order,
          grid_x: 1,
          grid_y: 1,
          width: 1,
          height: 1,
          parent_id: targetNode.id,
        },
      ]),
    });
    return;
  }

  // 3. Merge two root Action shortcuts into a newly created 1x1 Folder
  if (targetNode.node_type === "action" && !targetNode.parent_id) {
    const nowIso = new Date().toISOString();
    const createdFolder: DashboardNode = {
      id: crypto.randomUUID(),
      workspace_id: targetNode.workspace_id,
      parent_id: null,
      sort_order: targetNode.sort_order,
      grid_x: targetNode.grid_x,
      grid_y: targetNode.grid_y,
      title: "Folder",
      icon: null,
      node_type: "container",
      url: null,
      width: 1,
      height: 1,
      settings: {},
      created_at: nowIso,
      updated_at: nowIso,
    };

    ctx.nodes.push(createdFolder);

    targetNode.parent_id = createdFolder.id;
    targetNode.grid_x = 1;
    targetNode.grid_y = 1;
    targetNode.width = 1;
    targetNode.height = 1;
    targetNode.sort_order = 1;

    sourceNode.parent_id = createdFolder.id;
    sourceNode.grid_x = 1;
    sourceNode.grid_y = 1;
    sourceNode.width = 1;
    sourceNode.height = 1;
    sourceNode.sort_order = 2;

    ctx.persistSnapshot();

    const res = await apiFetch("/api/v1/nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createdFolder),
    });

    if (res.ok) {
      void apiFetch("/api/v1/nodes/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          {
            id: targetNode.id,
            sort_order: 1,
            grid_x: 1,
            grid_y: 1,
            width: 1,
            height: 1,
            parent_id: createdFolder.id,
          },
          {
            id: sourceNode.id,
            sort_order: 2,
            grid_x: 1,
            grid_y: 1,
            width: 1,
            height: 1,
            parent_id: createdFolder.id,
          },
        ]),
      });
    }
  }
}
