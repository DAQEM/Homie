import type { BootstrapPayload, DashboardNode, SignalDelta, Workspace } from "../types";
import {
  ETAG_KEY,
  GRID_COLS,
  GRID_ROWS,
  STORAGE_KEY,
  WORKSPACE_STORAGE_KEY,
  getGridColsForWidth,
  type GridRect,
} from "./constants";
import {
  canFitAmongNodes,
  clampToGrid,
  computeResponsivePacking,
  findFreeSlotAmongNodes,
} from "./grid-math";
import type { PagingController } from "./paging.svelte";

function readStoredWorkspaceId(): string | null {
  if (typeof sessionStorage !== "undefined") {
    const tabWs = sessionStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (tabWs) return tabWs;
  }
  return localStorage.getItem(WORKSPACE_STORAGE_KEY);
}

function writeStoredWorkspaceId(id: string): void {
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(WORKSPACE_STORAGE_KEY, id);
  }
  localStorage.setItem(WORKSPACE_STORAGE_KEY, id);
}

export class SessionStore {
  now = $state<Date>(new Date());
  isDocumentVisible = $state<boolean>(true);
  viewportWidth = $state<number>(typeof window !== "undefined" ? window.innerWidth : 1280);

  workspaces = $state<Workspace[]>([]);
  nodes = $state<DashboardNode[]>([]);
  preferences = $state<Record<string, unknown>>({});
  signals = $state<Record<string, unknown>>({});
  activeWorkspaceId = $state<string | null>(null);
  isEditMode = $state<boolean>(false);
  hydrationStatus = $state<string>("Cold Boot");

  private currentETag: string | null = localStorage.getItem(ETAG_KEY);
  private pagingRef: PagingController | null = null;
  private onPreferencesLoadedCb: ((prefs: Record<string, unknown>) => void) | null = null;
  private isInteractionBusyFn: (() => boolean) | null = null;
  private bootstrapRefreshInFlight = false;
  private pendingBootstrapSync = false;

  activeGridCols = $derived<number>(getGridColsForWidth(this.viewportWidth));

  activeWorkspace = $derived<Workspace | null>(
    this.workspaces.find((w) => w.id === this.activeWorkspaceId) ?? this.workspaces[0] ?? null,
  );

  activeWorkspaceIndex = $derived<number>(
    Math.max(
      0,
      this.workspaces.findIndex((w) => w.id === this.activeWorkspace?.id),
    ),
  );

  rootNodes = $derived<DashboardNode[]>(this.getWorkspaceRootNodes(this.activeWorkspace?.id ?? ""));

  // Computed responsive coordinates across all workspace pages (so horizontal swipe transitions match)
  responsiveRootRects = $derived.by<Record<string, GridRect>>(() => {
    const merged: Record<string, GridRect> = {};
    for (const ws of this.workspaces) {
      const wsNodes = this.getWorkspaceRootNodes(ws.id);
      Object.assign(merged, computeResponsivePacking(wsNodes, this.activeGridCols));
    }
    return merged;
  });

  activeGridRows = $derived.by<number>(() => {
    if (this.activeGridCols >= GRID_COLS) return GRID_ROWS;
    let maxBottom = GRID_ROWS;
    for (const n of this.rootNodes) {
      const r = this.responsiveRootRects[n.id];
      if (r) {
        maxBottom = Math.max(maxBottom, r.y + r.h - 1);
      }
    }
    return maxBottom;
  });

  dockNodes = $derived<DashboardNode[]>(
    this.nodes
      .filter((n) => !n.parent_id && n.grid_x === -1 && n.grid_y === -1)
      .sort((a, b) => a.sort_order - b.sort_order),
  );

  dockActionNodes = $derived<DashboardNode[]>(
    this.dockNodes.filter((n) => n.node_type === "action"),
  );

  dockContainerNodes = $derived<DashboardNode[]>(
    this.dockNodes.filter((n) => n.node_type === "container"),
  );

  constructor() {
    const cachedRaw = localStorage.getItem(STORAGE_KEY);
    if (cachedRaw) {
      try {
        const data = JSON.parse(cachedRaw) as Partial<BootstrapPayload>;
        this.workspaces = data.workspaces ?? [];
        this.nodes = data.nodes ?? [];
        this.preferences = data.preferences ?? {};
        this.signals = data.signals ?? {};
        this.sanitizeAllWorkspaces();
        this.pruneOrphanedSignals();
        this.hydrationStatus = "Phase 0: Local Snapshot";
      } catch {
        // Ignore invalid cache
      }
    }

    const savedWsId = readStoredWorkspaceId();
    if (savedWsId && this.workspaces.some((w) => w.id === savedWsId)) {
      this.activeWorkspaceId = savedWsId;
      writeStoredWorkspaceId(savedWsId);
    } else if (this.workspaces.length > 0) {
      this.activeWorkspaceId = this.workspaces[0].id;
    }
  }

  init(
    paging: PagingController,
    onPreferencesLoaded?: (prefs: Record<string, unknown>) => void,
    isInteractionBusy?: () => boolean,
  ): () => void {
    this.pagingRef = paging;
    this.onPreferencesLoadedCb = onPreferencesLoaded ?? null;
    this.isInteractionBusyFn = isInteractionBusy ?? null;

    if (Object.keys(this.preferences).length > 0) {
      this.onPreferencesLoadedCb?.(this.preferences);
    }

    let clockTimer: ReturnType<typeof setInterval> | null = null;

    const startClock = () => {
      if (clockTimer) clearInterval(clockTimer);
      this.now = new Date();
      clockTimer = setInterval(() => {
        this.now = new Date();
      }, 1000);
    };

    const stopClock = () => {
      if (clockTimer) {
        clearInterval(clockTimer);
        clockTimer = null;
      }
    };

    const handleVisibilityChange = () => {
      const visible = document.visibilityState !== "hidden";
      this.isDocumentVisible = visible;
      if (visible) {
        startClock();
      } else {
        stopClock();
      }
    };

    const handleResize = () => {
      this.viewportWidth = window.innerWidth;
    };

    startClock();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("resize", handleResize, { passive: true });
    }

    void this.refreshBootstrap(false);

    const sse = new EventSource("/api/v1/live");
    sse.onmessage = (event: MessageEvent<string>) => {
      const delta = JSON.parse(event.data) as SignalDelta;
      this.signals[delta.key] = delta.value;
      this.hydrationStatus = "Phase 2: Live SSE";

      // Real-time multi-tab / multi-device structural sync
      if (
        delta.key === "system:snapshot:etag" &&
        typeof delta.value === "string" &&
        delta.value !== this.currentETag
      ) {
        if (this.isInteractionBusyFn?.()) {
          this.pendingBootstrapSync = true;
        } else {
          void this.refreshBootstrap(true);
        }
      }
    };

    return () => {
      stopClock();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", handleResize);
      }
      paging.stopPageSpring();
      sse.close();
    };
  }

  flushPendingSync(): void {
    if (this.pendingBootstrapSync && !this.isInteractionBusyFn?.()) {
      this.pendingBootstrapSync = false;
      void this.refreshBootstrap(true);
    }
  }

  async refreshBootstrap(bypassETag = false): Promise<void> {
    if (this.bootstrapRefreshInFlight) return;
    this.bootstrapRefreshInFlight = true;
    try {
      const etag = bypassETag ? null : this.currentETag;
      const res = await fetch("/api/v1/bootstrap", {
        headers: etag ? { "If-None-Match": etag } : {},
      });
      if (res.status === 304) {
        this.hydrationStatus = "Phase 1: 304 Not Modified";
        return;
      }
      if (!res.ok) return;

      const newEtag = res.headers.get("etag");
      const data = (await res.json()) as BootstrapPayload;
      this.workspaces = data.workspaces ?? [];
      this.nodes = data.nodes ?? [];
      this.preferences = data.preferences ?? {};
      this.signals = { ...this.signals, ...data.signals };
      this.sanitizeAllWorkspaces();
      this.pruneOrphanedSignals();

      if (newEtag) {
        this.currentETag = newEtag;
        localStorage.setItem(ETAG_KEY, newEtag);
      }

      this.onPreferencesLoadedCb?.(this.preferences);

      // Keep this tab's current workspace if it still exists; only resolve from storage on initial boot or deletion
      if (this.activeWorkspaceId && this.workspaces.some((w) => w.id === this.activeWorkspaceId)) {
        // Preserve current workspace selection
      } else {
        const storedWs = readStoredWorkspaceId();
        if (storedWs && this.workspaces.some((w) => w.id === storedWs)) {
          this.activeWorkspaceId = storedWs;
          writeStoredWorkspaceId(storedWs);
        } else if (this.workspaces.length > 0) {
          this.activeWorkspaceId = this.workspaces[0].id;
          writeStoredWorkspaceId(this.workspaces[0].id);
        } else {
          this.activeWorkspaceId = null;
        }
      }

      const syncedIdx = Math.max(
        0,
        this.workspaces.findIndex((w) => w.id === this.activeWorkspaceId),
      );
      if (
        this.pagingRef &&
        !this.pagingRef.isAnimating &&
        Math.round(this.pagingRef.pagePosition) !== syncedIdx
      ) {
        this.pagingRef.syncToIndex(syncedIdx);
      }

      this.persistSnapshot();
      this.hydrationStatus = "Phase 1: 200 OK";
    } catch {
      // Ignore transient network errors
    } finally {
      this.bootstrapRefreshInFlight = false;
    }
  }

  private pruneOrphanedSignals(): void {
    const activeNodeIds = new Set(this.nodes.map((n) => n.id));
    const prefixes = ["calendar:events:", "calendar:status:", "node:health:", "weather:"];
    for (const key of Object.keys(this.signals)) {
      for (const prefix of prefixes) {
        if (key.startsWith(prefix)) {
          const id = key.slice(prefix.length);
          if (!activeNodeIds.has(id)) {
            delete this.signals[key];
          }
        }
      }
    }
  }

  persistSnapshot(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          workspaces: this.workspaces,
          nodes: this.nodes,
          preferences: this.preferences,
          signals: this.signals,
        }),
      );
    } catch {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            workspaces: this.workspaces,
            nodes: this.nodes,
            preferences: this.preferences,
            signals: {},
          }),
        );
      } catch {
        // Ignore storage quota errors
      }
    }
  }

  sanitizeAllWorkspaces(): void {
    for (const ws of this.workspaces) {
      const wsNodes = this.nodes
        .filter((n) => n.workspace_id === ws.id && !n.parent_id && n.grid_x > 0)
        .sort((a, b) => a.grid_y - b.grid_y || a.grid_x - b.grid_x || a.sort_order - b.sort_order);

      const placed: DashboardNode[] = [];
      for (const n of wsNodes) {
        if (!n.settings) n.settings = {};
        const clamped = clampToGrid(n.grid_x, n.grid_y, n.width || 1, n.height || 1);
        n.width = clamped.w;
        n.height = clamped.h;

        if (canFitAmongNodes(clamped.x, clamped.y, n.width, n.height, placed)) {
          n.grid_x = clamped.x;
          n.grid_y = clamped.y;
        } else {
          const free = findFreeSlotAmongNodes(n.width, n.height, placed);
          if (free) {
            n.grid_x = free.x;
            n.grid_y = free.y;
          }
        }
        placed.push(n);
      }
    }
  }

  getNodeGridRect(node: DashboardNode): GridRect {
    if (this.activeGridCols < GRID_COLS && !node.parent_id && node.grid_x > 0) {
      const mapped = this.responsiveRootRects[node.id];
      if (mapped) return mapped;
    }
    return {
      x: node.grid_x,
      y: node.grid_y,
      w: Math.min(node.width || 1, this.activeGridCols),
      h: node.height || 1,
    };
  }

  getWorkspaceRootNodes(workspaceId: string): DashboardNode[] {
    if (!workspaceId) return [];
    return this.nodes
      .filter((n) => n.workspace_id === workspaceId && !n.parent_id && n.grid_x > 0 && n.grid_y > 0)
      .sort((a, b) => a.grid_y - b.grid_y || a.grid_x - b.grid_x || a.sort_order - b.sort_order);
  }

  getChildren(parentId: string): DashboardNode[] {
    return this.nodes
      .filter((n) => n.parent_id === parentId)
      .sort((a, b) => a.sort_order - b.sort_order);
  }

  isCellOccupied(x: number, y: number, ignoreNodeId?: string): boolean {
    if (x < 1 || y < 1 || x > this.activeGridCols || y > this.activeGridRows) return true;
    for (const n of this.rootNodes) {
      if (n.id === ignoreNodeId) continue;
      const r = this.getNodeGridRect(n);
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
        return true;
      }
    }
    return false;
  }

  canPlaceAt(x: number, y: number, width: number, height: number, ignoreNodeId?: string): boolean {
    const others = this.rootNodes.filter((n) => n.id !== ignoreNodeId);
    return canFitAmongNodes(x, y, width, height, others);
  }

  findFirstFreeCell(width = 1, height = 1, ignoreNodeId?: string): { x: number; y: number } | null {
    const others = this.rootNodes.filter((n) => n.id !== ignoreNodeId);
    return findFreeSlotAmongNodes(width, height, others);
  }
}

export const session = new SessionStore();
