import type {
  CalendarEvent,
  DashboardNode,
  NodeModalState,
  NodeSettings,
  NodeType,
} from "../types";
import type { AppearanceController } from "./appearance.svelte";
import type { CalendarController } from "./calendar.svelte";
import { GRID_COLS, GRID_ROWS, type ScreenBounds } from "./constants";
import type { DragController } from "./drag-controller.svelte";
import { clampToGrid } from "./grid-math";
import type { OverlayController } from "./overlays.svelte";
import type { SessionStore } from "./session.svelte";
import type { VikunjaController } from "./vikunja.svelte";

const DEFAULT_TITLE_MAP: Record<NodeType, string> = {
  action: "Untitled",
  container: "Folder",
  clock: "Amsterdam",
  weather: "Amsterdam",
  search: "Search",
  todo: "Vikunja",
  calendar: "Calendar",
};

export class NodeController {
  private session: SessionStore;
  private overlays: OverlayController;
  private appearance: AppearanceController;
  private drag: DragController;
  private calendar: CalendarController;
  private vikunja: VikunjaController;

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

  constructor(
    session: SessionStore,
    overlays: OverlayController,
    appearance: AppearanceController,
    drag: DragController,
    calendar: CalendarController,
    vikunja: VikunjaController,
  ) {
    this.session = session;
    this.overlays = overlays;
    this.appearance = appearance;
    this.drag = drag;
    this.calendar = calendar;
    this.vikunja = vikunja;
  }

  async startGalleryWidgetDrag(
    clientX: number,
    clientY: number,
    previewBounds: ScreenBounds,
  ): Promise<void> {
    if (!this.session.activeWorkspace) return;

    const t = this.nodeModal.node_type;
    const width = Math.max(1, Math.min(GRID_COLS, Number(this.nodeModal.width) || 2));
    const height = Math.max(1, Math.min(GRID_ROWS, Number(this.nodeModal.height) || 2));
    const free = this.session.findFirstFreeCell(width, height) ?? { x: 1, y: 1 };

    const finalTitle = this.nodeModal.title.trim() || DEFAULT_TITLE_MAP[t];
    const nowIso = new Date().toISOString();

    const optimisticNode: DashboardNode = {
      id: crypto.randomUUID(),
      workspace_id: this.session.activeWorkspace.id,
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

    this.session.nodes.push(optimisticNode);
    this.nodeModal.open = false;
    this.session.persistSnapshot();

    this.drag.setDragGrabOffset(Math.floor(width / 2), Math.floor(height / 2));
    this.drag.promoteHoldToDirectDrag(optimisticNode.id, clientX, clientY, previewBounds);

    void fetch("/api/v1/nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(optimisticNode),
    });
  }

  async togglePinToDock(nodeId: string): Promise<void> {
    this.overlays.closeContextMenu();
    const node = this.session.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    const isCurrentlyDocked = !node.parent_id && node.grid_x === -1 && node.grid_y === -1;
    if (isCurrentlyDocked) {
      const free = this.session.findFirstFreeCell(1, 1);
      if (!free || !this.session.activeWorkspace) return;
      node.workspace_id = this.session.activeWorkspace.id;
      node.parent_id = null;
      node.grid_x = free.x;
      node.grid_y = free.y;
      node.width = 1;
      node.height = 1;
      node.sort_order = free.y * 100 + free.x;
      this.session.persistSnapshot();

      void fetch(`/api/v1/nodes/${node.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_id: this.session.activeWorkspace.id,
          parent_id: null,
          grid_x: free.x,
          grid_y: free.y,
          width: 1,
          height: 1,
          sort_order: node.sort_order,
        }),
      });
    } else {
      await this.drag.pinNodeToDock(node);
    }
  }

  async toggleHealthMonitor(nodeId: string): Promise<void> {
    this.overlays.closeContextMenu();
    const node = this.session.nodes.find((n) => n.id === nodeId);
    if (!node || node.node_type !== "action") return;

    const nextEnabled = !node.settings?.healthCheck;
    const nextSettings: NodeSettings = {
      ...(node.settings ?? {}),
      healthCheck: nextEnabled,
    };

    if (!nextEnabled) {
      delete this.session.signals[`node:health:${node.id}`];
    }

    await this.updateNodeSettings(node.id, nextSettings);
  }

  async quickAddReminder(text: string): Promise<boolean> {
    const trimmed = text.trim();
    if (!trimmed || !this.vikunja.status.connected) return false;

    const todoNode =
      this.session.nodes.find(
        (n) => n.workspace_id === this.session.activeWorkspace?.id && n.node_type === "todo",
      ) ?? this.session.nodes.find((n) => n.node_type === "todo");

    const fallbackProjectId = this.vikunja.getDefaultProjectId(todoNode);
    if (fallbackProjectId <= 0) return false;

    const parsed = this.vikunja.parseQuickInput(trimmed, fallbackProjectId);
    const created = await this.vikunja.createTask({
      project_id: parsed.projectId,
      title: parsed.title || trimmed,
      priority: parsed.priority,
      due_date: parsed.dueDate || undefined,
    });
    return created !== null;
  }

  async quickAddCalendarEvent(rawInput: string): Promise<boolean> {
    const trimmed = rawInput.trim();
    if (!trimmed) return false;

    const calNode =
      this.session.nodes.find(
        (n) => n.workspace_id === this.session.activeWorkspace?.id && n.node_type === "calendar",
      ) ?? this.session.nodes.find((n) => n.node_type === "calendar");

    if (!calNode) return false;

    let time = "All day";
    let title = trimmed;
    const match = trimmed.match(/^(\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?)\s+(.+)$/);
    if (match) {
      time = match[1];
      title = match[2];
    }

    const now = this.session.now;
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
    this.overlays.closeContextMenu();
    this.overlays.closeCalendarModal();
    this.overlays.closeVikunjaModal();

    const isRootMultiCellWidget =
      !node.parent_id &&
      node.grid_x > 0 &&
      node.node_type !== "action" &&
      node.node_type !== "container" &&
      (node.width >= 2 || node.height >= 2);

    if (isRootMultiCellWidget) {
      this.overlays.flippedNodeId = this.overlays.flippedNodeId === node.id ? null : node.id;
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
    const node = this.session.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    const nextTitle = updates.title.trim() || node.title;
    const nextW = updates.width ?? node.width;
    const nextH = updates.height ?? node.height;

    if (nextW !== node.width || nextH !== node.height) {
      await this.drag.applyNodeResize(node, nextW, nextH);
    }

    node.title = nextTitle;
    node.settings = updates.settings;
    this.overlays.flippedNodeId = null;
    this.session.persistSnapshot();

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
      void this.calendar.syncCalendarNodeNow(nodeId);
    }
  }

  async renameNode(nodeId: string, newTitle: string): Promise<void> {
    const node = this.session.nodes.find((n) => n.id === nodeId);
    const trimmed = newTitle.trim();
    if (!node || !trimmed || node.title === trimmed) return;

    node.title = trimmed;
    this.session.persistSnapshot();

    void fetch(`/api/v1/nodes/${nodeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: trimmed }),
    });
  }

  async duplicateNode(nodeId: string): Promise<void> {
    this.overlays.closeContextMenu();
    const source = this.session.nodes.find((n) => n.id === nodeId);
    if (!source || !this.session.activeWorkspace) return;

    const free = this.session.findFirstFreeCell(source.width || 1, source.height || 1);
    if (!free) return;

    const nowIso = new Date().toISOString();
    const optimisticNode: DashboardNode = {
      id: crypto.randomUUID(),
      workspace_id: this.session.activeWorkspace.id,
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

    this.session.nodes.push(optimisticNode);
    this.session.persistSnapshot();

    const res = await fetch("/api/v1/nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(optimisticNode),
    });

    if (!res.ok) {
      this.session.nodes = this.session.nodes.filter((n) => n.id !== optimisticNode.id);
      this.session.persistSnapshot();
    }
  }

  async extractNodeFromFolderToGrid(nodeId: string): Promise<void> {
    const node = this.session.nodes.find((n) => n.id === nodeId);
    if (!node || !node.parent_id || !this.session.activeWorkspace) return;

    const free = this.session.findFirstFreeCell(1, 1);
    if (!free) return;

    node.workspace_id = this.session.activeWorkspace.id;
    node.parent_id = null;
    node.grid_x = free.x;
    node.grid_y = free.y;
    node.width = 1;
    node.height = 1;
    node.sort_order = free.y * 100 + free.x;
    this.overlays.resetFolderImmediate();
    this.session.persistSnapshot();

    void fetch(`/api/v1/nodes/${node.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace_id: this.session.activeWorkspace.id,
        parent_id: null,
        sort_order: node.sort_order,
        grid_x: free.x,
        grid_y: free.y,
        width: 1,
        height: 1,
      }),
    });
  }

  openCreateNodeModal(parentId: string | null = null, gridX?: number, gridY?: number): void {
    this.overlays.closeContextMenu();
    this.appearance.isControlCenterOpen = false;
    this.overlays.flippedNodeId = null;
    const coords =
      gridX !== undefined && gridY !== undefined
        ? { x: gridX, y: gridY }
        : (this.session.findFirstFreeCell(1, 1) ?? { x: 1, y: 1 });
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
        healthCheck: false,
        healthIgnoreTLS: false,
        location: "Amsterdam",
        tempUnit: "C",
        timezone: "Europe/Amsterdam",
        flag: "🇳🇱",
        clockFace: "analog",
        sweepSeconds: true,
        placeholder: "Search the Web...",
        engineUrl: "https://www.google.com/search?q=",
        vikunjaFilter: "all",
        vikunjaShowCompleted: false,
        events: [],
        icalUrl: "",
        calendarFeeds: [],
      },
    };
  }

  openEditNodeModal(node: DashboardNode, event?: MouseEvent): void {
    event?.stopPropagation();
    event?.preventDefault();
    this.overlays.closeContextMenu();
    this.appearance.isControlCenterOpen = false;
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
    const node = this.session.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    node.settings = newSettings;
    this.session.persistSnapshot();

    void fetch(`/api/v1/nodes/${nodeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: newSettings }),
    });
  }

  async saveNodeModal(): Promise<string | null> {
    if (!this.session.activeWorkspace) return "Create a Home Screen page first.";

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
      const clamped = clampToGrid(finalX, finalY, width, height);
      const ignoreId =
        this.nodeModal.mode === "edit" ? (this.nodeModal.id ?? undefined) : undefined;

      if (this.session.canPlaceAt(clamped.x, clamped.y, width, height, ignoreId)) {
        finalX = clamped.x;
        finalY = clamped.y;
      } else {
        const fallback = this.session.findFirstFreeCell(width, height, ignoreId);
        if (!fallback) {
          return `Not enough free space on the 16x8 grid for a ${width}x${height} node.`;
        }
        finalX = fallback.x;
        finalY = fallback.y;
      }
    }

    const finalTitle = this.nodeModal.title.trim() || DEFAULT_TITLE_MAP[this.nodeModal.node_type];

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
          ? this.session.dockNodes
          : this.session.nodes.filter(
              (n) =>
                n.workspace_id === this.session.activeWorkspace!.id &&
                n.parent_id === this.nodeModal.parent_id &&
                n.grid_x > 0,
            );

      const nowIso = new Date().toISOString();
      const optimisticNode: DashboardNode = {
        id: crypto.randomUUID(),
        workspace_id: this.session.activeWorkspace.id,
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

      this.session.nodes.push(optimisticNode);
      this.nodeModal.open = false;
      this.session.persistSnapshot();

      const res = await fetch("/api/v1/nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(optimisticNode),
      });

      if (!res.ok) {
        this.session.nodes = this.session.nodes.filter((n) => n.id !== optimisticNode.id);
        this.session.persistSnapshot();
      } else if (optimisticNode.node_type === "calendar") {
        void this.calendar.syncCalendarNodeNow(optimisticNode.id);
      }
    } else if (this.nodeModal.id) {
      const nodeId = this.nodeModal.id;
      const existing = this.session.nodes.find((n) => n.id === nodeId);
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
      this.session.persistSnapshot();

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
        void this.calendar.syncCalendarNodeNow(nodeId);
      }
    }

    return null;
  }

  async deleteNode(id: string, event?: MouseEvent): Promise<void> {
    event?.stopPropagation();
    event?.preventDefault();
    this.overlays.closeContextMenu();

    const prevNodes = [...this.session.nodes];
    this.session.nodes = this.session.nodes.filter((n) => n.id !== id && n.parent_id !== id);
    if (this.overlays.openFolderId === id) {
      this.overlays.resetFolderImmediate();
    }
    if (this.overlays.openCalendarNodeId === id) {
      this.overlays.closeCalendarModal();
    }
    if (this.overlays.flippedNodeId === id) {
      this.overlays.flippedNodeId = null;
    }
    this.session.persistSnapshot();

    const res = await fetch(`/api/v1/nodes/${id}`, { method: "DELETE" });
    if (!res.ok) {
      this.session.nodes = prevNodes;
      this.session.persistSnapshot();
    }
  }
}
