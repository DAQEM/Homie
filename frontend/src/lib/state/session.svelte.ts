import type { BootstrapPayload, DashboardNode, SignalDelta, Workspace } from "../types";
import { ETAG_KEY, GRID_COLS, GRID_ROWS, STORAGE_KEY, WORKSPACE_STORAGE_KEY } from "./constants";
import { canFitAmongNodes, clampToGrid, findFreeSlotAmongNodes } from "./grid-math";
import type { PagingController } from "./paging.svelte";

export class SessionStore {
  now = $state<Date>(new Date());
  isDocumentVisible = $state<boolean>(true);

  workspaces = $state<Workspace[]>([]);
  nodes = $state<DashboardNode[]>([]);
  signals = $state<Record<string, unknown>>({});
  activeWorkspaceId = $state<string | null>(null);
  isEditMode = $state<boolean>(false);
  hydrationStatus = $state<string>("Cold Boot");

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

  init(paging: PagingController): () => void {
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

    startClock();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

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
        this.signals = { ...this.signals, ...data.signals };
        this.sanitizeAllWorkspaces();

        const storedWs = localStorage.getItem(WORKSPACE_STORAGE_KEY);
        if (storedWs && this.workspaces.some((w) => w.id === storedWs)) {
          this.activeWorkspaceId = storedWs;
        } else if (this.workspaces.length > 0) {
          this.activeWorkspaceId = this.workspaces[0].id;
          localStorage.setItem(WORKSPACE_STORAGE_KEY, this.workspaces[0].id);
        }

        const syncedIdx = Math.max(
          0,
          this.workspaces.findIndex((w) => w.id === this.activeWorkspaceId),
        );
        if (!paging.isAnimating) {
          paging.syncToIndex(syncedIdx);
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
      this.hydrationStatus = "Phase 2: Live SSE";
    };

    return () => {
      stopClock();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      paging.stopPageSpring();
      sse.close();
    };
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
    if (x < 1 || y < 1 || x > GRID_COLS || y > GRID_ROWS) return true;
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
    return canFitAmongNodes(x, y, width, height, others);
  }

  findFirstFreeCell(width = 1, height = 1, ignoreNodeId?: string): { x: number; y: number } | null {
    const others = this.rootNodes.filter((n) => n.id !== ignoreNodeId);
    return findFreeSlotAmongNodes(width, height, others);
  }
}

export const session = new SessionStore();
