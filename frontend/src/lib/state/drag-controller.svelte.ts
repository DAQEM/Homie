import { arrayMove } from "@dnd-kit/helpers";
import type { DashboardNode, DragEndEventPayload } from "../types";
import type { AppearanceController } from "./appearance.svelte";
import { GRID_COLS, WIDGET_SIZE_PRESETS, type GridRect, type ScreenBounds } from "./constants";
import { computeGridReflow, executeNodeMerge } from "./drag-engine";
import { clampToGrid, snapToWidgetPreset } from "./grid-math";
import type { OverlayController } from "./overlays.svelte";
import { apiFetch, type SessionStore } from "./session.svelte";
import type { SmartStackController } from "./stacks.svelte";

export class DragController {
  private session: SessionStore;
  private overlays: OverlayController;
  private appearance: AppearanceController;
  private stacks: SmartStackController;

  activeDragNodeId = $state<string | null>(null);
  dragGrabOffset = $state<{ col: number; row: number }>({ col: 0, row: 0 });
  resizingNodeId = $state<string | null>(null);
  folderMergeTargetId = $state<string | null>(null);
  dropPreview = $state<GridRect | null>(null);
  previewPositions = $state<Record<string, GridRect>>({});

  isDirectDragging = $state<boolean>(false);
  directDragDelta = $state<{ x: number; y: number }>({ x: 0, y: 0 });
  private directDragStartPointer = { x: 0, y: 0 };
  private directDragInitialBounds: ScreenBounds | null = null;
  private activeDragLiveBounds: { id: string; rect: ScreenBounds } | null = null;
  settlingDrop = $state<{ id: string; rect: ScreenBounds; seq: number } | null>(null);
  private settlingSeq = 0;

  constructor(
    session: SessionStore,
    overlays: OverlayController,
    appearance: AppearanceController,
    stacks: SmartStackController,
  ) {
    this.session = session;
    this.overlays = overlays;
    this.appearance = appearance;
    this.stacks = stacks;
  }

  isBusy(): boolean {
    return Boolean(this.activeDragNodeId || this.resizingNodeId || this.isDirectDragging);
  }

  getEffectiveRect(node: DashboardNode): GridRect {
    if (this.activeDragNodeId === node.id) {
      return this.session.getNodeGridRect(node);
    }
    const preview = this.previewPositions[node.id];
    if (preview) return preview;
    return this.session.getNodeGridRect(node);
  }

  setDragGrabOffset(colOffset: number, rowOffset: number): void {
    this.dragGrabOffset = {
      col: Math.max(0, colOffset),
      row: Math.max(0, rowOffset),
    };
  }

  computeReflowedPositions(
    activeNodeId: string,
    targetRect: GridRect,
  ): Record<string, GridRect> | null {
    const cols = this.session.activeGridCols;
    const baseRects = cols < GRID_COLS ? this.session.responsiveRootRects : undefined;
    return computeGridReflow(
      this.session.nodes,
      this.session.rootNodes,
      activeNodeId,
      targetRect,
      cols,
      baseRects,
    );
  }

  holdGridReflowOnTarget(): void {
    this.dropPreview = null;
    this.previewPositions = {};
  }

  setFolderMergeTarget(targetId: string | null): void {
    this.folderMergeTargetId = targetId;
    if (targetId) {
      this.dropPreview = null;
      this.previewPositions = {};
    }
  }

  updateDragReflow(rawCol: number, rawRow: number): void {
    if (!this.session.isEditMode || !this.activeDragNodeId || this.folderMergeTargetId) return;
    const dragged = this.session.nodes.find((n) => n.id === this.activeDragNodeId);
    if (!dragged) return;

    const cols = this.session.activeGridCols;
    const baseRect = this.session.getNodeGridRect(dragged);
    const w = dragged.parent_id || dragged.grid_x === -1 ? 1 : baseRect.w;
    const h = dragged.parent_id || dragged.grid_y === -1 ? 1 : baseRect.h;

    const targetX = rawCol - Math.min(this.dragGrabOffset.col, w - 1);
    const targetY = rawRow - Math.min(this.dragGrabOffset.row, h - 1);
    const clamped = clampToGrid(targetX, targetY, w, h, cols, Infinity);

    if (
      this.dropPreview &&
      this.dropPreview.x === clamped.x &&
      this.dropPreview.y === clamped.y &&
      this.dropPreview.w === clamped.w &&
      this.dropPreview.h === clamped.h
    ) {
      return;
    }

    const layout = this.computeReflowedPositions(dragged.id, clamped);
    if (layout) {
      this.dropPreview = clamped;
      this.previewPositions = layout;
    }
  }

  clearDragPreview(): void {
    this.dropPreview = null;
    this.previewPositions = {};
    this.folderMergeTargetId = null;
    this.session.flushPendingSync();
  }

  promoteHoldToDirectDrag(
    nodeId: string,
    startX: number,
    startY: number,
    initialBounds: ScreenBounds,
  ): void {
    this.overlays.closeContextMenu();
    this.appearance.isControlCenterOpen = false;
    this.overlays.flippedNodeId = null;
    this.session.isEditMode = true;
    this.activeDragNodeId = nodeId;
    this.isDirectDragging = true;
    this.directDragStartPointer = { x: startX, y: startY };
    this.directDragDelta = { x: 0, y: 0 };
    this.directDragInitialBounds = initialBounds;
    this.activeDragLiveBounds = { id: nodeId, rect: initialBounds };
    this.folderMergeTargetId = null;

    const node = this.session.nodes.find((n) => n.id === nodeId);
    if (node && !node.parent_id && node.grid_x > 0) {
      const rect = this.session.getNodeGridRect(node);
      this.dropPreview = rect;
      this.previewPositions = { [node.id]: rect };
    }
  }

  updateDirectDrag(clientX: number, clientY: number): void {
    if (!this.isDirectDragging || !this.activeDragNodeId) return;
    const dx = clientX - this.directDragStartPointer.x;
    const dy = clientY - this.directDragStartPointer.y;
    this.directDragDelta = { x: dx, y: dy };

    if (this.directDragInitialBounds) {
      this.activeDragLiveBounds = {
        id: this.activeDragNodeId,
        rect: {
          left: this.directDragInitialBounds.left + dx,
          top: this.directDragInitialBounds.top + dy,
          width: this.directDragInitialBounds.width,
          height: this.directDragInitialBounds.height,
        },
      };
    }
  }

  async finishDirectDrag(_clientX?: number, clientY?: number): Promise<void> {
    if (!this.isDirectDragging) return;
    const draggedId = this.activeDragNodeId;
    const mergeTargetId = this.folderMergeTargetId;

    if (draggedId && this.activeDragLiveBounds?.id === draggedId) {
      this.settlingSeq += 1;
      this.settlingDrop = {
        id: draggedId,
        rect: this.activeDragLiveBounds.rect,
        seq: this.settlingSeq,
      };
    }

    this.isDirectDragging = false;
    this.directDragDelta = { x: 0, y: 0 };
    this.directDragInitialBounds = null;
    this.activeDragLiveBounds = null;
    this.activeDragNodeId = null;
    this.folderMergeTargetId = null;
    this.dragGrabOffset = { col: 0, row: 0 };

    if (!draggedId || !this.session.isEditMode) {
      this.clearDragPreview();
      return;
    }

    const sourceNode = this.session.nodes.find((n) => n.id === draggedId);
    if (!sourceNode) {
      this.clearDragPreview();
      return;
    }

    if (mergeTargetId && mergeTargetId !== draggedId) {
      const mergeTargetNode = this.session.nodes.find((n) => n.id === mergeTargetId);
      if (mergeTargetNode) {
        this.clearDragPreview();
        await this.mergeNodesIntoFolder(sourceNode, mergeTargetNode);
        return;
      }
    }

    if (
      typeof window !== "undefined" &&
      clientY !== undefined &&
      clientY > window.innerHeight - 86 &&
      (sourceNode.node_type === "action" || sourceNode.node_type === "container")
    ) {
      this.clearDragPreview();
      await this.pinNodeToDock(sourceNode);
      return;
    }

    if (this.dropPreview && Object.keys(this.previewPositions).length > 0) {
      await this.commitPreviewLayout();
      return;
    }

    this.clearDragPreview();
  }

  recordActiveDragRect(nodeId: string, rect: DOMRect): void {
    this.activeDragLiveBounds = {
      id: nodeId,
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
    };
  }

  consumeReleaseRect(nodeId: string): ScreenBounds | null {
    if (this.settlingDrop && this.settlingDrop.id === nodeId) {
      const rect = this.settlingDrop.rect;
      this.settlingDrop = null;
      return rect;
    }
    return null;
  }

  startResize(nodeId: string): void {
    const node = this.session.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    this.resizingNodeId = nodeId;
    const rect = this.session.getNodeGridRect(node);
    this.dropPreview = rect;
    this.previewPositions = { [node.id]: rect };
  }

  updateResizePreview(nodeId: string, rawW: number, rawH: number): void {
    const node = this.session.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    const cols = this.session.activeGridCols;
    const baseRect = this.session.getNodeGridRect(node);
    const preset = snapToWidgetPreset(node.node_type, rawW, rawH, cols);
    const clamped = clampToGrid(baseRect.x, baseRect.y, preset.w, preset.h, cols, Infinity);

    if (
      this.dropPreview &&
      this.dropPreview.x === clamped.x &&
      this.dropPreview.y === clamped.y &&
      this.dropPreview.w === clamped.w &&
      this.dropPreview.h === clamped.h
    ) {
      return;
    }

    const layout = this.computeReflowedPositions(nodeId, clamped);
    if (layout) {
      this.dropPreview = clamped;
      this.previewPositions = layout;
    }
  }

  async finishResize(): Promise<void> {
    const nodeId = this.resizingNodeId;
    this.resizingNodeId = null;
    if (!nodeId || !this.dropPreview) {
      this.clearDragPreview();
      return;
    }

    await this.commitPreviewLayout();
  }

  async setNodeSizePreset(node: DashboardNode, w: number, h: number): Promise<void> {
    this.overlays.closeContextMenu();
    const cols = this.session.activeGridCols;
    const baseRect = this.session.getNodeGridRect(node);
    const clamped = clampToGrid(baseRect.x, baseRect.y, Math.min(w, cols), h, cols, Infinity);
    const layout = this.computeReflowedPositions(node.id, clamped);
    if (layout) {
      this.previewPositions = layout;
      await this.commitPreviewLayout();
    }
  }

  async cycleNodeSizePreset(node: DashboardNode, event?: MouseEvent): Promise<void> {
    event?.stopPropagation();
    event?.preventDefault();

    const presets = WIDGET_SIZE_PRESETS[node.node_type] ?? [];
    if (presets.length <= 1) return;

    const cur = this.session.getNodeGridRect(node);
    const currentIdx = presets.findIndex(
      (p) => Math.min(p.w, this.session.activeGridCols) === cur.w && p.h === cur.h,
    );
    const nextPreset = presets[(currentIdx + 1) % presets.length];
    await this.setNodeSizePreset(node, nextPreset.w, nextPreset.h);
  }

  async applyNodeResize(node: DashboardNode, w: number, h: number): Promise<void> {
    const cols = this.session.activeGridCols;
    const baseRect = this.session.getNodeGridRect(node);
    const clamped = clampToGrid(baseRect.x, baseRect.y, Math.min(w, cols), h, cols, Infinity);
    const layout = this.computeReflowedPositions(node.id, clamped);
    if (layout) {
      this.previewPositions = layout;
      await this.commitPreviewLayout();
    }
  }

  async commitPreviewLayout(): Promise<void> {
    const entries = Object.entries(this.previewPositions);
    if (entries.length === 0) {
      this.clearDragPreview();
      return;
    }

    const cols = this.session.activeGridCols;
    const activeWsId = this.session.activeWorkspace?.id;

    if (cols < GRID_COLS) {
      const colKey = String(cols);
      const patches: { id: string; settings: DashboardNode["settings"] }[] = [];

      for (const [id, rect] of entries) {
        const node = this.session.nodes.find((n) => n.id === id);
        if (!node) continue;

        if (!node.settings) node.settings = {};
        if (!node.settings.layouts) node.settings.layouts = {};

        const prevOv = node.settings.layouts[colKey];
        const changed =
          !prevOv ||
          prevOv.x !== rect.x ||
          prevOv.y !== rect.y ||
          prevOv.w !== rect.w ||
          prevOv.h !== rect.h;

        node.settings.layouts[colKey] = {
          x: rect.x,
          y: rect.y,
          w: rect.w,
          h: rect.h,
        };

        if (changed) {
          patches.push({
            id: node.id,
            settings: structuredClone($state.snapshot(node.settings)),
          });
        }
      }

      this.clearDragPreview();
      this.session.persistSnapshot();

      for (const p of patches) {
        void apiFetch(`/api/v1/nodes/${p.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings: p.settings }),
        });
      }
      return;
    }

    const updates: {
      id: string;
      sort_order: number;
      grid_x: number;
      grid_y: number;
      width: number;
      height: number;
      parent_id: string | null;
    }[] = [];

    for (const [id, rect] of entries) {
      const node = this.session.nodes.find((n) => n.id === id);
      if (!node) continue;

      const nextSortOrder = rect.y * 100 + rect.x;
      const wsChanged = Boolean(activeWsId && node.workspace_id !== activeWsId);
      const changed =
        wsChanged ||
        node.parent_id !== null ||
        node.grid_x !== rect.x ||
        node.grid_y !== rect.y ||
        node.width !== rect.w ||
        node.height !== rect.h ||
        node.sort_order !== nextSortOrder;

      if (activeWsId) {
        node.workspace_id = activeWsId;
      }
      node.parent_id = null;
      node.grid_x = rect.x;
      node.grid_y = rect.y;
      node.width = rect.w;
      node.height = rect.h;
      node.sort_order = nextSortOrder;

      if (wsChanged && activeWsId) {
        void apiFetch(`/api/v1/nodes/${node.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspace_id: activeWsId,
            parent_id: null,
            sort_order: nextSortOrder,
            grid_x: rect.x,
            grid_y: rect.y,
            width: rect.w,
            height: rect.h,
          }),
        });
      } else if (changed) {
        updates.push({
          id: node.id,
          sort_order: nextSortOrder,
          grid_x: rect.x,
          grid_y: rect.y,
          width: rect.w,
          height: rect.h,
          parent_id: null,
        });
      }
    }

    this.clearDragPreview();
    this.session.persistSnapshot();

    if (updates.length > 0) {
      void apiFetch("/api/v1/nodes/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
    }
  }

  async pinNodeToDock(node: DashboardNode): Promise<void> {
    if (node.node_type !== "action" && node.node_type !== "container") return;
    node.parent_id = null;
    node.grid_x = -1;
    node.grid_y = -1;
    node.width = 1;
    node.height = 1;
    node.sort_order = this.session.dockNodes.length + 1;
    this.session.persistSnapshot();

    void apiFetch("/api/v1/nodes/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        {
          id: node.id,
          sort_order: node.sort_order,
          grid_x: -1,
          grid_y: -1,
          width: 1,
          height: 1,
          parent_id: null,
        },
      ]),
    });
  }

  private async mergeNodesIntoFolder(
    sourceNode: DashboardNode,
    targetNode: DashboardNode,
  ): Promise<void> {
    await executeNodeMerge(sourceNode, targetNode, {
      nodes: this.session.nodes,
      activeStackIndices: this.stacks.activeStackIndices,
      getChildren: (id) => this.session.getChildren(id),
      persistSnapshot: () => this.session.persistSnapshot(),
    });
  }

  handleDragStart = (event: { operation?: { source?: { id?: string | number } | null } }): void => {
    this.overlays.closeContextMenu();
    this.appearance.isControlCenterOpen = false;
    this.overlays.flippedNodeId = null;
    const id = event.operation?.source?.id;
    this.activeDragNodeId = id ? String(id) : null;
    this.folderMergeTargetId = null;
    if (this.activeDragNodeId) {
      const node = this.session.nodes.find((n) => n.id === this.activeDragNodeId);
      if (node && !node.parent_id && node.grid_x > 0) {
        const rect = this.session.getNodeGridRect(node);
        this.dropPreview = rect;
        this.previewPositions = { [node.id]: rect };
      }
    }
  };

  handleDragOver = (event: DragEndEventPayload): void => {
    if (!this.session.isEditMode || !this.activeDragNodeId) return;
    const rawTargetId = event.operation?.target?.id;
    if (!rawTargetId) return;
    const targetId = String(rawTargetId);

    if (targetId === "dock:dropzone") {
      this.dropPreview = null;
      this.previewPositions = {};
    }
  };

  handleDragEnd = async (event: DragEndEventPayload): Promise<void> => {
    const draggedId = this.activeDragNodeId;
    const mergeTargetId = this.folderMergeTargetId;

    if (draggedId && this.activeDragLiveBounds?.id === draggedId) {
      this.settlingSeq += 1;
      this.settlingDrop = {
        id: draggedId,
        rect: this.activeDragLiveBounds.rect,
        seq: this.settlingSeq,
      };
    }
    this.activeDragLiveBounds = null;
    this.activeDragNodeId = null;
    this.folderMergeTargetId = null;
    this.dragGrabOffset = { col: 0, row: 0 };

    if (event.canceled || !this.session.isEditMode) {
      this.clearDragPreview();
      return;
    }

    const rawSourceId = event.operation?.source?.id ?? draggedId;
    const rawTargetId = event.operation?.target?.id;
    if (!rawSourceId) {
      this.clearDragPreview();
      return;
    }

    const sourceId = String(rawSourceId);
    const targetId = rawTargetId ? String(rawTargetId) : "";

    const sourceNode = this.session.nodes.find((n) => n.id === sourceId);
    if (!sourceNode) {
      this.clearDragPreview();
      return;
    }

    if (mergeTargetId && mergeTargetId !== sourceId) {
      const mergeTargetNode = this.session.nodes.find((n) => n.id === mergeTargetId);
      if (mergeTargetNode) {
        this.clearDragPreview();
        await this.mergeNodesIntoFolder(sourceNode, mergeTargetNode);
        return;
      }
    }

    if (targetId === "dock:dropzone") {
      this.clearDragPreview();
      await this.pinNodeToDock(sourceNode);
      return;
    }

    const targetNode = targetId ? this.session.nodes.find((n) => n.id === targetId) : undefined;

    if (
      targetNode &&
      !targetNode.parent_id &&
      targetNode.grid_x === -1 &&
      targetNode.grid_y === -1
    ) {
      this.clearDragPreview();
      if (sourceNode.node_type !== "action" && sourceNode.node_type !== "container") {
        return;
      }
      const currentDock = this.session.dockNodes.filter((n) => n.id !== sourceId);
      const targetIdx = currentDock.findIndex((n) => n.id === targetId);

      sourceNode.parent_id = null;
      sourceNode.grid_x = -1;
      sourceNode.grid_y = -1;
      sourceNode.width = 1;
      sourceNode.height = 1;

      currentDock.splice(targetIdx >= 0 ? targetIdx : currentDock.length, 0, sourceNode);

      const updates = currentDock.map((item, idx) => ({
        id: item.id,
        sort_order: idx + 1,
        grid_x: -1,
        grid_y: -1,
        width: 1,
        height: 1,
        parent_id: null,
      }));

      for (const u of updates) {
        const item = this.session.nodes.find((n) => n.id === u.id);
        if (item) item.sort_order = u.sort_order;
      }
      this.session.persistSnapshot();

      void apiFetch("/api/v1/nodes/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      return;
    }

    if (
      targetNode &&
      sourceNode.parent_id &&
      sourceNode.parent_id === targetNode.parent_id &&
      sourceId !== targetId
    ) {
      this.clearDragPreview();
      const siblings = this.session.getChildren(sourceNode.parent_id);
      const oldIndex = siblings.findIndex((n) => n.id === sourceId);
      const newIndex = siblings.findIndex((n) => n.id === targetId);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(siblings, oldIndex, newIndex);
      const updates = reordered.map((item, idx) => ({
        id: item.id,
        sort_order: idx + 1,
        grid_x: item.grid_x,
        grid_y: item.grid_y,
        width: 1,
        height: 1,
        parent_id: item.parent_id,
      }));

      for (const u of updates) {
        const item = this.session.nodes.find((n) => n.id === u.id);
        if (item) item.sort_order = u.sort_order;
      }
      this.session.persistSnapshot();

      void apiFetch("/api/v1/nodes/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      return;
    }

    if (targetNode && sourceNode.node_type === "action" && targetNode.parent_id) {
      this.clearDragPreview();
      const siblings = this.session.getChildren(targetNode.parent_id);
      const targetIndex = siblings.findIndex((n) => n.id === targetId);
      sourceNode.parent_id = targetNode.parent_id;
      sourceNode.grid_x = 1;
      sourceNode.grid_y = 1;
      sourceNode.width = 1;
      sourceNode.height = 1;

      const filtered = siblings.filter((n) => n.id !== sourceId);
      filtered.splice(targetIndex >= 0 ? targetIndex : filtered.length, 0, sourceNode);

      const updates = filtered.map((item, idx) => ({
        id: item.id,
        sort_order: idx + 1,
        grid_x: 1,
        grid_y: 1,
        width: 1,
        height: 1,
        parent_id: targetNode.parent_id,
      }));

      for (const u of updates) {
        const item = this.session.nodes.find((n) => n.id === u.id);
        if (item) {
          item.sort_order = u.sort_order;
          item.parent_id = u.parent_id;
        }
      }
      this.session.persistSnapshot();

      void apiFetch("/api/v1/nodes/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      return;
    }

    if (this.dropPreview && Object.keys(this.previewPositions).length > 0) {
      await this.commitPreviewLayout();
      return;
    }

    if (targetId.startsWith("cell:")) {
      const parts = targetId.split(":");
      this.updateDragReflow(Number(parts[1]), Number(parts[2]));
      await this.commitPreviewLayout();
      return;
    }

    if (targetNode && !targetNode.parent_id && targetNode.grid_x > 0) {
      const targetRect = this.session.getNodeGridRect(targetNode);
      const srcRect = this.session.getNodeGridRect(sourceNode);
      const layout = this.computeReflowedPositions(sourceNode.id, {
        x: targetRect.x,
        y: targetRect.y,
        w: srcRect.w,
        h: srcRect.h,
      });
      if (layout) {
        this.previewPositions = layout;
        await this.commitPreviewLayout();
        return;
      }
    }

    this.clearDragPreview();
  };
}
