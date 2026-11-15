import type { DashboardNode } from "../types";
import type { ContextMenuState, ScreenBounds } from "./constants";

export class OverlayController {
  // Folder FLIP Morphing State
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

  // Expanded Calendar Modal State
  openCalendarNodeId = $state<string | null>(null);
  openCalendarInitialDate = $state<string | null>(null);
  openCalendarOrigin = $state<{ cx: number; cy: number } | null>(null);

  // Expanded Vikunja Task Modal State
  openVikunjaTaskId = $state<number | null>(null);

  // App Library, Spotlight, Workspace & Flipped Backface State
  isAppLibraryOpen = $state<boolean>(false);
  appLibraryOrigin = $state<{ cx: number; cy: number } | null>(null);
  flippedNodeId = $state<string | null>(null);
  isWorkspaceModalOpen = $state<boolean>(false);
  isSpotlightOpen = $state<boolean>(false);
  spotlightInitialQuery = $state<string>("");

  // Platter Lift Quick Action Context Menu State
  contextMenu = $state<ContextMenuState>({
    open: false,
    nodeId: null,
    x: 0,
    y: 0,
    anchorRect: null,
    inDock: false,
    transformOrigin: "top left",
  });

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
    this.closeAppLibrary();
    this.closeCalendarModal();
    this.closeVikunjaModal();
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

  resetFolderImmediate(): void {
    if (this.folderCloseTimer) {
      clearTimeout(this.folderCloseTimer);
      this.folderCloseTimer = null;
    }
    this.openFolderId = null;
    this.isFolderClosing = false;
  }

  openCalendarModal(nodeId: string, initialDateIso?: string, originEl?: HTMLElement | null): void {
    this.closeContextMenu();
    this.closeAppLibrary();
    this.closeSpotlight();
    this.closeVikunjaModal();
    this.resetFolderImmediate();
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

  openVikunjaModal(taskId: number): void {
    this.closeContextMenu();
    this.closeAppLibrary();
    this.closeSpotlight();
    this.closeCalendarModal();
    this.resetFolderImmediate();
    this.flippedNodeId = null;
    this.openVikunjaTaskId = taskId;
  }

  closeVikunjaModal(): void {
    this.openVikunjaTaskId = null;
  }

  openAppLibrary(originEl?: HTMLElement | null): void {
    this.closeContextMenu();
    this.closeSpotlight();
    this.closeCalendarModal();
    this.closeVikunjaModal();
    this.resetFolderImmediate();
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

  openSpotlight(initialQuery = ""): void {
    this.closeContextMenu();
    this.closeAppLibrary();
    this.closeCalendarModal();
    this.closeVikunjaModal();
    this.flippedNodeId = null;
    this.spotlightInitialQuery = initialQuery;
    this.isSpotlightOpen = true;
  }

  closeSpotlight(): void {
    this.isSpotlightOpen = false;
    this.spotlightInitialQuery = "";
  }

  openContextMenu(
    node: DashboardNode,
    event?: MouseEvent | PointerEvent,
    anchorEl?: HTMLElement | null,
    inDock = false,
  ): void {
    event?.preventDefault();
    event?.stopPropagation();
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
}
