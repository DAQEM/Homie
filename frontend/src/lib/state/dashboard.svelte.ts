import { arrayMove } from "@dnd-kit/helpers";
import {
  categorizeActionNode,
  type AppearancePreferences,
  type AppLibraryCategory,
  type AppLibraryCategoryId,
  type BootstrapPayload,
  type CalendarEvent,
  type CalendarSyncStatus,
  type DashboardNode,
  type DragEndEventPayload,
  type NodeModalState,
  type NodeSettings,
  type NodeType,
  type SignalDelta,
  type TodoItem,
  type WallpaperPreset,
  type Workspace,
} from "../types";

const STORAGE_KEY = "homie_snapshot_v7";
const ETAG_KEY = "homie_etag_v7";
const WORKSPACE_STORAGE_KEY = "homie_active_workspace_id";
const APP_USAGE_STORAGE_KEY = "homie_app_usage_v1";
const APPEARANCE_STORAGE_KEY = "homie_appearance_v1";

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

const CATEGORY_LABELS: Record<AppLibraryCategoryId, string> = {
  productivity: "Productivity & Work",
  dev: "Development & Cloud",
  media: "Media & Entertainment",
  social: "Social & Reading",
  utilities: "Utilities & Web",
};

class DashboardStore {
  now = $state<Date>(new Date());
  isDocumentVisible = $state<boolean>(true);

  workspaces = $state<Workspace[]>([]);
  nodes = $state<DashboardNode[]>([]);
  signals = $state<Record<string, unknown>>({});
  activeWorkspaceId = $state<string | null>(null);

  // Step 1: Continuous Spatial Paging & 120Hz Spring State
  pagePosition = $state<number>(0);
  isPageDragging = $state<boolean>(false);
  pageSlideDirection = $state<"left" | "right" | null>(null);
  private rawSwipePagePos = 0;
  private pageVelocity = 0;
  private springRafId: number | null = null;
  private springTargetIndex = 0;
  private springLastTime = 0;
  private wheelGestureTimer: ReturnType<typeof setTimeout> | null = null;
  private wheelLastEventAt = 0;
  private wheelLockedAfterSnapUntil = 0;

  // Step 3: Bi-Directional FLIP Folder Morphing & Modals
  isEditMode = $state<boolean>(false);
  openFolderId = $state<string | null>(null);
  isFolderClosing = $state<boolean>(false);
  openFolderOrigin = $state<{
    cx: number;
    cy: number;
    width: number;
    height: number;
  } | null>(null);
  private folderAnchorEls = new Map<string, HTMLElement>();
  private folderCloseTimer: ReturnType<typeof setTimeout> | null = null;

  // Expanded Full Calendar Modal State
  openCalendarNodeId = $state<string | null>(null);
  openCalendarInitialDate = $state<string | null>(null);
  openCalendarOrigin = $state<{ cx: number; cy: number } | null>(null);

  isAppLibraryOpen = $state<boolean>(false);
  appLibraryOrigin = $state<{ cx: number; cy: number } | null>(null);
  flippedNodeId = $state<string | null>(null);
  isWorkspaceModalOpen = $state<boolean>(false);
  isSpotlightOpen = $state<boolean>(false);
  spotlightInitialQuery = $state<string>("");
  hydrationStatus = $state<string>("Cold Boot");

  // Step 4: Control Center & Appearance Studio
  isControlCenterOpen = $state<boolean>(false);
  wallpaperPreset = $state<WallpaperPreset>("cupertino");
  showIconLabels = $state<boolean>(true);
  reducedParallax = $state<boolean>(false);

  // Step 5: Smart Stacks & App Usage Tracking
  appUsageMap = $state<Record<string, number>>({});
  activeStackIndices = $state<Record<string, number>>({});
  syncingCalendarNodes = $state<Record<string, boolean>>({});

  // Step 2: Platter Lift Quick Actions, Hold-to-Drag & Drop Settlement
  contextMenu = $state<ContextMenuState>({
    open: false,
    nodeId: null,
    x: 0,
    y: 0,
    anchorRect: null,
    inDock: false,
    transformOrigin: "top left",
  });

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

  recentDockNodes = $derived.by<DashboardNode[]>(() => {
    const dockedIds = new Set(this.dockNodes.map((n) => n.id));
    const candidates = this.nodes.filter((n) => n.node_type === "action" && !dockedIds.has(n.id));

    return candidates
      .sort((a, b) => {
        const usageA = this.appUsageMap[a.id] ?? 0;
        const usageB = this.appUsageMap[b.id] ?? 0;
        if (usageA !== usageB) return usageB - usageA;
        return b.created_at.localeCompare(a.created_at);
      })
      .slice(0, 2);
  });

  appLibraryCategories = $derived.by<AppLibraryCategory[]>(() => {
    const buckets: Record<AppLibraryCategoryId, DashboardNode[]> = {
      productivity: [],
      dev: [],
      media: [],
      social: [],
      utilities: [],
    };

    const allActions = this.nodes
      .filter((n) => n.node_type === "action")
      .sort((a, b) => {
        const usageA = this.appUsageMap[a.id] ?? 0;
        const usageB = this.appUsageMap[b.id] ?? 0;
        if (usageA !== usageB) return usageB - usageA;
        return a.title.localeCompare(b.title);
      });

    for (const node of allActions) {
      const cat = categorizeActionNode(node);
      buckets[cat].push(node);
    }

    const order: AppLibraryCategoryId[] = ["productivity", "dev", "media", "social", "utilities"];

    return order
      .map((id) => ({
        id,
        title: CATEGORY_LABELS[id],
        nodes: buckets[id],
      }))
      .filter((cat) => cat.nodes.length > 0);
  });

  openFolder = $derived<DashboardNode | null>(
    this.nodes.find((n) => n.id === this.openFolderId) ?? null,
  );

  openCalendarNode = $derived<DashboardNode | null>(
    this.nodes.find((n) => n.id === this.openCalendarNodeId) ?? null,
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

    const usageRaw = localStorage.getItem(APP_USAGE_STORAGE_KEY);
    if (usageRaw) {
      try {
        this.appUsageMap = JSON.parse(usageRaw) as Record<string, number>;
      } catch {
        // Ignore invalid usage cache
      }
    }

    const appearanceRaw = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (appearanceRaw) {
      try {
        const prefs = JSON.parse(appearanceRaw) as Partial<AppearancePreferences>;
        if (prefs.wallpaper) this.wallpaperPreset = prefs.wallpaper;
        if (typeof prefs.showIconLabels === "boolean") {
          this.showIconLabels = prefs.showIconLabels;
        }
        if (typeof prefs.reducedParallax === "boolean") {
          this.reducedParallax = prefs.reducedParallax;
        }
      } catch {
        // Ignore invalid appearance cache
      }
    }

    const savedWsId = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (savedWsId && this.workspaces.some((w) => w.id === savedWsId)) {
      this.activeWorkspaceId = savedWsId;
    } else if (this.workspaces.length > 0) {
      this.activeWorkspaceId = this.workspaces[0].id;
    }

    const initialIdx = Math.max(
      0,
      this.workspaces.findIndex((w) => w.id === this.activeWorkspaceId),
    );
    this.pagePosition = initialIdx;
    this.rawSwipePagePos = initialIdx;
    this.springTargetIndex = initialIdx;
  }

  init(): () => void {
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
        this.signals = { ...this.signals, ...(data.signals ?? {}) };
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
        if (!this.isPageDragging && this.springRafId === null) {
          this.pagePosition = syncedIdx;
          this.rawSwipePagePos = syncedIdx;
          this.springTargetIndex = syncedIdx;
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
      this.stopPageSpring();
      sse.close();
    };
  }

  // =========================================================================
  // Calendar iCal (.ics) Feed & Expanded Modal Helpers
  // =========================================================================

  openCalendarModal(nodeId: string, initialDateIso?: string, originEl?: HTMLElement | null): void {
    this.closeContextMenu();
    this.closeControlCenter();
    this.closeAppLibrary();
    this.closeSpotlight();
    this.openFolderId = null;
    this.isFolderClosing = false;
    this.flippedNodeId = null;

    if (originEl) {
      const rect = originEl.getBoundingClientRect();
      this.openCalendarOrigin = {
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2,
      };
    } else {
      this.openCalendarOrigin = null;
    }

    this.openCalendarInitialDate = initialDateIso ?? null;
    this.openCalendarNodeId = nodeId;
  }

  closeCalendarModal(): void {
    this.openCalendarNodeId = null;
    this.openCalendarInitialDate = null;
  }

  getCalendarEventsForNode(node: DashboardNode): CalendarEvent[] {
    if (node.id === "gallery-preview-node") {
      return node.settings?.events ?? [];
    }

    const rawSignal = this.signals[`calendar:events:${node.id}`];
    const syncedEvents: CalendarEvent[] = Array.isArray(rawSignal)
      ? (rawSignal as CalendarEvent[])
      : [];

    return [...syncedEvents].sort((a, b) => {
      const aDate = a.date ?? "";
      const bDate = b.date ?? "";
      if (aDate !== bDate) return aDate.localeCompare(bDate);

      const aAllDay = Boolean(a.isAllDay || a.time.toLowerCase() === "all day");
      const bAllDay = Boolean(b.isAllDay || b.time.toLowerCase() === "all day");
      if (aAllDay !== bAllDay) return aAllDay ? -1 : 1;

      return a.time.localeCompare(b.time) || a.title.localeCompare(b.title);
    });
  }

  getCalendarStatusForNode(nodeId: string): CalendarSyncStatus | null {
    const raw = this.signals[`calendar:status:${nodeId}`];
    if (raw && typeof raw === "object" && "feeds" in raw) {
      return raw as CalendarSyncStatus;
    }
    return null;
  }

  async syncCalendarNodeNow(nodeId: string): Promise<void> {
    if (this.syncingCalendarNodes[nodeId]) return;
    this.syncingCalendarNodes[nodeId] = true;
    try {
      const res = await fetch(`/api/v1/nodes/${nodeId}/calendar-sync`, {
        method: "POST",
      });
      if (res.ok) {
        const status = (await res.json()) as CalendarSyncStatus;
        this.signals[`calendar:status:${nodeId}`] = status;
        this.persistSnapshot();
      }
    } catch {
      // Ignore transient network errors
    } finally {
      this.syncingCalendarNodes[nodeId] = false;
    }
  }

  getWorkspaceRootNodes(workspaceId: string): DashboardNode[] {
    if (!workspaceId) return [];
    return this.nodes
      .filter((n) => n.workspace_id === workspaceId && !n.parent_id && n.grid_x > 0 && n.grid_y > 0)
      .sort((a, b) => a.grid_y - b.grid_y || a.grid_x - b.grid_x || a.sort_order - b.sort_order);
  }

  recordAppLaunch(nodeId: string): void {
    this.appUsageMap[nodeId] = Date.now();
    try {
      localStorage.setItem(APP_USAGE_STORAGE_KEY, JSON.stringify(this.appUsageMap));
    } catch {
      // Ignore storage quota errors
    }
  }

  // =========================================================================
  // Step 4: Control Center & Appearance Preferences
  // =========================================================================

  private persistAppearance(): void {
    try {
      localStorage.setItem(
        APPEARANCE_STORAGE_KEY,
        JSON.stringify({
          wallpaper: this.wallpaperPreset,
          showIconLabels: this.showIconLabels,
          reducedParallax: this.reducedParallax,
        }),
      );
    } catch {
      // Ignore storage quota errors
    }
  }

  toggleControlCenter(): void {
    this.closeContextMenu();
    this.closeSpotlight();
    this.closeAppLibrary();
    this.isControlCenterOpen = !this.isControlCenterOpen;
  }

  closeControlCenter(): void {
    this.isControlCenterOpen = false;
  }

  setWallpaperPreset(preset: WallpaperPreset): void {
    this.wallpaperPreset = preset;
    this.persistAppearance();
  }

  toggleIconLabels(): void {
    this.showIconLabels = !this.showIconLabels;
    this.persistAppearance();
  }

  toggleReducedParallax(): void {
    this.reducedParallax = !this.reducedParallax;
    this.persistAppearance();
  }

  // =========================================================================
  // Step 5: Interactive Smart Stacks
  // =========================================================================

  getStackItems(rootNode: DashboardNode): DashboardNode[] {
    if (
      rootNode.parent_id ||
      rootNode.node_type === "action" ||
      rootNode.node_type === "container"
    ) {
      return [rootNode];
    }
    const children = this.getChildren(rootNode.id);
    return [rootNode, ...children];
  }

  getActiveStackIndex(rootNodeId: string): number {
    return this.activeStackIndices[rootNodeId] ?? 0;
  }

  setSmartStackIndex(rootNodeId: string, index: number): void {
    const rootNode = this.nodes.find((n) => n.id === rootNodeId);
    if (!rootNode) return;
    const total = this.getStackItems(rootNode).length;
    this.activeStackIndices[rootNodeId] = ((index % total) + total) % total;
  }

  cycleSmartStack(rootNodeId: string, delta: number): void {
    const current = this.getActiveStackIndex(rootNodeId);
    this.setSmartStackIndex(rootNodeId, current + delta);
  }

  async unstackActiveWidget(rootNodeId: string): Promise<void> {
    this.closeContextMenu();
    const rootNode = this.nodes.find((n) => n.id === rootNodeId);
    if (!rootNode) return;

    const stackItems = this.getStackItems(rootNode);
    if (stackItems.length <= 1) return;

    const activeIdx = this.getActiveStackIndex(rootNodeId);
    const targetToExtract =
      activeIdx > 0 ? stackItems[activeIdx] : stackItems[stackItems.length - 1];

    const w = rootNode.width || 2;
    const h = rootNode.height || 2;
    const free = this.findFirstFreeCell(w, h) ?? { x: 1, y: 1 };

    targetToExtract.parent_id = null;
    targetToExtract.grid_x = free.x;
    targetToExtract.grid_y = free.y;
    targetToExtract.width = w;
    targetToExtract.height = h;
    targetToExtract.sort_order = free.y * 100 + free.x;
    this.activeStackIndices[rootNodeId] = 0;
    this.persistSnapshot();

    void fetch("/api/v1/nodes/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        {
          id: targetToExtract.id,
          sort_order: targetToExtract.sort_order,
          grid_x: free.x,
          grid_y: free.y,
          width: w,
          height: h,
          parent_id: null,
        },
      ]),
    });
  }

  // =========================================================================
  // Step 3: Bi-Directional FLIP Folder Morphing & App Library
  // =========================================================================

  registerFolderAnchor(nodeId: string, el: HTMLElement | null): void {
    if (el) {
      this.folderAnchorEls.set(nodeId, el);
    } else {
      this.folderAnchorEls.delete(nodeId);
    }
  }

  openFolderWithOrigin(nodeId: string, originEl?: HTMLElement | null): void {
    if (this.folderCloseTimer) {
      clearTimeout(this.folderCloseTimer);
      this.folderCloseTimer = null;
    }
    this.isFolderClosing = false;
    this.closeContextMenu();
    this.closeControlCenter();
    this.closeAppLibrary();
    this.closeCalendarModal();
    this.flippedNodeId = null;

    const targetEl = originEl ?? this.folderAnchorEls.get(nodeId) ?? null;
    if (targetEl) {
      const rect = targetEl.getBoundingClientRect();
      this.openFolderOrigin = {
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2,
        width: rect.width,
        height: rect.height,
      };
    } else {
      this.openFolderOrigin = null;
    }
    this.openFolderId = nodeId;
  }

  closeFolder(): void {
    if (!this.openFolderId || this.isFolderClosing) return;

    const currentId = this.openFolderId;
    const anchorEl = this.folderAnchorEls.get(currentId);
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      this.openFolderOrigin = {
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2,
        width: rect.width,
        height: rect.height,
      };
    }

    this.isFolderClosing = true;
    if (this.folderCloseTimer) clearTimeout(this.folderCloseTimer);
    this.folderCloseTimer = setTimeout(() => {
      this.folderCloseTimer = null;
      this.openFolderId = null;
      this.isFolderClosing = false;
    }, 260);
  }

  openAppLibrary(originEl?: HTMLElement | null): void {
    this.closeContextMenu();
    this.closeControlCenter();
    this.closeSpotlight();
    this.closeCalendarModal();
    this.openFolderId = null;
    this.isFolderClosing = false;
    this.flippedNodeId = null;
    if (originEl) {
      const rect = originEl.getBoundingClientRect();
      this.appLibraryOrigin = {
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2,
      };
    } else {
      this.appLibraryOrigin = null;
    }
    this.isAppLibraryOpen = true;
  }

  closeAppLibrary(): void {
    this.isAppLibraryOpen = false;
  }

  async startGalleryWidgetDrag(
    clientX: number,
    clientY: number,
    previewBounds: ScreenBounds,
  ): Promise<void> {
    if (!this.activeWorkspace) return;

    const t = this.nodeModal.node_type;
    const width = Math.max(1, Math.min(GRID_COLS, Number(this.nodeModal.width) || 2));
    const height = Math.max(1, Math.min(GRID_ROWS, Number(this.nodeModal.height) || 2));
    const free = this.findFirstFreeCell(width, height) ?? { x: 1, y: 1 };

    const defaultTitleMap: Record<NodeType, string> = {
      action: "Untitled",
      container: "Folder",
      clock: "Amsterdam",
      search: "Search",
      todo: "Reminders",
      calendar: "Calendar",
    };

    const finalTitle = this.nodeModal.title.trim() || defaultTitleMap[t];
    const nowIso = new Date().toISOString();

    const optimisticNode: DashboardNode = {
      id: crypto.randomUUID(),
      workspace_id: this.activeWorkspace.id,
      parent_id: null,
      sort_order: free.y * 100 + free.x,
      grid_x: free.x,
      grid_y: free.y,
      title: finalTitle,
      icon: null,
      node_type: t,
      url: null,
      width,
      height,
      settings: structuredClone($state.snapshot(this.nodeModal.settings)),
      created_at: nowIso,
      updated_at: nowIso,
    };

    this.nodes.push(optimisticNode);
    this.nodeModal.open = false;
    this.persistSnapshot();

    this.setDragGrabOffset(Math.floor(width / 2), Math.floor(height / 2));
    this.promoteHoldToDirectDrag(optimisticNode.id, clientX, clientY, previewBounds);

    void fetch("/api/v1/nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(optimisticNode),
    });
  }

  // =========================================================================
  // Step 1: Continuous Spatial Paging & 120Hz Spring Physics
  // =========================================================================

  private applyRubberBand(rawPagePos: number): number {
    const maxIndex = Math.max(0, this.workspaces.length - 1);
    const limit = 0.26;
    if (rawPagePos < 0) {
      const over = -rawPagePos;
      return -limit * (1 - Math.exp(-over / limit));
    }
    if (rawPagePos > maxIndex) {
      const over = rawPagePos - maxIndex;
      return maxIndex + limit * (1 - Math.exp(-over / limit));
    }
    return rawPagePos;
  }

  private stopPageSpring(): void {
    if (this.springRafId !== null && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(this.springRafId);
      this.springRafId = null;
    }
  }

  springToPage(targetIndex: number, initialVelocity = 0): void {
    const maxIndex = Math.max(0, this.workspaces.length - 1);
    const clampedIndex = Math.max(0, Math.min(maxIndex, targetIndex));
    this.springTargetIndex = clampedIndex;
    this.rawSwipePagePos = clampedIndex;
    this.pageVelocity = initialVelocity;

    if (typeof requestAnimationFrame === "undefined") {
      this.pagePosition = clampedIndex;
      return;
    }

    this.stopPageSpring();
    this.springLastTime = performance.now();

    const stiffness = 320;
    const damping = 34;

    const step = (now: number) => {
      const dt = Math.min((now - this.springLastTime) / 1000, 0.032);
      this.springLastTime = now;

      const displacement = this.pagePosition - this.springTargetIndex;
      const springForce = -stiffness * displacement;
      const dampingForce = -damping * this.pageVelocity;
      const acceleration = springForce + dampingForce;

      this.pageVelocity += acceleration * dt;
      this.pagePosition += this.pageVelocity * dt;

      if (
        Math.abs(this.pagePosition - this.springTargetIndex) < 0.0008 &&
        Math.abs(this.pageVelocity) < 0.008
      ) {
        this.pagePosition = this.springTargetIndex;
        this.pageVelocity = 0;
        this.springRafId = null;
        return;
      }

      this.springRafId = requestAnimationFrame(step);
    };

    this.springRafId = requestAnimationFrame(step);
  }

  beginPageSwipe(): void {
    this.stopPageSpring();
    this.isPageDragging = true;
    this.rawSwipePagePos = this.pagePosition;
    this.pageVelocity = 0;
  }

  updatePageSwipe(deltaPages: number, dtMs: number): void {
    if (!this.isPageDragging) {
      this.beginPageSwipe();
    }
    this.rawSwipePagePos += deltaPages;
    const nextPos = this.applyRubberBand(this.rawSwipePagePos);
    if (dtMs > 0) {
      const instantVelocity = (nextPos - this.pagePosition) / (dtMs / 1000);
      this.pageVelocity = this.pageVelocity * 0.35 + instantVelocity * 0.65;
    }
    this.pagePosition = nextPos;
  }

  endPageSwipe(): void {
    if (!this.isPageDragging) return;
    this.isPageDragging = false;

    const maxIndex = Math.max(0, this.workspaces.length - 1);
    const currentAnchor = this.activeWorkspaceIndex;
    const projected = this.pagePosition + this.pageVelocity * 0.16;
    const diff = projected - currentAnchor;

    let nextIdx = currentAnchor;
    if (diff > 0.22) {
      nextIdx = Math.min(maxIndex, currentAnchor + 1);
    } else if (diff < -0.22) {
      nextIdx = Math.max(0, currentAnchor - 1);
    } else {
      nextIdx = Math.max(0, Math.min(maxIndex, Math.round(projected)));
    }

    const targetWs = this.workspaces[nextIdx];
    if (targetWs && targetWs.id !== this.activeWorkspaceId) {
      this.pageSlideDirection = nextIdx > currentAnchor ? "right" : "left";
      this.activeWorkspaceId = targetWs.id;
      localStorage.setItem(WORKSPACE_STORAGE_KEY, targetWs.id);
      this.openFolderId = null;
      this.isFolderClosing = false;
      this.closeCalendarModal();
      this.flippedNodeId = null;
      this.closeContextMenu();
      this.clearDragPreview();
    }

    this.springToPage(nextIdx, this.pageVelocity);
  }

  handleWheelPaging(deltaX: number, viewportWidth: number): void {
    const now = performance.now();
    if (now < this.wheelLockedAfterSnapUntil) return;

    const dt = this.wheelLastEventAt > 0 ? Math.max(8, now - this.wheelLastEventAt) : 16;
    this.wheelLastEventAt = now;

    const isDiscreteStep = Math.abs(deltaX) >= 95 && dt > 90;
    if (isDiscreteStep && !this.isPageDragging) {
      this.wheelLockedAfterSnapUntil = now + 420;
      if (deltaX > 0) {
        this.selectNextWorkspace();
      } else {
        this.selectPrevWorkspace();
      }
      return;
    }

    const stride = Math.max(viewportWidth * 0.78, 520);
    const deltaPages = deltaX / stride;
    this.updatePageSwipe(deltaPages, dt);

    const currentAnchor = this.activeWorkspaceIndex;
    const displacement = this.rawSwipePagePos - currentAnchor;
    if (Math.abs(displacement) > 0.55) {
      if (this.wheelGestureTimer) {
        clearTimeout(this.wheelGestureTimer);
        this.wheelGestureTimer = null;
      }
      this.wheelLockedAfterSnapUntil = now + 380;
      this.endPageSwipe();
      return;
    }

    if (this.wheelGestureTimer) {
      clearTimeout(this.wheelGestureTimer);
    }
    this.wheelGestureTimer = setTimeout(() => {
      this.wheelGestureTimer = null;
      this.endPageSwipe();
    }, 115);
  }

  // =========================================================================
  // Step 2: Foreground Platter Lift, Quick Actions & Direct Hold-to-Drag
  // =========================================================================

  openContextMenu(
    node: DashboardNode,
    event?: MouseEvent | PointerEvent,
    anchorEl?: HTMLElement | null,
    inDock = false,
  ): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.closeControlCenter();
    this.flippedNodeId = null;

    const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const menuWidth = 236;
    const menuHeight = 310;
    const pad = 16;

    let anchorRect: ScreenBounds | null = null;
    if (anchorEl) {
      const r = anchorEl.getBoundingClientRect();
      anchorRect = {
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
      };
    }

    let x = event ? event.clientX : vw / 2;
    let y = event ? event.clientY : vh / 2;
    let originY: "top" | "bottom" = "top";
    let originX: "left" | "right" = "left";

    if (anchorRect) {
      const centerX = anchorRect.left + anchorRect.width / 2;
      const isRightSide = centerX > vw * 0.62;
      originX = isRightSide ? "right" : "left";

      if (isRightSide) {
        x = Math.max(
          pad,
          Math.min(anchorRect.left + anchorRect.width - menuWidth, vw - menuWidth - pad),
        );
      } else {
        x = Math.max(pad, Math.min(anchorRect.left, vw - menuWidth - pad));
      }

      const spaceBelow = vh - (anchorRect.top + anchorRect.height);
      const spaceAbove = anchorRect.top;

      if (inDock || (spaceBelow < menuHeight + 24 && spaceAbove > spaceBelow)) {
        originY = "bottom";
        y = Math.max(pad, anchorRect.top - menuHeight - 12);
      } else {
        originY = "top";
        y = Math.min(vh - menuHeight - pad, anchorRect.top + anchorRect.height + 12);
      }
    } else {
      x = Math.max(pad, Math.min(x + 8, vw - menuWidth - pad));
      y = Math.max(pad, Math.min(y + 4, vh - menuHeight - pad));
    }

    this.contextMenu = {
      open: true,
      nodeId: node.id,
      x,
      y,
      anchorRect,
      inDock,
      transformOrigin: `${originY} ${originX}`,
    };
  }

  closeContextMenu(): void {
    if (this.contextMenu.open) {
      this.contextMenu.open = false;
      this.contextMenu.nodeId = null;
      this.contextMenu.anchorRect = null;
    }
  }

  promoteHoldToDirectDrag(
    nodeId: string,
    startX: number,
    startY: number,
    initialBounds: ScreenBounds,
  ): void {
    this.closeContextMenu();
    this.closeControlCenter();
    this.flippedNodeId = null;
    this.isEditMode = true;
    this.activeDragNodeId = nodeId;
    this.isDirectDragging = true;
    this.directDragStartPointer = { x: startX, y: startY };
    this.directDragDelta = { x: 0, y: 0 };
    this.directDragInitialBounds = initialBounds;
    this.activeDragLiveBounds = { id: nodeId, rect: initialBounds };
    this.folderMergeTargetId = null;

    const node = this.nodes.find((n) => n.id === nodeId);
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

    if (!draggedId || !this.isEditMode) {
      this.clearDragPreview();
      return;
    }

    const sourceNode = this.nodes.find((n) => n.id === draggedId);
    if (!sourceNode) {
      this.clearDragPreview();
      return;
    }

    if (mergeTargetId && mergeTargetId !== draggedId) {
      const mergeTargetNode = this.nodes.find((n) => n.id === mergeTargetId);
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

  async togglePinToDock(nodeId: string): Promise<void> {
    this.closeContextMenu();
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    const isCurrentlyDocked = !node.parent_id && node.grid_x === -1 && node.grid_y === -1;
    if (isCurrentlyDocked) {
      const free = this.findFirstFreeCell(1, 1);
      if (!free || !this.activeWorkspace) return;
      node.workspace_id = this.activeWorkspace.id;
      node.parent_id = null;
      node.grid_x = free.x;
      node.grid_y = free.y;
      node.width = 1;
      node.height = 1;
      node.sort_order = free.y * 100 + free.x;
      this.persistSnapshot();

      void fetch(`/api/v1/nodes/${node.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_id: this.activeWorkspace.id,
          parent_id: null,
          grid_x: free.x,
          grid_y: free.y,
          width: 1,
          height: 1,
          sort_order: node.sort_order,
        }),
      });
    } else {
      await this.pinNodeToDock(node);
    }
  }

  private async pinNodeToDock(node: DashboardNode): Promise<void> {
    if (node.node_type !== "action" && node.node_type !== "container") return;
    node.parent_id = null;
    node.grid_x = -1;
    node.grid_y = -1;
    node.width = 1;
    node.height = 1;
    node.sort_order = this.dockNodes.length + 1;
    this.persistSnapshot();

    void fetch("/api/v1/nodes/reorder", {
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

  // =========================================================================
  // Spotlight, Widget Inspection & Grid Layout Engine
  // =========================================================================

  openSpotlight(initialQuery = ""): void {
    this.closeContextMenu();
    this.closeControlCenter();
    this.closeAppLibrary();
    this.closeCalendarModal();
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
      todos: [newItem, ...currentTodos],
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

    const now = this.now;
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    const currentEvents = calNode.settings?.events ?? [];
    const newEvent: CalendarEvent = {
      id: crypto.randomUUID(),
      title,
      time,
      date: todayIso,
      color: "#0A84FF",
      source: "local",
    };

    await this.updateNodeSettings(calNode.id, {
      ...calNode.settings,
      events: [...currentEvents, newEvent],
    });
    return true;
  }

  inspectNode(node: DashboardNode, event?: MouseEvent): void {
    event?.stopPropagation();
    event?.preventDefault();
    this.closeContextMenu();
    this.closeCalendarModal();

    const isRootMultiCellWidget =
      !node.parent_id &&
      node.grid_x > 0 &&
      node.node_type !== "action" &&
      node.node_type !== "container" &&
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

    const res = await fetch(`/api/v1/nodes/${nodeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: nextTitle,
        width: node.width,
        height: node.height,
        settings: updates.settings,
      }),
    });

    if (res.ok && node.node_type === "calendar") {
      void this.syncCalendarNodeNow(nodeId);
    }
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
    if (!node || !node.parent_id || !this.activeWorkspace) return;

    const free = this.findFirstFreeCell(1, 1);
    if (!free) return;

    node.workspace_id = this.activeWorkspace.id;
    node.parent_id = null;
    node.grid_x = free.x;
    node.grid_y = free.y;
    node.width = 1;
    node.height = 1;
    node.sort_order = free.y * 100 + free.x;
    this.openFolderId = null;
    this.isFolderClosing = false;
    this.persistSnapshot();

    void fetch(`/api/v1/nodes/${node.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace_id: this.activeWorkspace.id,
        parent_id: null,
        sort_order: node.sort_order,
        grid_x: free.x,
        grid_y: free.y,
        width: 1,
        height: 1,
      }),
    });
  }

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

    const activeWsId = this.activeWorkspace?.id;
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
        void fetch(`/api/v1/nodes/${node.id}`, {
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
    if (sourceNode.id === targetNode.id) return;

    // Step 5: Smart Stack Merge for identical-dimension widgets
    const isSourceWidget =
      sourceNode.node_type !== "action" && sourceNode.node_type !== "container";
    const isTargetWidget =
      targetNode.node_type !== "action" && targetNode.node_type !== "container";

    if (
      isSourceWidget &&
      isTargetWidget &&
      !targetNode.parent_id &&
      (sourceNode.width || 2) === (targetNode.width || 2) &&
      (sourceNode.height || 2) === (targetNode.height || 2)
    ) {
      const existingChildren = this.getChildren(targetNode.id);
      sourceNode.parent_id = targetNode.id;
      sourceNode.sort_order = existingChildren.length + 1;
      this.activeStackIndices[targetNode.id] = existingChildren.length + 1;
      this.persistSnapshot();

      void fetch("/api/v1/nodes/reorder", {
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
    const newIndex = this.workspaces.findIndex((w) => w.id === id);
    if (newIndex === -1) return;

    const oldIndex = this.activeWorkspaceIndex;
    if (id !== this.activeWorkspace?.id) {
      this.pageSlideDirection = newIndex > oldIndex ? "right" : "left";
      this.activeWorkspaceId = id;
      localStorage.setItem(WORKSPACE_STORAGE_KEY, id);
      this.openFolderId = null;
      this.isFolderClosing = false;
      this.closeCalendarModal();
      this.flippedNodeId = null;
      this.closeContextMenu();
      this.clearDragPreview();
    }

    this.springToPage(newIndex, this.pageVelocity);
  }

  selectNextWorkspace(): boolean {
    if (this.workspaces.length <= 1) return false;
    const nextIdx = this.activeWorkspaceIndex + 1;
    if (nextIdx >= this.workspaces.length) {
      this.springToPage(this.activeWorkspaceIndex, 1.45);
      return false;
    }
    this.selectWorkspace(this.workspaces[nextIdx].id);
    return true;
  }

  selectPrevWorkspace(): boolean {
    if (this.workspaces.length <= 1) return false;
    const prevIdx = this.activeWorkspaceIndex - 1;
    if (prevIdx < 0) {
      this.springToPage(0, -1.45);
      return false;
    }
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
    this.closeControlCenter();
    this.closeCalendarModal();
    if (!this.isEditMode) {
      this.flippedNodeId = null;
      this.clearDragPreview();
    }
  }

  enterEditMode(): void {
    this.closeContextMenu();
    this.closeControlCenter();
    this.closeCalendarModal();
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
    this.closeControlCenter();
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

  handleDragOver = (event: DragEndEventPayload): void => {
    if (!this.isEditMode || !this.activeDragNodeId) return;
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

    if (mergeTargetId && mergeTargetId !== sourceId) {
      const mergeTargetNode = this.nodes.find((n) => n.id === mergeTargetId);
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

    const targetNode = targetId ? this.nodes.find((n) => n.id === targetId) : undefined;

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
    const prevNodes = structuredClone($state.snapshot(this.nodes));
    const deletedIdx = this.workspaces.findIndex((w) => w.id === id);

    const remainingWorkspaces = this.workspaces.filter((w) => w.id !== id);
    const fallbackWs = remainingWorkspaces[Math.max(0, deletedIdx - 1)] ?? remainingWorkspaces[0];

    const dockIds = new Set(
      this.nodes
        .filter((n) => n.workspace_id === id && !n.parent_id && n.grid_x === -1 && n.grid_y === -1)
        .map((n) => n.id),
    );

    for (const n of this.nodes) {
      if (dockIds.has(n.id) || (n.parent_id && dockIds.has(n.parent_id))) {
        n.workspace_id = fallbackWs.id;
      }
    }

    this.workspaces = remainingWorkspaces;
    this.nodes = this.nodes.filter((n) => n.workspace_id !== id);

    if (this.activeWorkspaceId === id) {
      this.selectWorkspace(fallbackWs.id);
    } else {
      this.springToPage(this.activeWorkspaceIndex);
    }
    this.persistSnapshot();

    const res = await fetch(`/api/v1/workspaces/${id}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      this.workspaces = prevWorkspaces;
      this.nodes = prevNodes;
      this.springToPage(this.activeWorkspaceIndex);
      this.persistSnapshot();
    }
  }

  openCreateNodeModal(parentId: string | null = null, gridX?: number, gridY?: number): void {
    this.closeContextMenu();
    this.closeControlCenter();
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
        sweepSeconds: true,
        placeholder: "Search the Web...",
        engineUrl: "https://www.google.com/search?q=",
        todos: [],
        events: [],
        icalUrl: "",
        calendarFeeds: [],
      },
    };
  }

  openEditNodeModal(node: DashboardNode, event?: MouseEvent): void {
    event?.stopPropagation();
    event?.preventDefault();
    this.closeContextMenu();
    this.closeControlCenter();
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

    const settingsSnapshot = structuredClone($state.snapshot(this.nodeModal.settings));
    if (
      this.nodeModal.node_type === "calendar" &&
      settingsSnapshot.icalUrl &&
      settingsSnapshot.icalUrl.trim() !== ""
    ) {
      const trimmedUrl = settingsSnapshot.icalUrl.trim();
      const feeds = settingsSnapshot.calendarFeeds ?? [];
      if (!feeds.some((f) => f.url === trimmedUrl)) {
        feeds.push({
          id: crypto.randomUUID(),
          name: finalTitle || "Subscribed Calendar",
          url: trimmedUrl,
          color: "#0A84FF",
          enabled: true,
        });
      }
      settingsSnapshot.calendarFeeds = feeds;
      settingsSnapshot.icalUrl = "";
    }

    if (this.nodeModal.mode === "create") {
      const siblings =
        finalX === -1
          ? this.dockNodes
          : this.nodes.filter(
              (n) =>
                n.workspace_id === this.activeWorkspace!.id &&
                n.parent_id === this.nodeModal.parent_id &&
                n.grid_x > 0,
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
        settings: settingsSnapshot,
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
      } else if (optimisticNode.node_type === "calendar") {
        void this.syncCalendarNodeNow(optimisticNode.id);
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
        existing.settings = settingsSnapshot;
      }

      this.nodeModal.open = false;
      this.persistSnapshot();

      const res = await fetch(`/api/v1/nodes/${nodeId}`, {
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
          settings: settingsSnapshot,
        }),
      });

      if (res.ok && existing?.node_type === "calendar") {
        void this.syncCalendarNodeNow(nodeId);
      }
    }

    return null;
  }

  async deleteNode(id: string, event?: MouseEvent): Promise<void> {
    event?.stopPropagation();
    event?.preventDefault();
    this.closeContextMenu();

    const prevNodes = [...this.nodes];
    this.nodes = this.nodes.filter((n) => n.id !== id && n.parent_id !== id);
    if (this.openFolderId === id) {
      this.openFolderId = null;
      this.isFolderClosing = false;
    }
    if (this.openCalendarNodeId === id) {
      this.closeCalendarModal();
    }
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
