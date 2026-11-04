import { arrayMove } from "@dnd-kit/helpers";
import type {
  BootstrapPayload,
  CalendarEvent,
  DashboardNode,
  DragEndEventPayload,
  NodeModalState,
  NodeSettings,
  NodeType,
  SignalDelta,
  TodoItem,
  Workspace,
} from "../types";

const STORAGE_KEY = "homie_snapshot_v7";
const ETAG_KEY = "homie_etag_v7";
const WORKSPACE_STORAGE_KEY = "homie_active_workspace_id";

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

export interface ContextMenuState {
  open: boolean;
  nodeId: string | null;
  x: number;
  y: number;
}

class DashboardStore {
  now = $state<Date>(new Date());

  workspaces = $state<Workspace[]>([]);
  nodes = $state<DashboardNode[]>([]);
  signals = $state<Record<string, unknown>>({});
  activeWorkspaceId = $state<string | null>(null);
  pageSlideDirection = $state<"left" | "right" | null>(null);
  isEditMode = $state<boolean>(false);
  openFolderId = $state<string | null>(null);
  openFolderOrigin = $state<{ cx: number; cy: number } | null>(null);
  flippedNodeId = $state<string | null>(null);
  isWorkspaceModalOpen = $state<boolean>(false);
  isSpotlightOpen = $state<boolean>(false);
  spotlightInitialQuery = $state<string>("");
  hydrationStatus = $state<string>("Cold Boot");

  contextMenu = $state<ContextMenuState>({
    open: false,
    nodeId: null,
    x: 0,
    y: 0,
  });

  activeDragNodeId = $state<string | null>(null);
  dragGrabOffset = $state<{ col: number; row: number }>({ col: 0, row: 0 });
  resizingNodeId = $state<string | null>(null);
  folderMergeTargetId = $state<string | null>(null);
  dropPreview = $state<GridRect | null>(null);
  previewPositions = $state<Record<string, GridRect>>({});

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
    settings: {},
  });

  activeWorkspace = $derived<Workspace | null>(
    this.workspaces.find((w) => w.id === this.activeWorkspaceId) ?? this.workspaces[0] ?? null,
  );

  activeWorkspaceIndex = $derived<number>(
    Math.max(
      0,
      this.workspaces.findIndex((w) => w.id === this.activeWorkspace?.id),
    ),
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
      .sort((a, b) => a.grid_y - b.grid_y || a.grid_x - b.grid_x || a.sort_order - b.sort_order),
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

  dockActionNodes = $derived<DashboardNode[]>(
    this.dockNodes.filter((n) => n.node_type === "action"),
  );

  dockContainerNodes = $derived<DashboardNode[]>(
    this.dockNodes.filter((n) => n.node_type === "container"),
  );

  openFolder = $derived<DashboardNode | null>(
    this.nodes.find((n) => n.id === this.openFolderId) ?? null,
  );

  contextMenuNode = $derived<DashboardNode | null>(
    this.nodes.find((n) => n.id === this.contextMenu.nodeId) ?? null,
  );

  defaultSearchEngineUrl = $derived<string>(
    this.nodes.find((n) => n.node_type === "search" && n.settings?.engineUrl)?.settings
      ?.engineUrl ?? "https://www.google.com/search?q=",
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
    const clockTimer = setInterval(() => {
      this.now = new Date();
    }, 1000);

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

    return () => {
      clearInterval(clockTimer);
      sse.close();
    };
  }

  openSpotlight(initialQuery = ""): void {
    this.closeContextMenu();
    this.flippedNodeId = null;
    this.spotlightInitialQuery = initialQuery;
    this.isSpotlightOpen = true;
  }

  closeSpotlight(): void {
    this.isSpotlightOpen = false;
    this.spotlightInitialQuery = "";
  }

  toggleSpotlight(): void {
    if (this.isSpotlightOpen) {
      this.closeSpotlight();
    } else {
      this.openSpotlight();
    }
  }

  async quickAddReminder(text: string): Promise<boolean> {
    const trimmed = text.trim();
    if (!trimmed) return false;

    const todoNode =
      this.nodes.find(
        (n) => n.workspace_id === this.activeWorkspace?.id && n.node_type === "todo",
      ) ?? this.nodes.find((n) => n.node_type === "todo");

    if (!todoNode) return false;

    const currentTodos = todoNode.settings?.todos ?? [];
    const newItem: TodoItem = {
      id: crypto.randomUUID(),
      text: trimmed,
      priority: trimmed.endsWith("!"),
      done: false,
    };

    await this.updateNodeSettings(todoNode.id, {
      ...todoNode.settings,
      todos: [...currentTodos, newItem],
    });
    return true;
  }

  async quickAddCalendarEvent(rawInput: string): Promise<boolean> {
    const trimmed = rawInput.trim();
    if (!trimmed) return false;

    const calNode =
      this.nodes.find(
        (n) => n.workspace_id === this.activeWorkspace?.id && n.node_type === "calendar",
      ) ?? this.nodes.find((n) => n.node_type === "calendar");

    if (!calNode) return false;

    let time = "All day";
    let title = trimmed;
    const match = trimmed.match(/^(\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?)\s+(.+)$/);
    if (match) {
      time = match[1];
      title = match[2];
    }

    const currentEvents = calNode.settings?.events ?? [];
    const newEvent: CalendarEvent = {
      id: crypto.randomUUID(),
      title,
      time,
      color: "#0A84FF",
    };

    await this.updateNodeSettings(calNode.id, {
      ...calNode.settings,
      events: [...currentEvents, newEvent],
    });
    return true;
  }

  openFolderWithOrigin(nodeId: string, originEl?: HTMLElement | null): void {
    this.closeContextMenu();
    this.flippedNodeId = null;
    if (originEl) {
      const rect = originEl.getBoundingClientRect();
      this.openFolderOrigin = {
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2,
      };
    } else {
      this.openFolderOrigin = null;
    }
    this.openFolderId = nodeId;
  }

  openContextMenu(node: DashboardNode, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.flippedNodeId = null;

    const menuWidth = 228;
    const menuHeight = 260;
    const pad = 16;

    const x = Math.max(pad, Math.min(event.clientX + 8, window.innerWidth - menuWidth - pad));
    const y = Math.max(pad, Math.min(event.clientY + 4, window.innerHeight - menuHeight - pad));

    this.contextMenu = {
      open: true,
      nodeId: node.id,
      x,
      y,
    };
  }

  closeContextMenu(): void {
    if (this.contextMenu.open) {
      this.contextMenu.open = false;
      this.contextMenu.nodeId = null;
    }
  }

  inspectNode(node: DashboardNode, event?: MouseEvent): void {
    event?.stopPropagation();
    event?.preventDefault();
    this.closeContextMenu();

    const isRootMultiCellWidget =
      !node.parent_id &&
      node.grid_x > 0 &&
      node.node_type !== "action" &&
      (node.width >= 2 || node.height >= 2);

    if (isRootMultiCellWidget) {
      this.flippedNodeId = this.flippedNodeId === node.id ? null : node.id;
    } else {
      this.openEditNodeModal(node);
    }
  }

  async saveFlippedWidget(
    nodeId: string,
    updates: {
      title: string;
      width?: number;
      height?: number;
      settings: NodeSettings;
    },
  ): Promise<void> {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    const nextTitle = updates.title.trim() || node.title;
    const nextW = updates.width ?? node.width;
    const nextH = updates.height ?? node.height;

    if (nextW !== node.width || nextH !== node.height) {
      const clamped = this.clampToGrid(node.grid_x, node.grid_y, nextW, nextH);
      const layout = this.computeReflowedPositions(node.id, clamped);
      if (layout) {
        this.previewPositions = layout;
        await this.commitPreviewLayout();
      }
    }

    node.title = nextTitle;
    node.settings = updates.settings;
    this.flippedNodeId = null;
    this.persistSnapshot();

    void fetch(`/api/v1/nodes/${nodeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: nextTitle,
        width: node.width,
        height: node.height,
        settings: updates.settings,
      }),
    });
  }

  async renameNode(nodeId: string, newTitle: string): Promise<void> {
    const node = this.nodes.find((n) => n.id === nodeId);
    const trimmed = newTitle.trim();
    if (!node || !trimmed || node.title === trimmed) return;

    node.title = trimmed;
    this.persistSnapshot();

    void fetch(`/api/v1/nodes/${nodeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: trimmed }),
    });
  }

  async duplicateNode(nodeId: string): Promise<void> {
    this.closeContextMenu();
    const source = this.nodes.find((n) => n.id === nodeId);
    if (!source || !this.activeWorkspace) return;

    const free = this.findFirstFreeCell(source.width || 1, source.height || 1);
    if (!free) return;

    const nowIso = new Date().toISOString();
    const optimisticNode: DashboardNode = {
      id: crypto.randomUUID(),
      workspace_id: this.activeWorkspace.id,
      parent_id: null,
      sort_order: free.y * 100 + free.x,
      grid_x: free.x,
      grid_y: free.y,
      title: source.title,
      icon: source.icon,
      node_type: source.node_type,
      url: source.url,
      width: source.width || 1,
      height: source.height || 1,
      settings: structuredClone($state.snapshot(source.settings ?? {})),
      created_at: nowIso,
      updated_at: nowIso,
    };

    this.nodes.push(optimisticNode);
    this.persistSnapshot();

    const res = await fetch("/api/v1/nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(optimisticNode),
    });

    if (!res.ok) {
      this.nodes = this.nodes.filter((n) => n.id !== optimisticNode.id);
      this.persistSnapshot();
    }
  }

  async extractNodeFromFolderToGrid(nodeId: string): Promise<void> {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node || !node.parent_id) return;

    const free = this.findFirstFreeCell(1, 1);
    if (!free) return;

    node.parent_id = null;
    node.grid_x = free.x;
    node.grid_y = free.y;
    node.width = 1;
    node.height = 1;
    node.sort_order = free.y * 100 + free.x;
    this.openFolderId = null;
    this.persistSnapshot();

    void fetch("/api/v1/nodes/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        {
          id: node.id,
          sort_order: node.sort_order,
          grid_x: free.x,
          grid_y: free.y,
          width: 1,
          height: 1,
          parent_id: null,
        },
      ]),
    });
  }

  /**
   * Returns the effective live coordinates & dimensions of a node.
   * CRITICAL: While `activeDragNodeId === node.id`, keep the dragged node anchored
   * at its original DOM grid cell so `@dnd-kit`'s `translate3d` transform tracks
   * the pointer smoothly without fighting CSS Grid placement.
   */
  getEffectiveRect(node: DashboardNode): GridRect {
    if (this.activeDragNodeId === node.id) {
      return {
        x: node.grid_x,
        y: node.grid_y,
        w: node.width || 1,
        h: node.height || 1,
      };
    }
    const preview = this.previewPositions[node.id];
    if (preview) return preview;
    return {
      x: node.grid_x,
      y: node.grid_y,
      w: node.width || 1,
      h: node.height || 1,
    };
  }

  setDragGrabOffset(colOffset: number, rowOffset: number): void {
    this.dragGrabOffset = {
      col: Math.max(0, colOffset),
      row: Math.max(0, rowOffset),
    };
  }

  snapToWidgetPreset(nodeType: NodeType, rawW: number, rawH: number): WidgetSizePreset {
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

  clampToGrid(x: number, y: number, width: number, height: number): GridRect {
    const w = Math.max(1, Math.min(width, GRID_COLS));
    const h = Math.max(1, Math.min(height, GRID_ROWS));
    const clampedX = Math.max(1, Math.min(x, GRID_COLS - w + 1));
    const clampedY = Math.max(1, Math.min(y, GRID_ROWS - h + 1));
    return { x: clampedX, y: clampedY, w, h };
  }

  sanitizeAllWorkspaces(): void {
    for (const ws of this.workspaces) {
      const wsNodes = this.nodes
        .filter((n) => n.workspace_id === ws.id && !n.parent_id && n.grid_x > 0)
        .sort((a, b) => a.grid_y - b.grid_y || a.grid_x - b.grid_x || a.sort_order - b.sort_order);

      const placed: DashboardNode[] = [];
      for (const n of wsNodes) {
        if (!n.settings) n.settings = {};
        const clamped = this.clampToGrid(n.grid_x, n.grid_y, n.width || 1, n.height || 1);
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

  private rectsOverlap(a: GridRect, b: GridRect): boolean {
    return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
  }

  private canFitRectAmong(rect: GridRect, placed: GridRect[]): boolean {
    if (
      rect.x < 1 ||
      rect.y < 1 ||
      rect.x + rect.w - 1 > GRID_COLS ||
      rect.y + rect.h - 1 > GRID_ROWS
    ) {
      return false;
    }
    for (const other of placed) {
      if (this.rectsOverlap(rect, other)) return false;
    }
    return true;
  }

  private findClosestSlotAmong(
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
        if (this.canFitRectAmong({ x, y, w, h }, placed)) {
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

  computeReflowedPositions(
    activeNodeId: string,
    targetRect: GridRect,
  ): Record<string, GridRect> | null {
    const clampedTarget = this.clampToGrid(targetRect.x, targetRect.y, targetRect.w, targetRect.h);

    const activeNode = this.nodes.find((n) => n.id === activeNodeId);
    const activeOrigin: GridRect | null =
      activeNode && !activeNode.parent_id && activeNode.grid_x > 0
        ? {
            x: activeNode.grid_x,
            y: activeNode.grid_y,
            w: activeNode.width || 1,
            h: activeNode.height || 1,
          }
        : null;

    const others = this.rootNodes.filter((n) => n.id !== activeNodeId);

    const result: Record<string, GridRect> = {
      [activeNodeId]: clampedTarget,
    };
    const occupied: GridRect[] = [clampedTarget];
    const displaced: DashboardNode[] = [];

    for (const node of others) {
      const rect: GridRect = {
        x: node.grid_x,
        y: node.grid_y,
        w: node.width || 1,
        h: node.height || 1,
      };
      if (!this.rectsOverlap(clampedTarget, rect)) {
        result[node.id] = rect;
        occupied.push(rect);
      } else {
        displaced.push(node);
      }
    }

    let pass1Success = true;
    for (const node of displaced) {
      const w = node.width || 1;
      const h = node.height || 1;

      if (
        activeOrigin &&
        this.canFitRectAmong({ x: activeOrigin.x, y: activeOrigin.y, w, h }, occupied)
      ) {
        const swapped = { x: activeOrigin.x, y: activeOrigin.y, w, h };
        result[node.id] = swapped;
        occupied.push(swapped);
        continue;
      }

      const closest = this.findClosestSlotAmong(node.grid_x, node.grid_y, w, h, occupied);
      if (closest) {
        const placedRect = { x: closest.x, y: closest.y, w, h };
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
      const w = node.width || 1;
      const h = node.height || 1;
      const currentRect: GridRect = { x: node.grid_x, y: node.grid_y, w, h };

      if (this.canFitRectAmong(currentRect, cascadeOccupied)) {
        cascadeResult[node.id] = currentRect;
        cascadeOccupied.push(currentRect);
      } else {
        const closest = this.findClosestSlotAmong(node.grid_x, node.grid_y, w, h, cascadeOccupied);
        if (!closest) return null;
        const placedRect = { x: closest.x, y: closest.y, w, h };
        cascadeResult[node.id] = placedRect;
        cascadeOccupied.push(placedRect);
      }
    }

    return cascadeResult;
  }

  setFolderMergeTarget(targetId: string | null): void {
    this.folderMergeTargetId = targetId;
    if (targetId) {
      this.dropPreview = null;
      this.previewPositions = {};
    }
  }

  updateDragReflow(rawCol: number, rawRow: number): void {
    if (!this.isEditMode || !this.activeDragNodeId || this.folderMergeTargetId) return;
    const dragged = this.nodes.find((n) => n.id === this.activeDragNodeId);
    if (!dragged) return;

    const w = dragged.parent_id || dragged.grid_x === -1 ? 1 : dragged.width || 1;
    const h = dragged.parent_id || dragged.grid_y === -1 ? 1 : dragged.height || 1;

    const targetX = rawCol - Math.min(this.dragGrabOffset.col, w - 1);
    const targetY = rawRow - Math.min(this.dragGrabOffset.row, h - 1);
    const clamped = this.clampToGrid(targetX, targetY, w, h);

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
  }

  startResize(nodeId: string): void {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    this.resizingNodeId = nodeId;
    const rect: GridRect = {
      x: node.grid_x,
      y: node.grid_y,
      w: node.width || 1,
      h: node.height || 1,
    };
    this.dropPreview = rect;
    this.previewPositions = { [node.id]: rect };
  }

  updateResizePreview(nodeId: string, rawW: number, rawH: number): void {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    const preset = this.snapToWidgetPreset(node.node_type, rawW, rawH);
    const clamped = this.clampToGrid(node.grid_x, node.grid_y, preset.w, preset.h);

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
    this.closeContextMenu();
    const clamped = this.clampToGrid(node.grid_x, node.grid_y, w, h);
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

    const currentIdx = presets.findIndex(
      (p) => p.w === (node.width || 1) && p.h === (node.height || 1),
    );
    const nextPreset = presets[(currentIdx + 1) % presets.length];
    await this.setNodeSizePreset(node, nextPreset.w, nextPreset.h);
  }

  private async commitPreviewLayout(): Promise<void> {
    const entries = Object.entries(this.previewPositions);
    if (entries.length === 0) {
      this.clearDragPreview();
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
      const node = this.nodes.find((n) => n.id === id);
      if (!node) continue;

      const nextSortOrder = rect.y * 100 + rect.x;
      const changed =
        node.parent_id !== null ||
        node.grid_x !== rect.x ||
        node.grid_y !== rect.y ||
        node.width !== rect.w ||
        node.height !== rect.h ||
        node.sort_order !== nextSortOrder;

      node.parent_id = null;
      node.grid_x = rect.x;
      node.grid_y = rect.y;
      node.width = rect.w;
      node.height = rect.h;
      node.sort_order = nextSortOrder;

      if (changed) {
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
    this.persistSnapshot();

    if (updates.length > 0) {
      void fetch("/api/v1/nodes/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
    }
  }

  private async mergeNodesIntoFolder(
    sourceNode: DashboardNode,
    targetNode: DashboardNode,
  ): Promise<void> {
    if (sourceNode.node_type !== "action" || sourceNode.id === targetNode.id) return;

    if (targetNode.node_type === "container") {
      const existingChildren = this.getChildren(targetNode.id);
      sourceNode.parent_id = targetNode.id;
      sourceNode.grid_x = 1;
      sourceNode.grid_y = 1;
      sourceNode.width = 1;
      sourceNode.height = 1;
      sourceNode.sort_order = existingChildren.length + 1;
      this.persistSnapshot();

      void fetch("/api/v1/nodes/reorder", {
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

      this.nodes.push(createdFolder);

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

      this.persistSnapshot();

      const res = await fetch("/api/v1/nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createdFolder),
      });

      if (res.ok) {
        void fetch("/api/v1/nodes/reorder", {
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

  private canFitAmong(
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

  private findFreeSlotAmong(
    width: number,
    height: number,
    existing: DashboardNode[],
  ): { x: number; y: number } | null {
    for (let y = 1; y <= GRID_ROWS - height + 1; y++) {
      for (let x = 1; x <= GRID_COLS - width + 1; x++) {
        if (this.canFitAmong(x, y, width, height, existing)) {
          return { x, y };
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
    if (id === this.activeWorkspace?.id) return;
    const oldIndex = this.activeWorkspaceIndex;
    const newIndex = this.workspaces.findIndex((w) => w.id === id);
    if (newIndex !== -1) {
      this.pageSlideDirection = newIndex > oldIndex ? "right" : "left";
    }
    this.activeWorkspaceId = id;
    localStorage.setItem(WORKSPACE_STORAGE_KEY, id);
    this.openFolderId = null;
    this.flippedNodeId = null;
    this.closeContextMenu();
    this.clearDragPreview();
  }

  selectNextWorkspace(): boolean {
    if (this.workspaces.length <= 1) return false;
    const nextIdx = this.activeWorkspaceIndex + 1;
    if (nextIdx >= this.workspaces.length) return false;
    this.selectWorkspace(this.workspaces[nextIdx].id);
    return true;
  }

  selectPrevWorkspace(): boolean {
    if (this.workspaces.length <= 1) return false;
    const prevIdx = this.activeWorkspaceIndex - 1;
    if (prevIdx < 0) return false;
    this.selectWorkspace(this.workspaces[prevIdx].id);
    return true;
  }

  async moveNodeToWorkspace(nodeId: string, targetWorkspaceId: string): Promise<void> {
    this.closeContextMenu();
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node || node.workspace_id === targetWorkspaceId) return;

    const targetRootNodes = this.nodes.filter(
      (n) =>
        n.workspace_id === targetWorkspaceId && !n.parent_id && n.grid_x > 0 && n.id !== nodeId,
    );

    let nextX = node.grid_x > 0 ? node.grid_x : 1;
    let nextY = node.grid_y > 0 ? node.grid_y : 1;
    if (!this.canFitAmong(nextX, nextY, node.width, node.height, targetRootNodes)) {
      const free = this.findFreeSlotAmong(node.width, node.height, targetRootNodes);
      if (free) {
        nextX = free.x;
        nextY = free.y;
      }
    }

    node.workspace_id = targetWorkspaceId;
    node.parent_id = null;
    node.grid_x = nextX;
    node.grid_y = nextY;
    this.persistSnapshot();

    void fetch(`/api/v1/nodes/${node.id}`, {
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
    this.isEditMode = !this.isEditMode;
    this.closeContextMenu();
    if (!this.isEditMode) {
      this.flippedNodeId = null;
      this.clearDragPreview();
    }
  }

  enterEditMode(): void {
    this.closeContextMenu();
    if (!this.isEditMode) {
      this.isEditMode = true;
    }
  }

  exitEditMode(): void {
    this.closeContextMenu();
    this.flippedNodeId = null;
    if (this.isEditMode) {
      this.isEditMode = false;
      this.clearDragPreview();
    }
  }

  handleDragStart = (event: { operation?: { source?: { id?: string | number } | null } }): void => {
    this.closeContextMenu();
    this.flippedNodeId = null;
    const id = event.operation?.source?.id;
    this.activeDragNodeId = id ? String(id) : null;
    this.folderMergeTargetId = null;
    if (this.activeDragNodeId) {
      const node = this.nodes.find((n) => n.id === this.activeDragNodeId);
      if (node && !node.parent_id && node.grid_x > 0) {
        const rect: GridRect = {
          x: node.grid_x,
          y: node.grid_y,
          w: node.width || 1,
          h: node.height || 1,
        };
        this.dropPreview = rect;
        this.previewPositions = { [node.id]: rect };
      }
    }
  };

  /**
   * Called directly by `@dnd-kit/svelte` whenever a dragged item hovers over a droppable
   * (`cell:x:y`, another `SortableNode`, or `dock:dropzone`).
   */
  handleDragOver = (event: DragEndEventPayload): void => {
    if (!this.isEditMode || !this.activeDragNodeId) return;
    const rawTargetId = event.operation?.target?.id;
    if (!rawTargetId) return;
    const targetId = String(rawTargetId);

    if (targetId === "dock:dropzone") {
      this.dropPreview = null;
      this.previewPositions = {};
      return;
    }

    if (targetId.startsWith("cell:")) {
      const parts = targetId.split(":");
      const col = Number(parts[1]);
      const row = Number(parts[2]);
      if (col >= 1 && row >= 1) {
        this.updateDragReflow(col, row);
      }
      return;
    }

    if (targetId !== this.activeDragNodeId) {
      const targetNode = this.nodes.find((n) => n.id === targetId);
      if (targetNode && !targetNode.parent_id && targetNode.grid_x > 0) {
        this.updateDragReflow(
          targetNode.grid_x + this.dragGrabOffset.col,
          targetNode.grid_y + this.dragGrabOffset.row,
        );
      }
    }
  };

  handleDragEnd = async (event: DragEndEventPayload): Promise<void> => {
    const draggedId = this.activeDragNodeId;
    const mergeTargetId = this.folderMergeTargetId;
    this.activeDragNodeId = null;
    this.folderMergeTargetId = null;
    this.dragGrabOffset = { col: 0, row: 0 };

    if (event.canceled || !this.isEditMode) {
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

    const sourceNode = this.nodes.find((n) => n.id === sourceId);
    if (!sourceNode) {
      this.clearDragPreview();
      return;
    }

    // Case 0: Folder Creation / Container Drop via Dwell-Hold Gesture
    if (mergeTargetId && mergeTargetId !== sourceId) {
      const mergeTargetNode = this.nodes.find((n) => n.id === mergeTargetId);
      if (mergeTargetNode) {
        this.clearDragPreview();
        await this.mergeNodesIntoFolder(sourceNode, mergeTargetNode);
        return;
      }
    }

    // Case 1: Dropped onto the bottom Dock dropzone ("dock:dropzone")
    if (targetId === "dock:dropzone") {
      this.clearDragPreview();
      if (sourceNode.node_type !== "action" && sourceNode.node_type !== "container") {
        return;
      }
      sourceNode.parent_id = null;
      sourceNode.grid_x = -1;
      sourceNode.grid_y = -1;
      sourceNode.width = 1;
      sourceNode.height = 1;
      sourceNode.sort_order = this.dockNodes.length + 1;
      this.persistSnapshot();

      void fetch("/api/v1/nodes/reorder", {
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

    const targetNode = targetId ? this.nodes.find((n) => n.id === targetId) : undefined;

    // Case 2: Dropped onto a node inside the Dock (-1, -1) -> dock & reorder
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

      void fetch("/api/v1/nodes/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      return;
    }

    // Case 3: Both nodes are inside the same container -> reorder children
    if (
      targetNode &&
      sourceNode.parent_id &&
      sourceNode.parent_id === targetNode.parent_id &&
      sourceId !== targetId
    ) {
      this.clearDragPreview();
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

      void fetch("/api/v1/nodes/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      return;
    }

    // Case 4: Dragging an action node onto a child inside a container
    if (targetNode && sourceNode.node_type === "action" && targetNode.parent_id) {
      this.clearDragPreview();
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

      void fetch("/api/v1/nodes/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      return;
    }

    // Case 5: Commit active Elastic Grid Reflow preview
    if (this.dropPreview && Object.keys(this.previewPositions).length > 0) {
      await this.commitPreviewLayout();
      return;
    }

    // Case 6: Fallback if dropped directly onto a cell:x:y or root targetNode
    if (targetId.startsWith("cell:")) {
      const parts = targetId.split(":");
      this.updateDragReflow(Number(parts[1]), Number(parts[2]));
      await this.commitPreviewLayout();
      return;
    }

    if (targetNode && !targetNode.parent_id && targetNode.grid_x > 0) {
      const layout = this.computeReflowedPositions(sourceNode.id, {
        x: targetNode.grid_x,
        y: targetNode.grid_y,
        w: sourceNode.width || 1,
        h: sourceNode.height || 1,
      });
      if (layout) {
        this.previewPositions = layout;
        await this.commitPreviewLayout();
        return;
      }
    }

    this.clearDragPreview();
  };

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

    this.workspaces.push(optimisticWs);
    this.selectWorkspace(optimisticWs.id);
    this.persistSnapshot();
    this.isWorkspaceModalOpen = false;

    const res = await fetch("/api/v1/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: optimisticWs.id, name: trimmed }),
    });

    if (!res.ok) {
      this.workspaces = this.workspaces.filter((w) => w.id !== optimisticWs.id);
      if (this.workspaces.length > 0) {
        this.selectWorkspace(this.workspaces[0].id);
      }
      this.persistSnapshot();
    }
  }

  async deleteWorkspace(id: string, event?: MouseEvent): Promise<void> {
    event?.stopPropagation();
    event?.preventDefault();
    if (this.workspaces.length <= 1) return;

    const prevWorkspaces = [...this.workspaces];
    const prevNodes = [...this.nodes];
    const deletedIdx = this.workspaces.findIndex((w) => w.id === id);

    this.workspaces = this.workspaces.filter((w) => w.id !== id);
    this.nodes = this.nodes.filter((n) => n.workspace_id !== id);

    if (this.activeWorkspaceId === id && this.workspaces.length > 0) {
      const fallbackIdx = Math.max(0, deletedIdx - 1);
      this.selectWorkspace(this.workspaces[fallbackIdx].id);
    }
    this.persistSnapshot();

    const res = await fetch(`/api/v1/workspaces/${id}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      this.workspaces = prevWorkspaces;
      this.nodes = prevNodes;
      this.persistSnapshot();
    }
  }

  openCreateNodeModal(parentId: string | null = null, gridX?: number, gridY?: number): void {
    this.closeContextMenu();
    this.flippedNodeId = null;
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
      settings: {
        timezone: "Europe/Amsterdam",
        flag: "🇳🇱",
        clockFace: "analog",
        placeholder: "Search the Web...",
        engineUrl: "https://www.google.com/search?q=",
        todos: [],
        events: [],
      },
    };
  }

  openEditNodeModal(node: DashboardNode, event?: MouseEvent): void {
    event?.stopPropagation();
    event?.preventDefault();
    this.closeContextMenu();
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
      settings: structuredClone($state.snapshot(node.settings ?? {})),
    };
  }

  closeNodeModal(): void {
    this.nodeModal.open = false;
  }

  async updateNodeSettings(nodeId: string, newSettings: NodeSettings): Promise<void> {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    node.settings = newSettings;
    this.persistSnapshot();

    void fetch(`/api/v1/nodes/${nodeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: newSettings }),
    });
  }

  async saveNodeModal(): Promise<string | null> {
    if (!this.activeWorkspace) return null;

    const isAction = this.nodeModal.node_type === "action";
    const isDockedOrChild =
      this.nodeModal.parent_id !== null ||
      (this.nodeModal.grid_x === -1 && this.nodeModal.grid_y === -1);

    const width =
      isAction || isDockedOrChild
        ? 1
        : Math.max(1, Math.min(GRID_COLS, Number(this.nodeModal.width) || 1));
    const height =
      isAction || isDockedOrChild
        ? 1
        : Math.max(1, Math.min(GRID_ROWS, Number(this.nodeModal.height) || 1));

    let finalX = this.nodeModal.grid_x;
    let finalY = this.nodeModal.grid_y;

    if (!isDockedOrChild) {
      const clamped = this.clampToGrid(finalX, finalY, width, height);
      const ignoreId =
        this.nodeModal.mode === "edit" ? (this.nodeModal.id ?? undefined) : undefined;

      if (this.canPlaceAt(clamped.x, clamped.y, width, height, ignoreId)) {
        finalX = clamped.x;
        finalY = clamped.y;
      } else {
        const fallback = this.findFirstFreeCell(width, height, ignoreId);
        if (!fallback) {
          return `Not enough free space on the 16x8 grid for a ${width}x${height} node.`;
        }
        finalX = fallback.x;
        finalY = fallback.y;
      }
    }

    const defaultTitleMap: Record<NodeType, string> = {
      action: "Untitled",
      container: "Folder",
      clock: "Amsterdam",
      search: "Search",
      todo: "Reminders",
      calendar: "Calendar",
    };

    const finalTitle = this.nodeModal.title.trim() || defaultTitleMap[this.nodeModal.node_type];

    if (this.nodeModal.mode === "create") {
      const siblings = this.nodes.filter(
        (n) =>
          n.workspace_id === this.activeWorkspace!.id &&
          n.parent_id === this.nodeModal.parent_id &&
          (finalX === -1 ? n.grid_x === -1 : n.grid_x > 0),
      );

      const nowIso = new Date().toISOString();
      const optimisticNode: DashboardNode = {
        id: crypto.randomUUID(),
        workspace_id: this.activeWorkspace.id,
        parent_id: this.nodeModal.parent_id,
        sort_order: finalX > 0 ? finalY * 100 + finalX : siblings.length + 1,
        grid_x: finalX,
        grid_y: finalY,
        title: finalTitle,
        icon: isAction ? this.nodeModal.icon : null,
        node_type: this.nodeModal.node_type,
        url: isAction ? this.nodeModal.url.trim() : null,
        width,
        height,
        settings: structuredClone($state.snapshot(this.nodeModal.settings)),
        created_at: nowIso,
        updated_at: nowIso,
      };

      this.nodes.push(optimisticNode);
      this.nodeModal.open = false;
      this.persistSnapshot();

      const res = await fetch("/api/v1/nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(optimisticNode),
      });

      if (!res.ok) {
        this.nodes = this.nodes.filter((n) => n.id !== optimisticNode.id);
        this.persistSnapshot();
      }
    } else if (this.nodeModal.id) {
      const nodeId = this.nodeModal.id;
      const existing = this.nodes.find((n) => n.id === nodeId);
      if (existing) {
        existing.title = finalTitle;
        existing.icon = isAction ? this.nodeModal.icon : null;
        existing.url = isAction ? this.nodeModal.url.trim() : null;
        existing.grid_x = finalX;
        existing.grid_y = finalY;
        existing.width = width;
        existing.height = height;
        existing.settings = structuredClone($state.snapshot(this.nodeModal.settings));
      }

      this.nodeModal.open = false;
      this.persistSnapshot();

      void fetch(`/api/v1/nodes/${nodeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: finalTitle,
          icon: isAction ? this.nodeModal.icon : null,
          url: isAction ? this.nodeModal.url.trim() : null,
          grid_x: finalX,
          grid_y: finalY,
          width,
          height,
          settings: this.nodeModal.settings,
        }),
      });
    }

    return null;
  }

  async deleteNode(id: string, event?: MouseEvent): Promise<void> {
    event?.stopPropagation();
    event?.preventDefault();
    this.closeContextMenu();

    const prevNodes = [...this.nodes];
    this.nodes = this.nodes.filter((n) => n.id !== id && n.parent_id !== id);
    if (this.openFolderId === id) this.openFolderId = null;
    if (this.flippedNodeId === id) this.flippedNodeId = null;
    this.persistSnapshot();

    const res = await fetch(`/api/v1/nodes/${id}`, { method: "DELETE" });
    if (!res.ok) {
      this.nodes = prevNodes;
      this.persistSnapshot();
    }
  }
}

export const dashboard = new DashboardStore();
