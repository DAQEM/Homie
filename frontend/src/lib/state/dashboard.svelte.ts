import { arrayMove } from "@dnd-kit/helpers";
import type {
  BootstrapPayload,
  DashboardNode,
  DragEndEventPayload,
  NodeModalState,
  SignalDelta,
  Workspace,
} from "../types";

const STORAGE_KEY = "homie_snapshot_v6";
const ETAG_KEY = "homie_etag_v6";
const WORKSPACE_STORAGE_KEY = "homie_active_workspace_id";

export const BLOCK_COLS = 3;
export const BLOCK_ROWS = 4;
export const BLOCKS_X = 4; // 4 blocks per row
export const BLOCKS_Y = 2; // 2 rows of blocks (8 blocks total)
export const GRID_COLS = BLOCKS_X * BLOCK_COLS; // 12
export const GRID_ROWS = BLOCKS_Y * BLOCK_ROWS; // 8
export const MAX_ICON_BYTES = 100 * 1024; // 100 KB

class DashboardStore {
  workspaces = $state<Workspace[]>([]);
  nodes = $state<DashboardNode[]>([]);
  signals = $state<Record<string, unknown>>({});
  activeWorkspaceId = $state<string | null>(null);
  isEditMode = $state<boolean>(false);
  openFolderId = $state<string | null>(null);
  isWorkspaceModalOpen = $state<boolean>(false);
  hydrationStatus = $state<string>("Cold Boot");

  nodeModal = $state<NodeModalState>({
    open: false,
    mode: "create",
    id: null,
    parent_id: null,
    grid_x: 1,
    grid_y: 1,
    title: "",
    icon: null,
    node_type: "action",
    url: "https://",
    width: 1,
    height: 1,
  });

  activeWorkspace = $derived<Workspace | null>(
    this.workspaces.find((w) => w.id === this.activeWorkspaceId) ?? this.workspaces[0] ?? null,
  );

  rootNodes = $derived<DashboardNode[]>(
    this.nodes
      .filter(
        (n) =>
          n.workspace_id === this.activeWorkspace?.id &&
          !n.parent_id &&
          n.grid_x > 0 &&
          n.grid_y > 0,
      )
      .sort((a, b) => a.sort_order - b.sort_order),
  );

  dockNodes = $derived<DashboardNode[]>(
    this.nodes
      .filter(
        (n) =>
          n.workspace_id === this.activeWorkspace?.id &&
          !n.parent_id &&
          n.grid_x === -1 &&
          n.grid_y === -1,
      )
      .sort((a, b) => a.sort_order - b.sort_order),
  );

  openFolder = $derived<DashboardNode | null>(
    this.nodes.find((n) => n.id === this.openFolderId) ?? null,
  );

  constructor() {
    const cachedRaw = localStorage.getItem(STORAGE_KEY);
    if (cachedRaw) {
      try {
        const data = JSON.parse(cachedRaw) as Partial<BootstrapPayload>;
        this.workspaces = data.workspaces ?? [];
        this.nodes = data.nodes ?? [];
        this.signals = data.signals ?? {};
        this.sanitizeAllWorkspaces();
        this.hydrationStatus = "Phase 0: Local Snapshot";
      } catch {
        // Ignore invalid cache
      }
    }

    const savedWsId = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (savedWsId && this.workspaces.some((w) => w.id === savedWsId)) {
      this.activeWorkspaceId = savedWsId;
    } else if (this.workspaces.length > 0) {
      this.activeWorkspaceId = this.workspaces[0].id;
    }
  }

  init(): () => void {
    const etag = localStorage.getItem(ETAG_KEY);
    fetch("/api/v1/bootstrap", {
      headers: etag ? { "If-None-Match": etag } : {},
    }).then(async (res) => {
      if (res.status === 304) {
        this.hydrationStatus = "Phase 1: 304 Not Modified";
      } else if (res.ok) {
        const newEtag = res.headers.get("etag");
        const data = (await res.json()) as BootstrapPayload;
        this.workspaces = data.workspaces ?? [];
        this.nodes = data.nodes ?? [];
        this.signals = data.signals ?? {};
        this.sanitizeAllWorkspaces();

        const storedWs = localStorage.getItem(WORKSPACE_STORAGE_KEY);
        if (storedWs && this.workspaces.some((w) => w.id === storedWs)) {
          this.activeWorkspaceId = storedWs;
        } else if (this.workspaces.length > 0) {
          this.activeWorkspaceId = this.workspaces[0].id;
          localStorage.setItem(WORKSPACE_STORAGE_KEY, this.workspaces[0].id);
        }

        this.persistSnapshot();
        if (newEtag) localStorage.setItem(ETAG_KEY, newEtag);
        this.hydrationStatus = "Phase 1: 200 OK";
      }
    });

    const sse = new EventSource("/api/v1/live");
    sse.onmessage = (event: MessageEvent<string>) => {
      const delta = JSON.parse(event.data) as SignalDelta;
      this.signals[delta.key] = delta.value;
      this.persistSnapshot();
      this.hydrationStatus = "Phase 2: Live SSE";
    };

    return () => sse.close();
  }

  /**
   * Clamps (x, y) so a node of (width, height) stays strictly inside one of the 8 (3x4) blocks.
   */
  clampToBlock(
    x: number,
    y: number,
    width: number,
    height: number,
  ): { x: number; y: number; w: number; h: number } {
    const w = Math.max(1, Math.min(width, BLOCK_COLS));
    const h = Math.max(1, Math.min(height, BLOCK_ROWS));
    const safeX = Math.max(1, Math.min(x, GRID_COLS));
    const safeY = Math.max(1, Math.min(y, GRID_ROWS));

    const bx = Math.floor((safeX - 1) / BLOCK_COLS);
    const by = Math.floor((safeY - 1) / BLOCK_ROWS);

    const blockMinX = bx * BLOCK_COLS + 1;
    const blockMaxX = (bx + 1) * BLOCK_COLS;
    const blockMinY = by * BLOCK_ROWS + 1;
    const blockMaxY = (by + 1) * BLOCK_ROWS;

    const clampedX = Math.max(blockMinX, Math.min(safeX, blockMaxX - w + 1));
    const clampedY = Math.max(blockMinY, Math.min(safeY, blockMaxY - h + 1));
    return { x: clampedX, y: clampedY, w, h };
  }

  sanitizeAllWorkspaces(): void {
    for (const ws of this.workspaces) {
      const wsNodes = this.nodes
        .filter((n) => n.workspace_id === ws.id && !n.parent_id && n.grid_x > 0)
        .sort((a, b) => a.sort_order - b.sort_order);

      const placed: DashboardNode[] = [];
      for (const n of wsNodes) {
        const clamped = this.clampToBlock(n.grid_x, n.grid_y, n.width || 1, n.height || 1);
        n.width = clamped.w;
        n.height = clamped.h;

        if (this.canFitAmong(clamped.x, clamped.y, n.width, n.height, placed)) {
          n.grid_x = clamped.x;
          n.grid_y = clamped.y;
        } else {
          const free = this.findFreeSlotAmong(n.width, n.height, placed);
          if (free) {
            n.grid_x = free.x;
            n.grid_y = free.y;
          }
        }
        placed.push(n);
      }
    }
  }

  private canFitAmong(
    x: number,
    y: number,
    width: number,
    height: number,
    existing: DashboardNode[],
  ): boolean {
    if (x < 1 || y < 1 || x > GRID_COLS || y > GRID_ROWS) return false;

    const bx = Math.floor((x - 1) / BLOCK_COLS);
    const by = Math.floor((y - 1) / BLOCK_ROWS);
    const blockMinX = bx * BLOCK_COLS + 1;
    const blockMaxX = (bx + 1) * BLOCK_COLS;
    const blockMinY = by * BLOCK_ROWS + 1;
    const blockMaxY = (by + 1) * BLOCK_ROWS;

    if (x < blockMinX || x + width - 1 > blockMaxX || y < blockMinY || y + height - 1 > blockMaxY) {
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

  private findFreeSlotAmong(
    width: number,
    height: number,
    existing: DashboardNode[],
  ): { x: number; y: number } | null {
    for (let by = 0; by < BLOCKS_Y; by++) {
      for (let bx = 0; bx < BLOCKS_X; bx++) {
        const offsetX = bx * BLOCK_COLS;
        const offsetY = by * BLOCK_ROWS;
        for (let ly = 1; ly <= BLOCK_ROWS - height + 1; ly++) {
          for (let lx = 1; lx <= BLOCK_COLS - width + 1; lx++) {
            const x = offsetX + lx;
            const y = offsetY + ly;
            if (this.canFitAmong(x, y, width, height, existing)) {
              return { x, y };
            }
          }
        }
      }
    }
    return null;
  }

  persistSnapshot(): void {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        workspaces: this.workspaces,
        nodes: this.nodes,
        signals: this.signals,
      }),
    );
  }

  getChildren(parentId: string): DashboardNode[] {
    return this.nodes
      .filter((n) => n.parent_id === parentId)
      .sort((a, b) => a.sort_order - b.sort_order);
  }

  isCellOccupied(x: number, y: number, ignoreNodeId?: string): boolean {
    for (const n of this.rootNodes) {
      if (n.id === ignoreNodeId) continue;
      const w = n.width || 1;
      const h = n.height || 1;
      if (x >= n.grid_x && x < n.grid_x + w && y >= n.grid_y && y < n.grid_y + h) {
        return true;
      }
    }
    return false;
  }

  canPlaceAt(x: number, y: number, width: number, height: number, ignoreNodeId?: string): boolean {
    const others = this.rootNodes.filter((n) => n.id !== ignoreNodeId);
    return this.canFitAmong(x, y, width, height, others);
  }

  findFirstFreeCell(width = 1, height = 1, ignoreNodeId?: string): { x: number; y: number } | null {
    const others = this.rootNodes.filter((n) => n.id !== ignoreNodeId);
    return this.findFreeSlotAmong(width, height, others);
  }

  selectWorkspace(id: string): void {
    this.activeWorkspaceId = id;
    localStorage.setItem(WORKSPACE_STORAGE_KEY, id);
    this.openFolderId = null;
  }

  toggleEditMode(): void {
    this.isEditMode = !this.isEditMode;
  }

  handleDragEnd = async (event: DragEndEventPayload): Promise<void> => {
    if (event.canceled || !this.isEditMode) return;
    const rawSourceId = event.operation?.source?.id;
    const rawTargetId = event.operation?.target?.id;
    if (!rawSourceId || !rawTargetId) return;

    const sourceId = String(rawSourceId);
    const targetId = String(rawTargetId);
    if (sourceId === targetId) return;

    const sourceNode = this.nodes.find((n) => n.id === sourceId);
    if (!sourceNode) return;

    // Case 1: Dropped onto the bottom Dock dropzone ("dock:dropzone")
    if (targetId === "dock:dropzone") {
      sourceNode.parent_id = null;
      sourceNode.grid_x = -1;
      sourceNode.grid_y = -1;
      sourceNode.width = 1;
      sourceNode.height = 1;
      sourceNode.sort_order = this.dockNodes.length + 1;
      this.persistSnapshot();

      await fetch("/api/v1/nodes/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          {
            id: sourceNode.id,
            sort_order: sourceNode.sort_order,
            grid_x: -1,
            grid_y: -1,
            width: 1,
            height: 1,
            parent_id: null,
          },
        ]),
      });
      return;
    }

    // Case 2: Dropped onto an empty grid cell ("cell:x:y")
    if (targetId.startsWith("cell:")) {
      const parts = targetId.split(":");
      const rawX = Number(parts[1]);
      const rawY = Number(parts[2]);
      const w = sourceNode.parent_id || sourceNode.grid_x === -1 ? 1 : sourceNode.width || 1;
      const h = sourceNode.parent_id || sourceNode.grid_y === -1 ? 1 : sourceNode.height || 1;

      const clamped = this.clampToBlock(rawX, rawY, w, h);
      if (!this.canPlaceAt(clamped.x, clamped.y, clamped.w, clamped.h, sourceNode.id)) {
        return;
      }

      sourceNode.parent_id = null;
      sourceNode.grid_x = clamped.x;
      sourceNode.grid_y = clamped.y;
      sourceNode.width = clamped.w;
      sourceNode.height = clamped.h;
      this.persistSnapshot();

      await fetch("/api/v1/nodes/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          {
            id: sourceNode.id,
            sort_order: sourceNode.sort_order,
            grid_x: sourceNode.grid_x,
            grid_y: sourceNode.grid_y,
            width: sourceNode.width,
            height: sourceNode.height,
            parent_id: null,
          },
        ]),
      });
      return;
    }

    const targetNode = this.nodes.find((n) => n.id === targetId);
    if (!targetNode) return;

    // Case 3: Dropped onto a node inside the Dock (-1, -1) -> dock & reorder
    if (!targetNode.parent_id && targetNode.grid_x === -1 && targetNode.grid_y === -1) {
      const currentDock = this.dockNodes.filter((n) => n.id !== sourceId);
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
        const item = this.nodes.find((n) => n.id === u.id);
        if (item) item.sort_order = u.sort_order;
      }
      this.persistSnapshot();

      await fetch("/api/v1/nodes/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      return;
    }

    // Case 4: Both nodes are inside the same container -> reorder children
    if (sourceNode.parent_id && sourceNode.parent_id === targetNode.parent_id) {
      const siblings = this.getChildren(sourceNode.parent_id);
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
        const item = this.nodes.find((n) => n.id === u.id);
        if (item) item.sort_order = u.sort_order;
      }
      this.persistSnapshot();

      await fetch("/api/v1/nodes/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      return;
    }

    // Case 5: Dragging an action node onto a child inside a container
    if (sourceNode.node_type === "action" && targetNode.parent_id) {
      const siblings = this.getChildren(targetNode.parent_id);
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
        const item = this.nodes.find((n) => n.id === u.id);
        if (item) {
          item.sort_order = u.sort_order;
          item.parent_id = u.parent_id;
        }
      }
      this.persistSnapshot();

      await fetch("/api/v1/nodes/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      return;
    }

    // Case 6: Both are main-grid root nodes -> swap ONLY if they have identical dimensions
    if (
      !sourceNode.parent_id &&
      !targetNode.parent_id &&
      sourceNode.grid_x > 0 &&
      targetNode.grid_x > 0 &&
      sourceNode.width === targetNode.width &&
      sourceNode.height === targetNode.height
    ) {
      const prevX = sourceNode.grid_x;
      const prevY = sourceNode.grid_y;
      sourceNode.grid_x = targetNode.grid_x;
      sourceNode.grid_y = targetNode.grid_y;
      targetNode.grid_x = prevX;
      targetNode.grid_y = prevY;
      this.persistSnapshot();

      await fetch("/api/v1/nodes/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          {
            id: sourceNode.id,
            sort_order: sourceNode.sort_order,
            grid_x: sourceNode.grid_x,
            grid_y: sourceNode.grid_y,
            width: sourceNode.width,
            height: sourceNode.height,
            parent_id: null,
          },
          {
            id: targetNode.id,
            sort_order: targetNode.sort_order,
            grid_x: targetNode.grid_x,
            grid_y: targetNode.grid_y,
            width: targetNode.width,
            height: targetNode.height,
            parent_id: null,
          },
        ]),
      });
    }
  };

  async createWorkspace(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;

    const res = await fetch("/api/v1/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });

    if (res.ok) {
      const created = (await res.json()) as Workspace;
      this.workspaces.push(created);
      this.selectWorkspace(created.id);
      this.persistSnapshot();
      this.isWorkspaceModalOpen = false;
    }
  }

  openCreateNodeModal(parentId: string | null = null, gridX?: number, gridY?: number): void {
    const coords =
      gridX !== undefined && gridY !== undefined
        ? { x: gridX, y: gridY }
        : (this.findFirstFreeCell(1, 1) ?? { x: 1, y: 1 });
    this.nodeModal = {
      open: true,
      mode: "create",
      id: null,
      parent_id: parentId,
      grid_x: coords.x,
      grid_y: coords.y,
      title: "",
      icon: null,
      node_type: "action",
      url: "https://",
      width: 1,
      height: 1,
    };
  }

  openEditNodeModal(node: DashboardNode, event?: MouseEvent): void {
    event?.stopPropagation();
    event?.preventDefault();
    this.nodeModal = {
      open: true,
      mode: "edit",
      id: node.id,
      parent_id: node.parent_id,
      grid_x: node.grid_x ?? 1,
      grid_y: node.grid_y ?? 1,
      title: node.title,
      icon: node.icon,
      node_type: node.node_type,
      url: node.url ?? "https://",
      width: node.width ?? 1,
      height: node.height ?? 1,
    };
  }

  closeNodeModal(): void {
    this.nodeModal.open = false;
  }

  async saveNodeModal(): Promise<string | null> {
    if (!this.activeWorkspace) return null;

    const isContainer = this.nodeModal.node_type === "container";
    const isDockedOrChild =
      this.nodeModal.parent_id !== null ||
      (this.nodeModal.grid_x === -1 && this.nodeModal.grid_y === -1);

    const width =
      !isContainer || isDockedOrChild
        ? 1
        : Math.max(1, Math.min(BLOCK_COLS, Number(this.nodeModal.width) || 1));
    const height =
      !isContainer || isDockedOrChild
        ? 1
        : Math.max(1, Math.min(BLOCK_ROWS, Number(this.nodeModal.height) || 1));

    let finalX = this.nodeModal.grid_x;
    let finalY = this.nodeModal.grid_y;

    if (!isDockedOrChild) {
      const clamped = this.clampToBlock(finalX, finalY, width, height);
      const ignoreId =
        this.nodeModal.mode === "edit" ? (this.nodeModal.id ?? undefined) : undefined;

      if (this.canPlaceAt(clamped.x, clamped.y, width, height, ignoreId)) {
        finalX = clamped.x;
        finalY = clamped.y;
      } else {
        const fallback = this.findFirstFreeCell(width, height, ignoreId);
        if (!fallback) {
          return `Not enough free space in any 3x4 block for a ${width}x${height} container.`;
        }
        finalX = fallback.x;
        finalY = fallback.y;
      }
    }

    if (this.nodeModal.mode === "create") {
      const siblings = this.nodes.filter(
        (n) =>
          n.workspace_id === this.activeWorkspace!.id &&
          n.parent_id === this.nodeModal.parent_id &&
          (finalX === -1 ? n.grid_x === -1 : n.grid_x > 0),
      );

      const payload = {
        workspace_id: this.activeWorkspace.id,
        parent_id: this.nodeModal.parent_id,
        sort_order: siblings.length + 1,
        grid_x: finalX,
        grid_y: finalY,
        title: this.nodeModal.title.trim() || "Untitled",
        icon: isContainer ? null : this.nodeModal.icon,
        node_type: this.nodeModal.node_type,
        url: isContainer ? null : this.nodeModal.url.trim(),
        width,
        height,
      };

      const res = await fetch("/api/v1/nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const created = (await res.json()) as DashboardNode;
        this.nodes.push(created);
        this.persistSnapshot();
      }
    } else if (this.nodeModal.id) {
      const payload = {
        title: this.nodeModal.title.trim() || "Untitled",
        icon: isContainer ? null : this.nodeModal.icon,
        url: isContainer ? null : this.nodeModal.url.trim(),
        grid_x: finalX,
        grid_y: finalY,
        width,
        height,
      };

      const res = await fetch(`/api/v1/nodes/${this.nodeModal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const updated = (await res.json()) as DashboardNode;
        const idx = this.nodes.findIndex((n) => n.id === updated.id);
        if (idx !== -1) this.nodes[idx] = updated;
        this.persistSnapshot();
      }
    }

    this.nodeModal.open = false;
    return null;
  }

  async deleteNode(id: string, event?: MouseEvent): Promise<void> {
    event?.stopPropagation();
    event?.preventDefault();

    const res = await fetch(`/api/v1/nodes/${id}`, { method: "DELETE" });
    if (res.ok) {
      this.nodes = this.nodes.filter((n) => n.id !== id && n.parent_id !== id);
      if (this.openFolderId === id) this.openFolderId = null;
      this.persistSnapshot();
    }
  }
}

export const dashboard = new DashboardStore();
