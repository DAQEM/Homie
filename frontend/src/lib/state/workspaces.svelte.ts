import type { Workspace } from "../types";
import type { AppearanceController } from "./appearance.svelte";
import { WORKSPACE_STORAGE_KEY } from "./constants";
import type { DragController } from "./drag-controller.svelte";
import { canFitAmongNodes, findFreeSlotAmongNodes } from "./grid-math";
import type { OverlayController } from "./overlays.svelte";
import type { PagingController } from "./paging.svelte";
import { apiFetch, type SessionStore } from "./session.svelte";

function persistWorkspaceSelection(id: string): void {
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(WORKSPACE_STORAGE_KEY, id);
  }
  localStorage.setItem(WORKSPACE_STORAGE_KEY, id);
}

export class WorkspaceController {
  private session: SessionStore;
  private paging: PagingController;
  private overlays: OverlayController;
  private appearance: AppearanceController;
  private drag: DragController;

  constructor(
    session: SessionStore,
    paging: PagingController,
    overlays: OverlayController,
    appearance: AppearanceController,
    drag: DragController,
  ) {
    this.session = session;
    this.paging = paging;
    this.overlays = overlays;
    this.appearance = appearance;
    this.drag = drag;
  }

  springToPage(targetIndex: number, initialVelocity = 0): void {
    this.paging.springToPage(targetIndex, this.session.workspaces.length, initialVelocity);
  }

  beginPageSwipe(): void {
    this.paging.beginPageSwipe();
  }

  updatePageSwipe(deltaPages: number, dtMs: number): void {
    this.paging.updatePageSwipe(deltaPages, dtMs, this.session.workspaces.length);
  }

  endPageSwipe(): void {
    this.paging.endPageSwipe(
      this.session.activeWorkspaceIndex,
      this.session.workspaces.length,
      (nextIdx) => {
        const targetWs = this.session.workspaces[nextIdx];
        if (targetWs && targetWs.id !== this.session.activeWorkspaceId) {
          this.session.activeWorkspaceId = targetWs.id;
          persistWorkspaceSelection(targetWs.id);
          this.overlays.resetFolderImmediate();
          this.overlays.closeCalendarModal();
          this.overlays.flippedNodeId = null;
          this.overlays.closeContextMenu();
          this.drag.clearDragPreview();
        }
      },
    );
  }

  handleWheelPaging(deltaX: number, viewportWidth: number): void {
    this.paging.handleWheelPaging(
      deltaX,
      viewportWidth,
      this.session.activeWorkspaceIndex,
      this.session.workspaces.length,
      {
        onSelectNext: () => this.selectNextWorkspace(),
        onSelectPrev: () => this.selectPrevWorkspace(),
        onEndSwipe: () => this.endPageSwipe(),
      },
    );
  }

  selectWorkspace(id: string): void {
    const newIndex = this.session.workspaces.findIndex((w) => w.id === id);
    if (newIndex === -1) return;

    const oldIndex = this.session.activeWorkspaceIndex;
    if (id !== this.session.activeWorkspace?.id) {
      this.paging.pageSlideDirection = newIndex > oldIndex ? "right" : "left";
      this.session.activeWorkspaceId = id;
      persistWorkspaceSelection(id);
      this.overlays.resetFolderImmediate();
      this.overlays.closeCalendarModal();
      this.overlays.flippedNodeId = null;
      this.overlays.closeContextMenu();
      this.drag.clearDragPreview();
    }

    this.paging.springToPage(newIndex, this.session.workspaces.length, this.paging.currentVelocity);
  }

  selectNextWorkspace(): boolean {
    if (this.session.workspaces.length <= 1) return false;
    const nextIdx = this.session.activeWorkspaceIndex + 1;
    if (nextIdx >= this.session.workspaces.length) {
      this.paging.springToPage(
        this.session.activeWorkspaceIndex,
        this.session.workspaces.length,
        1.45,
      );
      return false;
    }
    this.selectWorkspace(this.session.workspaces[nextIdx].id);
    return true;
  }

  selectPrevWorkspace(): boolean {
    if (this.session.workspaces.length <= 1) return false;
    const prevIdx = this.session.activeWorkspaceIndex - 1;
    if (prevIdx < 0) {
      this.paging.springToPage(0, this.session.workspaces.length, -1.45);
      return false;
    }
    this.selectWorkspace(this.session.workspaces[prevIdx].id);
    return true;
  }

  async moveNodeToWorkspace(nodeId: string, targetWorkspaceId: string): Promise<void> {
    this.overlays.closeContextMenu();
    const node = this.session.nodes.find((n) => n.id === nodeId);
    if (!node || node.workspace_id === targetWorkspaceId) return;

    const targetRootNodes = this.session.nodes.filter(
      (n) =>
        n.workspace_id === targetWorkspaceId && !n.parent_id && n.grid_x > 0 && n.id !== nodeId,
    );

    let nextX = node.grid_x > 0 ? node.grid_x : 1;
    let nextY = node.grid_y > 0 ? node.grid_y : 1;
    if (!canFitAmongNodes(nextX, nextY, node.width, node.height, targetRootNodes)) {
      const free = findFreeSlotAmongNodes(node.width, node.height, targetRootNodes);
      if (free) {
        nextX = free.x;
        nextY = free.y;
      }
    }

    node.workspace_id = targetWorkspaceId;
    node.parent_id = null;
    node.grid_x = nextX;
    node.grid_y = nextY;
    this.session.persistSnapshot();

    void apiFetch(`/api/v1/nodes/${node.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace_id: targetWorkspaceId,
        parent_id: null,
        grid_x: nextX,
        grid_y: nextY,
      }),
    });
  }

  toggleEditMode(): void {
    this.session.isEditMode = !this.session.isEditMode;
    this.overlays.closeContextMenu();
    this.appearance.isControlCenterOpen = false;
    this.overlays.closeCalendarModal();
    if (!this.session.isEditMode) {
      this.overlays.flippedNodeId = null;
      this.drag.clearDragPreview();
    }
  }

  enterEditMode(): void {
    this.overlays.closeContextMenu();
    this.appearance.isControlCenterOpen = false;
    this.overlays.closeCalendarModal();
    if (!this.session.isEditMode) {
      this.session.isEditMode = true;
    }
  }

  exitEditMode(): void {
    this.overlays.closeContextMenu();
    this.overlays.flippedNodeId = null;
    if (this.session.isEditMode) {
      this.session.isEditMode = false;
      this.drag.clearDragPreview();
    }
  }

  async createWorkspace(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;

    const nowIso = new Date().toISOString();
    const optimisticWs: Workspace = {
      id: crypto.randomUUID(),
      name: trimmed,
      created_at: nowIso,
      updated_at: nowIso,
    };

    this.session.workspaces.push(optimisticWs);
    this.selectWorkspace(optimisticWs.id);
    this.session.persistSnapshot();
    this.overlays.isWorkspaceModalOpen = false;

    const res = await apiFetch("/api/v1/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: optimisticWs.id, name: trimmed }),
    });

    if (!res.ok) {
      this.session.workspaces = this.session.workspaces.filter((w) => w.id !== optimisticWs.id);
      if (this.session.workspaces.length > 0) {
        this.selectWorkspace(this.session.workspaces[0].id);
      }
      this.session.persistSnapshot();
    }
  }

  async deleteWorkspace(id: string, event?: MouseEvent): Promise<void> {
    event?.stopPropagation();
    event?.preventDefault();
    if (this.session.workspaces.length <= 1) return;

    const prevWorkspaces = [...this.session.workspaces];
    const prevNodes = structuredClone($state.snapshot(this.session.nodes));
    const deletedIdx = this.session.workspaces.findIndex((w) => w.id === id);

    const remainingWorkspaces = this.session.workspaces.filter((w) => w.id !== id);
    const fallbackWs = remainingWorkspaces[Math.max(0, deletedIdx - 1)] ?? remainingWorkspaces[0];

    const dockIds = new Set(
      this.session.nodes
        .filter((n) => n.workspace_id === id && !n.parent_id && n.grid_x === -1 && n.grid_y === -1)
        .map((n) => n.id),
    );

    for (const n of this.session.nodes) {
      if (dockIds.has(n.id) || (n.parent_id && dockIds.has(n.parent_id))) {
        n.workspace_id = fallbackWs.id;
      }
    }

    this.session.workspaces = remainingWorkspaces;
    this.session.nodes = this.session.nodes.filter((n) => n.workspace_id !== id);

    if (this.session.activeWorkspaceId === id) {
      this.selectWorkspace(fallbackWs.id);
    } else {
      this.springToPage(this.session.activeWorkspaceIndex);
    }
    this.session.persistSnapshot();

    const res = await apiFetch(`/api/v1/workspaces/${id}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      this.session.workspaces = prevWorkspaces;
      this.session.nodes = prevNodes;
      this.springToPage(this.session.activeWorkspaceIndex);
      this.session.persistSnapshot();
    }
  }
}
