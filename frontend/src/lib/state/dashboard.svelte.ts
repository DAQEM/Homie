import type {
  DashboardNode,
  DragEndEventPayload,
  NodeHealthSignal,
  NodeSettings,
  NodeType,
  VikunjaTask,
  WallpaperPreset,
  WeatherSignal,
} from "../types";
import { AppearanceController } from "./appearance.svelte";
import { AppLibraryController } from "./app-library.svelte";
import { AuthController } from "./auth.svelte";
import { CalendarController } from "./calendar.svelte";
import type { GridRect, ScreenBounds, WidgetSizePreset } from "./constants";
import { DragController } from "./drag-controller.svelte";
import { clampToGrid, snapToWidgetPreset } from "./grid-math";
import { NodeController } from "./nodes.svelte";
import { OverlayController } from "./overlays.svelte";
import { PagingController } from "./paging.svelte";
import { session } from "./session.svelte";
import { SmartStackController } from "./stacks.svelte";
import { VikunjaController } from "./vikunja.svelte";
import { WorkspaceController } from "./workspaces.svelte";

export {
  DEFAULT_NODE_SIZES,
  GRID_COLS,
  GRID_ROWS,
  MAX_ICON_BYTES,
  WIDGET_SIZE_PRESETS,
  type ContextMenuState,
  type GridRect,
  type ScreenBounds,
  type WidgetSizePreset,
} from "./constants";

class DashboardStore {
  readonly auth = new AuthController();
  readonly session = session;
  readonly paging = new PagingController();
  readonly appearance = new AppearanceController();
  readonly overlays = new OverlayController();
  readonly calendar = new CalendarController(this.session);
  readonly vikunja = new VikunjaController(this.session);
  readonly stacks = new SmartStackController(this.session);
  readonly appLibrary = new AppLibraryController();
  readonly drag = new DragController(this.session, this.overlays, this.appearance, this.stacks);
  readonly workspaceCtrl = new WorkspaceController(
    this.session,
    this.paging,
    this.overlays,
    this.appearance,
    this.drag,
  );
  readonly nodeCtrl = new NodeController(
    this.session,
    this.overlays,
    this.appearance,
    this.drag,
    this.calendar,
    this.vikunja,
  );

  openFolder = $derived<DashboardNode | null>(
    this.session.nodes.find((n) => n.id === this.overlays.openFolderId) ?? null,
  );

  openCalendarNode = $derived<DashboardNode | null>(
    this.session.nodes.find((n) => n.id === this.overlays.openCalendarNodeId) ?? null,
  );

  openVikunjaTask = $derived<VikunjaTask | null>(
    this.vikunja.findTask(this.overlays.openVikunjaTaskId, this.overlays.openVikunjaIntegrationId),
  );

  contextMenuNode = $derived<DashboardNode | null>(
    this.session.nodes.find((n) => n.id === this.overlays.contextMenu.nodeId) ?? null,
  );

  constructor() {
    this.paging.syncToIndex(this.session.activeWorkspaceIndex);

    const resetAllOnSignOut = () => {
      this.session.resetBoardState();
      this.calendar.reset();
      this.appearance.isControlCenterOpen = false;
      this.appearance.reloadFromLocal();
      this.appLibrary.reloadFromLocal();
      this.overlays.closeContextMenu();
      this.overlays.closeSpotlight();
      this.overlays.closeAppLibrary();
      this.overlays.closeCalendarModal();
      this.overlays.closeVikunjaModal();
      this.overlays.resetFolderImmediate();
      this.overlays.flippedNodeId = null;
      this.overlays.isWorkspaceModalOpen = false;
      this.nodeCtrl.closeNodeModal();
    };

    this.auth.setOnRevoked(resetAllOnSignOut);
    this.session.setUnauthorizedHandler(() => {
      this.auth.handleSessionRevoked();
    });
  }

  init(): () => void {
    const cleanupEnv = this.session.initEnvironmentListeners(
      this.paging,
      (prefs) => {
        if (prefs.appearance) {
          this.appearance.hydrateFromServer(prefs.appearance);
        }
        if (prefs.app_usage) {
          this.appLibrary.hydrateFromServer(prefs.app_usage);
        }
      },
      () => this.drag.isBusy(),
    );

    void this.bootAuthenticatedSession();
    return cleanupEnv;
  }

  private async bootAuthenticatedSession(): Promise<void> {
    const ok = await this.auth.checkSession();
    if (ok) {
      this.appearance.reloadFromLocal();
      this.appLibrary.reloadFromLocal();
      this.session.startLiveSync();
    } else {
      this.session.resetBoardState();
    }
  }

  get now() {
    return this.session.now;
  }
  get isDocumentVisible() {
    return this.session.isDocumentVisible;
  }
  get viewportWidth() {
    return this.session.viewportWidth;
  }
  get activeGridCols() {
    return this.session.activeGridCols;
  }
  get activeGridRows() {
    return this.session.activeGridRows;
  }
  get workspaces() {
    return this.session.workspaces;
  }
  get nodes() {
    return this.session.nodes;
  }
  get signals() {
    return this.session.signals;
  }
  get activeWorkspaceId() {
    return this.session.activeWorkspaceId;
  }
  get isEditMode() {
    return this.session.isEditMode;
  }
  get hydrationStatus() {
    return this.session.hydrationStatus;
  }
  get activeWorkspace() {
    return this.session.activeWorkspace;
  }
  get activeWorkspaceIndex() {
    return this.session.activeWorkspaceIndex;
  }
  get rootNodes() {
    return this.session.rootNodes;
  }
  get dockNodes() {
    return this.session.dockNodes;
  }
  get dockActionNodes() {
    return this.session.dockActionNodes;
  }
  get dockContainerNodes() {
    return this.session.dockContainerNodes;
  }

  getWorkspaceRootNodes(workspaceId: string) {
    return this.session.getWorkspaceRootNodes(workspaceId);
  }
  getChildren(parentId: string) {
    return this.session.getChildren(parentId);
  }
  isCellOccupied(x: number, y: number, ignoreNodeId?: string) {
    return this.session.isCellOccupied(x, y, ignoreNodeId);
  }
  canPlaceAt(x: number, y: number, width: number, height: number, ignoreNodeId?: string) {
    return this.session.canPlaceAt(x, y, width, height, ignoreNodeId);
  }
  findFirstFreeCell(width = 1, height = 1, ignoreNodeId?: string) {
    return this.session.findFirstFreeCell(width, height, ignoreNodeId);
  }

  getNodeHealth(nodeId: string): NodeHealthSignal | null {
    const raw = this.session.signals[`node:health:${nodeId}`];
    if (raw && typeof raw === "object" && "status" in raw) {
      return raw as NodeHealthSignal;
    }
    return null;
  }

  getWeatherForNode(node: DashboardNode): WeatherSignal | null {
    if (node.id === "gallery-preview-node") {
      return {
        location: node.settings?.location || node.title || "Amsterdam",
        unit: node.settings?.tempUnit === "F" ? "F" : "C",
        temperature: node.settings?.tempUnit === "F" ? 57 : 14,
        feelsLike: node.settings?.tempUnit === "F" ? 55 : 13,
        humidity: 68,
        windSpeed: 14,
        code: 2,
        condition: "Partly Cloudy",
        isDay: true,
        tempHigh: node.settings?.tempUnit === "F" ? 61 : 16,
        tempLow: node.settings?.tempUnit === "F" ? 48 : 9,
        hourly: [
          { time: "14:00", temperature: 14, code: 2, isDay: true },
          { time: "15:00", temperature: 15, code: 1, isDay: true },
          { time: "16:00", temperature: 16, code: 0, isDay: true },
          { time: "17:00", temperature: 14, code: 1, isDay: true },
          { time: "18:00", temperature: 12, code: 2, isDay: false },
          { time: "19:00", temperature: 11, code: 3, isDay: false },
        ],
        daily: [
          { date: "2026-11-15", code: 2, tempMax: 16, tempMin: 9 },
          { date: "2026-11-16", code: 61, tempMax: 13, tempMin: 8 },
          { date: "2026-11-17", code: 1, tempMax: 15, tempMin: 7 },
          { date: "2026-11-18", code: 0, tempMax: 17, tempMin: 8 },
          { date: "2026-11-19", code: 3, tempMax: 14, tempMin: 9 },
        ],
        updatedAt: new Date().toISOString(),
      };
    }

    const raw = this.session.signals[`weather:${node.id}`];
    if (raw && typeof raw === "object" && "temperature" in raw) {
      return raw as WeatherSignal;
    }
    return null;
  }

  get pagePosition() {
    return this.paging.pagePosition;
  }
  get isPageDragging() {
    return this.paging.isPageDragging;
  }
  get pageSlideDirection() {
    return this.paging.pageSlideDirection;
  }

  get isControlCenterOpen() {
    return this.appearance.isControlCenterOpen;
  }
  set isControlCenterOpen(v: boolean) {
    this.appearance.isControlCenterOpen = v;
  }
  get wallpaperPreset() {
    return this.appearance.wallpaperPreset;
  }
  get showIconLabels() {
    return this.appearance.showIconLabels;
  }
  get reducedParallax() {
    return this.appearance.reducedParallax;
  }

  toggleControlCenter(): void {
    this.overlays.closeContextMenu();
    this.overlays.closeSpotlight();
    this.overlays.closeAppLibrary();
    this.appearance.isControlCenterOpen = !this.appearance.isControlCenterOpen;
  }
  closeControlCenter(): void {
    this.appearance.isControlCenterOpen = false;
  }
  setWallpaperPreset(preset: WallpaperPreset): void {
    this.appearance.setWallpaperPreset(preset);
  }
  toggleIconLabels(): void {
    this.appearance.toggleIconLabels();
  }
  toggleReducedParallax(): void {
    this.appearance.toggleReducedParallax();
  }

  get openFolderId() {
    return this.overlays.openFolderId;
  }
  set openFolderId(v: string | null) {
    this.overlays.openFolderId = v;
  }
  get isFolderClosing() {
    return this.overlays.isFolderClosing;
  }
  get openFolderOrigin() {
    return this.overlays.openFolderOrigin;
  }
  get openCalendarNodeId() {
    return this.overlays.openCalendarNodeId;
  }
  get openCalendarInitialDate() {
    return this.overlays.openCalendarInitialDate;
  }
  get openCalendarOrigin() {
    return this.overlays.openCalendarOrigin;
  }
  get openVikunjaTaskId() {
    return this.overlays.openVikunjaTaskId;
  }
  get openVikunjaIntegrationId() {
    return this.overlays.openVikunjaIntegrationId;
  }
  get isAppLibraryOpen() {
    return this.overlays.isAppLibraryOpen;
  }
  get appLibraryOrigin() {
    return this.overlays.appLibraryOrigin;
  }
  get flippedNodeId() {
    return this.overlays.flippedNodeId;
  }
  set flippedNodeId(v: string | null) {
    this.overlays.flippedNodeId = v;
  }
  get isWorkspaceModalOpen() {
    return this.overlays.isWorkspaceModalOpen;
  }
  set isWorkspaceModalOpen(v: boolean) {
    this.overlays.isWorkspaceModalOpen = v;
  }
  get isSpotlightOpen() {
    return this.overlays.isSpotlightOpen;
  }
  get spotlightInitialQuery() {
    return this.overlays.spotlightInitialQuery;
  }
  get contextMenu() {
    return this.overlays.contextMenu;
  }

  registerFolderAnchor(nodeId: string, el: HTMLElement | null) {
    this.overlays.registerFolderAnchor(nodeId, el);
  }
  openFolderWithOrigin(nodeId: string, originEl?: HTMLElement | null) {
    this.closeControlCenter();
    this.overlays.openFolderWithOrigin(nodeId, originEl);
  }
  closeFolder() {
    this.overlays.closeFolder();
  }
  openCalendarModal(nodeId: string, initialDateIso?: string, originEl?: HTMLElement | null) {
    this.closeControlCenter();
    this.overlays.openCalendarModal(nodeId, initialDateIso, originEl);
  }
  closeCalendarModal() {
    this.overlays.closeCalendarModal();
  }
  openVikunjaModal(taskId: number, integrationId?: string | null) {
    this.closeControlCenter();
    this.overlays.openVikunjaModal(taskId, integrationId);
  }
  closeVikunjaModal() {
    this.overlays.closeVikunjaModal();
  }
  openAppLibrary(originEl?: HTMLElement | null) {
    this.closeControlCenter();
    this.overlays.openAppLibrary(originEl);
  }
  closeAppLibrary() {
    this.overlays.closeAppLibrary();
  }
  openSpotlight(initialQuery = "") {
    this.closeControlCenter();
    this.overlays.openSpotlight(initialQuery);
  }
  closeSpotlight() {
    this.overlays.closeSpotlight();
  }
  toggleSpotlight() {
    if (this.isSpotlightOpen) {
      this.closeSpotlight();
    } else {
      this.openSpotlight();
    }
  }
  openContextMenu(
    node: DashboardNode,
    event?: MouseEvent | PointerEvent,
    anchorEl?: HTMLElement | null,
    inDock = false,
  ) {
    this.closeControlCenter();
    this.overlays.openContextMenu(node, event, anchorEl, inDock);
  }
  closeContextMenu() {
    this.overlays.closeContextMenu();
  }

  get syncingCalendarNodes() {
    return this.calendar.syncingCalendarNodes;
  }
  getCalendarEventsForNode(node: DashboardNode) {
    return this.calendar.getCalendarEventsForNode(node);
  }
  getCalendarStatusForNode(nodeId: string) {
    return this.calendar.getCalendarStatusForNode(nodeId);
  }
  syncCalendarNodeNow(nodeId: string) {
    return this.calendar.syncCalendarNodeNow(nodeId);
  }
  ensureCalendarMonthRangeLoaded(nodeId: string, year: number, monthIndex: number) {
    return this.calendar.ensureMonthRangeLoaded(nodeId, year, monthIndex);
  }

  get activeStackIndices() {
    return this.stacks.activeStackIndices;
  }
  getStackItems(rootNode: DashboardNode) {
    return this.stacks.getStackItems(rootNode);
  }
  getActiveStackIndex(rootNodeId: string) {
    return this.stacks.getActiveStackIndex(rootNodeId);
  }
  setSmartStackIndex(rootNodeId: string, index: number) {
    this.stacks.setSmartStackIndex(rootNodeId, index);
  }
  cycleSmartStack(rootNodeId: string, delta: number) {
    this.stacks.cycleSmartStack(rootNodeId, delta);
  }
  async unstackActiveWidget(rootNodeId: string) {
    this.overlays.closeContextMenu();
    await this.stacks.unstackActiveWidget(rootNodeId);
  }

  get appUsageMap() {
    return this.appLibrary.appUsageMap;
  }
  get recentDockNodes() {
    return this.appLibrary.recentDockNodes;
  }
  get appLibraryCategories() {
    return this.appLibrary.appLibraryCategories;
  }
  get defaultSearchEngineUrl() {
    return this.appLibrary.defaultSearchEngineUrl;
  }
  recordAppLaunch(nodeId: string) {
    this.appLibrary.recordAppLaunch(nodeId);
  }

  get activeDragNodeId() {
    return this.drag.activeDragNodeId;
  }
  get dragGrabOffset() {
    return this.drag.dragGrabOffset;
  }
  get resizingNodeId() {
    return this.drag.resizingNodeId;
  }
  set resizingNodeId(v: string | null) {
    this.drag.resizingNodeId = v;
  }
  get folderMergeTargetId() {
    return this.drag.folderMergeTargetId;
  }
  get dropPreview() {
    return this.drag.dropPreview;
  }
  get previewPositions() {
    return this.drag.previewPositions;
  }
  get isDirectDragging() {
    return this.drag.isDirectDragging;
  }
  get directDragDelta() {
    return this.drag.directDragDelta;
  }
  get settlingDrop() {
    return this.drag.settlingDrop;
  }

  getEffectiveRect(node: DashboardNode): GridRect {
    return this.drag.getEffectiveRect(node);
  }
  setDragGrabOffset(colOffset: number, rowOffset: number) {
    this.drag.setDragGrabOffset(colOffset, rowOffset);
  }
  snapToWidgetPreset(nodeType: NodeType, rawW: number, rawH: number): WidgetSizePreset {
    return snapToWidgetPreset(nodeType, rawW, rawH, this.activeGridCols);
  }
  clampToGrid(x: number, y: number, width: number, height: number): GridRect {
    return clampToGrid(x, y, width, height, this.activeGridCols, Infinity);
  }
  holdGridReflowOnTarget() {
    this.drag.holdGridReflowOnTarget();
  }
  setFolderMergeTarget(targetId: string | null) {
    this.drag.setFolderMergeTarget(targetId);
  }
  updateDragReflow(rawCol: number, rawRow: number) {
    this.drag.updateDragReflow(rawCol, rawRow);
  }
  clearDragPreview() {
    this.drag.clearDragPreview();
  }
  promoteHoldToDirectDrag(
    nodeId: string,
    startX: number,
    startY: number,
    initialBounds: ScreenBounds,
  ) {
    this.drag.promoteHoldToDirectDrag(nodeId, startX, startY, initialBounds);
  }
  updateDirectDrag(clientX: number, clientY: number) {
    this.drag.updateDirectDrag(clientX, clientY);
  }
  finishDirectDrag(clientX?: number, clientY?: number) {
    return this.drag.finishDirectDrag(clientX, clientY);
  }
  recordActiveDragRect(nodeId: string, rect: DOMRect) {
    this.drag.recordActiveDragRect(nodeId, rect);
  }
  consumeReleaseRect(nodeId: string) {
    return this.drag.consumeReleaseRect(nodeId);
  }
  startResize(nodeId: string) {
    this.drag.startResize(nodeId);
  }
  updateResizePreview(nodeId: string, rawW: number, rawH: number) {
    this.drag.updateResizePreview(nodeId, rawW, rawH);
  }
  finishResize() {
    return this.drag.finishResize();
  }
  setNodeSizePreset(node: DashboardNode, w: number, h: number) {
    return this.drag.setNodeSizePreset(node, w, h);
  }
  cycleNodeSizePreset(node: DashboardNode, event?: MouseEvent) {
    return this.drag.cycleNodeSizePreset(node, event);
  }

  readonly handleDragStart = (event: {
    operation?: { source?: { id?: string | number } | null };
  }) => {
    this.drag.handleDragStart(event);
  };
  readonly handleDragOver = (event: DragEndEventPayload) => {
    this.drag.handleDragOver(event);
  };
  readonly handleDragEnd = (event: DragEndEventPayload) => {
    return this.drag.handleDragEnd(event);
  };

  springToPage(targetIndex: number, initialVelocity = 0) {
    this.workspaceCtrl.springToPage(targetIndex, initialVelocity);
  }
  beginPageSwipe() {
    this.workspaceCtrl.beginPageSwipe();
  }
  updatePageSwipe(deltaPages: number, dtMs: number) {
    this.workspaceCtrl.updatePageSwipe(deltaPages, dtMs);
  }
  endPageSwipe() {
    this.workspaceCtrl.endPageSwipe();
  }
  handleWheelPaging(deltaX: number, viewportWidth: number) {
    this.workspaceCtrl.handleWheelPaging(deltaX, viewportWidth);
  }
  selectWorkspace(id: string) {
    this.workspaceCtrl.selectWorkspace(id);
  }
  selectNextWorkspace() {
    return this.workspaceCtrl.selectNextWorkspace();
  }
  selectPrevWorkspace() {
    return this.workspaceCtrl.selectPrevWorkspace();
  }
  moveNodeToWorkspace(nodeId: string, targetWorkspaceId: string) {
    return this.workspaceCtrl.moveNodeToWorkspace(nodeId, targetWorkspaceId);
  }
  toggleEditMode() {
    this.workspaceCtrl.toggleEditMode();
  }
  enterEditMode() {
    this.workspaceCtrl.enterEditMode();
  }
  exitEditMode() {
    this.workspaceCtrl.exitEditMode();
  }
  createWorkspace(name: string) {
    return this.workspaceCtrl.createWorkspace(name);
  }
  deleteWorkspace(id: string, event?: MouseEvent) {
    return this.workspaceCtrl.deleteWorkspace(id, event);
  }

  get nodeModal() {
    return this.nodeCtrl.nodeModal;
  }
  set nodeModal(v) {
    this.nodeCtrl.nodeModal = v;
  }

  startGalleryWidgetDrag(clientX: number, clientY: number, previewBounds: ScreenBounds) {
    return this.nodeCtrl.startGalleryWidgetDrag(clientX, clientY, previewBounds);
  }
  togglePinToDock(nodeId: string) {
    return this.nodeCtrl.togglePinToDock(nodeId);
  }
  toggleHealthMonitor(nodeId: string) {
    return this.nodeCtrl.toggleHealthMonitor(nodeId);
  }
  quickAddReminder(text: string) {
    return this.nodeCtrl.quickAddReminder(text);
  }
  quickAddCalendarEvent(rawInput: string) {
    return this.nodeCtrl.quickAddCalendarEvent(rawInput);
  }
  inspectNode(node: DashboardNode, event?: MouseEvent) {
    this.nodeCtrl.inspectNode(node, event);
  }
  saveFlippedWidget(
    nodeId: string,
    updates: {
      title: string;
      width?: number;
      height?: number;
      settings: NodeSettings;
    },
  ) {
    return this.nodeCtrl.saveFlippedWidget(nodeId, updates);
  }
  renameNode(nodeId: string, newTitle: string) {
    return this.nodeCtrl.renameNode(nodeId, newTitle);
  }
  duplicateNode(nodeId: string) {
    return this.nodeCtrl.duplicateNode(nodeId);
  }
  extractNodeFromFolderToGrid(nodeId: string) {
    return this.nodeCtrl.extractNodeFromFolderToGrid(nodeId);
  }
  openCreateNodeModal(parentId: string | null = null, gridX?: number, gridY?: number) {
    this.nodeCtrl.openCreateNodeModal(parentId, gridX, gridY);
  }
  openEditNodeModal(node: DashboardNode, event?: MouseEvent) {
    this.nodeCtrl.openEditNodeModal(node, event);
  }
  closeNodeModal() {
    this.nodeCtrl.closeNodeModal();
  }
  updateNodeSettings(nodeId: string, newSettings: NodeSettings) {
    return this.nodeCtrl.updateNodeSettings(nodeId, newSettings);
  }
  saveNodeModal() {
    return this.nodeCtrl.saveNodeModal();
  }
  deleteNode(id: string, event?: MouseEvent) {
    return this.nodeCtrl.deleteNode(id, event);
  }
}

export const dashboard = new DashboardStore();
