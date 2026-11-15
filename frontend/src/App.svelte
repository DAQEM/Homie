<script lang="ts">
    import { DragDropProvider } from "@dnd-kit/svelte";
    import { Plus } from "@lucide/svelte";
    import { dashboard } from "./lib/state/dashboard.svelte";
    import AmbientWallpaper from "./lib/components/ui/AmbientWallpaper.svelte";
    import Header from "./lib/components/Header.svelte";
    import GridCell from "./lib/components/GridCell.svelte";
    import SortableNode from "./lib/components/SortableNode.svelte";
    import NodeRenderer from "./lib/components/NodeRenderer.svelte";
    import PageDots from "./lib/components/PageDots.svelte";
    import Dock from "./lib/components/Dock.svelte";
    import ControlCenterPopover from "./lib/components/ControlCenterPopover.svelte";
    import ContextMenu from "./lib/components/ContextMenu.svelte";
    import FolderModal from "./lib/components/FolderModal.svelte";
    import CalendarModal from "./lib/components/CalendarModal.svelte";
    import VikunjaTaskModal from "./lib/components/VikunjaTaskModal.svelte";
    import AppLibraryModal from "./lib/components/AppLibraryModal.svelte";
    import NodeFormModal from "./lib/components/NodeFormModal.svelte";
    import WorkspaceModal from "./lib/components/WorkspaceModal.svelte";
    import SpotlightModal from "./lib/components/SpotlightModal.svelte";

    $effect(() => dashboard.init());

    // Capture-phase pointer listener & non-passive wheel paging listener
    $effect(() => {
        const onCaptureMove = (e: PointerEvent) => handlePointerMove(e);
        const onCaptureUp = (e: PointerEvent) => {
            clearEdgeDragTimer();
            clearFolderDwellTimer();
            clearWallpaperLongPress();
            evictedTargetId = null;
            if (dashboard.isDirectDragging) {
                void dashboard.finishDirectDrag(e.clientX, e.clientY);
            }
            if (isPointerSwipingPage) {
                isPointerSwipingPage = false;
                dashboard.endPageSwipe();
            }
            isWallpaperPointerDown = false;
        };
        window.addEventListener("pointermove", onCaptureMove, {
            capture: true,
        });
        window.addEventListener("pointerup", onCaptureUp, { capture: true });
        window.addEventListener("pointercancel", onCaptureUp, {
            capture: true,
        });
        window.addEventListener("wheel", handleHorizontalWheel, {
            passive: false,
        });
        return () => {
            window.removeEventListener("pointermove", onCaptureMove, {
                capture: true,
            });
            window.removeEventListener("pointerup", onCaptureUp, {
                capture: true,
            });
            window.removeEventListener("pointercancel", onCaptureUp, {
                capture: true,
            });
            window.removeEventListener("wheel", handleHorizontalWheel);
        };
    });

    let gridSectionEls = $state<Record<string, HTMLElement | null>>({});
    let edgeDragTimer: ReturnType<typeof setTimeout> | null = null;
    let folderDwellTimer: ReturnType<typeof setTimeout> | null = null;
    let folderEvictTimer: ReturnType<typeof setTimeout> | null = null;
    let folderDwellCandidateId: string | null = null;
    let evictedTargetId: string | null = null;
    let wallpaperLongPressTimer: ReturnType<typeof setTimeout> | null = null;
    let wallpaperDownPos = { x: 0, y: 0 };
    let isWallpaperPointerDown = false;
    let isPointerSwipingPage = false;
    let lastPointerSwipeX = 0;
    let lastPointerSwipeTime = 0;

    // Native touch swipe state for smooth iPad / tablet / mobile workspace paging
    let touchSwipeStart = { x: 0, y: 0 };
    let isTouchTracking = false;
    let isTouchSwipingPage = false;
    let lastTouchX = 0;
    let lastTouchTime = 0;

    let cells = $derived.by(() => {
        const cols = dashboard.activeGridCols;
        const rows = dashboard.activeGridRows;
        const list: { x: number; y: number; occupied: boolean }[] = [];
        for (let y = 1; y <= rows; y++) {
            for (let x = 1; x <= cols; x++) {
                list.push({
                    x,
                    y,
                    occupied: dashboard.isCellOccupied(x, y),
                });
            }
        }
        return list;
    });

    let isFullModalRecessed = $derived(
        dashboard.openFolderId !== null ||
            dashboard.openCalendarNodeId !== null ||
            dashboard.openVikunjaTaskId !== null ||
            dashboard.isSpotlightOpen ||
            dashboard.isAppLibraryOpen,
    );

    let isQuickActionRecessed = $derived(dashboard.contextMenu.open);

    function clearEdgeDragTimer() {
        if (edgeDragTimer) {
            clearTimeout(edgeDragTimer);
            edgeDragTimer = null;
        }
    }

    function clearFolderDwellTimer() {
        if (folderDwellTimer) {
            clearTimeout(folderDwellTimer);
            folderDwellTimer = null;
        }
        if (folderEvictTimer) {
            clearTimeout(folderEvictTimer);
            folderEvictTimer = null;
        }
        folderDwellCandidateId = null;
    }

    function clearWallpaperLongPress() {
        if (wallpaperLongPressTimer) {
            clearTimeout(wallpaperLongPressTimer);
            wallpaperLongPressTimer = null;
        }
    }

    function isBackgroundTarget(target: EventTarget | null): boolean {
        if (!(target instanceof HTMLElement)) return false;
        return (
            target.tagName === "MAIN" ||
            target.dataset.wallpaperSurface === "true" ||
            target.parentElement?.dataset.wallpaperSurface === "true"
        );
    }

    function handleBackgroundPointerDown(e: PointerEvent) {
        if (e.pointerType === "touch") return;
        if (e.button !== 0 || !isBackgroundTarget(e.target)) return;
        wallpaperDownPos = { x: e.clientX, y: e.clientY };
        isWallpaperPointerDown = true;
        isPointerSwipingPage = false;
        lastPointerSwipeX = e.clientX;
        lastPointerSwipeTime = performance.now();
        clearWallpaperLongPress();

        if (!dashboard.isEditMode) {
            wallpaperLongPressTimer = setTimeout(() => {
                wallpaperLongPressTimer = null;
                if (!isPointerSwipingPage) {
                    isWallpaperPointerDown = false;
                    dashboard.enterEditMode();
                }
            }, 420);
        }
    }

    function handleViewportTouchStart(e: TouchEvent) {
        if (
            e.touches.length !== 1 ||
            dashboard.isEditMode ||
            dashboard.flippedNodeId ||
            dashboard.workspaces.length <= 1 ||
            dashboard.activeDragNodeId ||
            dashboard.resizingNodeId
        ) {
            isTouchTracking = false;
            return;
        }

        const target = e.target as HTMLElement | null;
        if (target?.closest("input, textarea, select, [data-no-swipe]")) {
            isTouchTracking = false;
            return;
        }

        const t = e.touches[0];
        touchSwipeStart = { x: t.clientX, y: t.clientY };
        lastTouchX = t.clientX;
        lastTouchTime = performance.now();
        isTouchTracking = true;
        isTouchSwipingPage = false;
    }

    function handleViewportTouchMove(e: TouchEvent) {
        if (!isTouchTracking || e.touches.length !== 1) return;
        const t = e.touches[0];
        const totalDx = t.clientX - touchSwipeStart.x;
        const totalDy = t.clientY - touchSwipeStart.y;

        if (!isTouchSwipingPage) {
            if (
                Math.abs(totalDy) > 16 &&
                Math.abs(totalDy) > Math.abs(totalDx)
            ) {
                isTouchTracking = false;
                return;
            }
            if (
                Math.abs(totalDx) > 14 &&
                Math.abs(totalDx) > Math.abs(totalDy) * 1.25
            ) {
                isTouchSwipingPage = true;
                dashboard.beginPageSwipe();
                lastTouchX = t.clientX;
                lastTouchTime = performance.now();
            } else {
                return;
            }
        }

        const now = performance.now();
        const dt = Math.max(8, now - lastTouchTime);
        const stepDx = t.clientX - lastTouchX;
        lastTouchX = t.clientX;
        lastTouchTime = now;

        const deltaPages = -stepDx / Math.max(window.innerWidth || 768, 320);
        dashboard.updatePageSwipe(deltaPages, dt);
    }

    function handleViewportTouchEnd() {
        if (isTouchSwipingPage) {
            dashboard.endPageSwipe();
        }
        isTouchTracking = false;
        isTouchSwipingPage = false;
    }

    function handleBackgroundClick(e: MouseEvent) {
        if (!isBackgroundTarget(e.target)) return;
        const dist = Math.hypot(
            e.clientX - wallpaperDownPos.x,
            e.clientY - wallpaperDownPos.y,
        );
        if (dist < 6 && !dashboard.activeDragNodeId) {
            if (dashboard.flippedNodeId) {
                dashboard.flippedNodeId = null;
                return;
            }
            if (dashboard.isEditMode) {
                dashboard.exitEditMode();
            }
        }
    }

    function handleBackgroundDblClick(e: MouseEvent) {
        if (!isBackgroundTarget(e.target)) return;
        dashboard.toggleEditMode();
    }

    function handleGlobalKeydown(e: KeyboardEvent) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
            e.preventDefault();
            dashboard.toggleSpotlight();
            return;
        }

        const tag = (e.target as HTMLElement | null)?.tagName;
        const isTyping =
            tag === "INPUT" ||
            tag === "TEXTAREA" ||
            tag === "SELECT" ||
            (e.target as HTMLElement | null)?.isContentEditable;

        if (e.key === "Escape") {
            if (dashboard.isControlCenterOpen) {
                dashboard.closeControlCenter();
                return;
            }
            if (dashboard.isSpotlightOpen) {
                dashboard.closeSpotlight();
                return;
            }
            if (dashboard.openVikunjaTaskId !== null) {
                dashboard.closeVikunjaModal();
                return;
            }
            if (dashboard.openCalendarNodeId) {
                dashboard.closeCalendarModal();
                return;
            }
            if (dashboard.isAppLibraryOpen) {
                dashboard.closeAppLibrary();
                return;
            }
            if (dashboard.openFolderId) {
                dashboard.closeFolder();
                return;
            }
            if (dashboard.contextMenu.open) {
                dashboard.closeContextMenu();
                return;
            }
            if (dashboard.flippedNodeId) {
                dashboard.flippedNodeId = null;
                return;
            }
            if (
                dashboard.isEditMode &&
                !dashboard.nodeModal.open &&
                !dashboard.isWorkspaceModalOpen
            ) {
                dashboard.exitEditMode();
                return;
            }
        }

        if (isTyping) return;

        if (
            e.key === "/" &&
            !dashboard.openFolderId &&
            !dashboard.openCalendarNodeId &&
            dashboard.openVikunjaTaskId === null &&
            !dashboard.isAppLibraryOpen &&
            !dashboard.isControlCenterOpen &&
            !dashboard.nodeModal.open &&
            !dashboard.isWorkspaceModalOpen
        ) {
            e.preventDefault();
            dashboard.openSpotlight();
            return;
        }

        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e") {
            e.preventDefault();
            dashboard.toggleEditMode();
            return;
        }

        if (
            dashboard.isSpotlightOpen ||
            dashboard.openCalendarNodeId ||
            dashboard.openVikunjaTaskId !== null ||
            dashboard.isAppLibraryOpen ||
            dashboard.isControlCenterOpen ||
            dashboard.contextMenu.open ||
            dashboard.openFolderId ||
            dashboard.nodeModal.open ||
            dashboard.isWorkspaceModalOpen
        ) {
            return;
        }

        if ((e.metaKey || e.altKey) && e.key === "ArrowRight") {
            e.preventDefault();
            dashboard.selectNextWorkspace();
        } else if ((e.metaKey || e.altKey) && e.key === "ArrowLeft") {
            e.preventDefault();
            dashboard.selectPrevWorkspace();
        }
    }

    function handleHorizontalWheel(e: WheelEvent) {
        if (
            dashboard.isSpotlightOpen ||
            dashboard.openCalendarNodeId ||
            dashboard.openVikunjaTaskId !== null ||
            dashboard.isAppLibraryOpen ||
            dashboard.isControlCenterOpen ||
            dashboard.contextMenu.open ||
            dashboard.openFolderId ||
            dashboard.nodeModal.open ||
            dashboard.isWorkspaceModalOpen ||
            dashboard.activeDragNodeId ||
            dashboard.resizingNodeId
        ) {
            return;
        }

        if (
            Math.abs(e.deltaX) > 4 &&
            Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.2
        ) {
            e.preventDefault();
            dashboard.handleWheelPaging(e.deltaX, window.innerWidth || 1280);
        }
    }

    function handlePointerMove(e: PointerEvent) {
        if (wallpaperLongPressTimer) {
            const dist = Math.hypot(
                e.clientX - wallpaperDownPos.x,
                e.clientY - wallpaperDownPos.y,
            );
            if (dist > 8) clearWallpaperLongPress();
        }

        if (dashboard.isDirectDragging) {
            dashboard.updateDirectDrag(e.clientX, e.clientY);
        }

        if (
            isWallpaperPointerDown &&
            !dashboard.activeDragNodeId &&
            !dashboard.resizingNodeId &&
            dashboard.workspaces.length > 0
        ) {
            const totalDx = e.clientX - wallpaperDownPos.x;
            const totalDy = e.clientY - wallpaperDownPos.y;

            if (
                !isPointerSwipingPage &&
                Math.abs(totalDx) > 10 &&
                Math.abs(totalDx) > Math.abs(totalDy) * 1.2
            ) {
                clearWallpaperLongPress();
                isPointerSwipingPage = true;
                dashboard.beginPageSwipe();
                lastPointerSwipeX = e.clientX;
                lastPointerSwipeTime = performance.now();
            }

            if (isPointerSwipingPage) {
                const now = performance.now();
                const dt = Math.max(8, now - lastPointerSwipeTime);
                const stepDx = e.clientX - lastPointerSwipeX;
                lastPointerSwipeX = e.clientX;
                lastPointerSwipeTime = now;

                const deltaPages =
                    -stepDx / Math.max(window.innerWidth || 1280, 320);
                dashboard.updatePageSwipe(deltaPages, dt);
                return;
            }
        }

        if (!dashboard.isEditMode || !dashboard.activeDragNodeId) {
            clearEdgeDragTimer();
            clearFolderDwellTimer();
            evictedTargetId = null;
            return;
        }

        const activeWsId = dashboard.activeWorkspace?.id;
        const activeGridEl = activeWsId
            ? gridSectionEls[activeWsId]
            : undefined;

        if (activeGridEl && !dashboard.openFolderId) {
            const rect = activeGridEl.getBoundingClientRect();
            const isInsideGrid =
                e.clientX >= rect.left &&
                e.clientX <= rect.right &&
                e.clientY >= rect.top &&
                e.clientY <= rect.bottom + 40;

            if (isInsideGrid) {
                const activeCols = dashboard.activeGridCols;
                const colWidth = rect.width / activeCols;
                const rowHeight = 116;
                const relX = e.clientX - rect.left;
                const relY = e.clientY - rect.top;

                const exactCol = relX / colWidth + 1;
                const exactRow = relY / rowHeight + 1;
                const rawCol = Math.floor(relX / colWidth) + 1;
                const rawRow = Math.floor(relY / rowHeight) + 1;

                const draggedNode = dashboard.nodes.find(
                    (n) => n.id === dashboard.activeDragNodeId,
                );
                const draggedType = draggedNode?.node_type;
                const isDraggedAction = draggedType === "action";
                const isDraggedWidget = Boolean(
                    draggedType &&
                    draggedType !== "action" &&
                    draggedType !== "container",
                );

                const candidateNode = dashboard.rootNodes.find((n) => {
                    if (n.id === draggedNode?.id) return false;
                    const nRect = dashboard.getEffectiveRect(n);
                    const inBounds =
                        rawCol >= nRect.x &&
                        rawCol < nRect.x + nRect.w &&
                        rawRow >= nRect.y &&
                        rawRow < nRect.y + nRect.h;
                    if (!inBounds) return false;

                    if (isDraggedAction) {
                        return (
                            n.node_type === "action" ||
                            n.node_type === "container"
                        );
                    }

                    const isTargetWidget =
                        n.node_type !== "action" && n.node_type !== "container";

                    return Boolean(
                        draggedNode &&
                        isDraggedWidget &&
                        isTargetWidget &&
                        (draggedNode.width || 2) === (n.width || 2) &&
                        (draggedNode.height || 2) === (n.height || 2),
                    );
                });

                if (candidateNode && evictedTargetId !== candidateNode.id) {
                    evictedTargetId = null;
                }

                if (candidateNode && evictedTargetId !== candidateNode.id) {
                    const cRect = dashboard.getEffectiveRect(candidateNode);
                    const u = (exactCol - cRect.x) / cRect.w;
                    const v = (exactRow - cRect.y) / cRect.h;

                    const edgeMargin =
                        cRect.w >= 2 || cRect.h >= 2 ? 0.15 : 0.2;
                    const isInsideDropCore =
                        u > edgeMargin &&
                        u < 1 - edgeMargin &&
                        v > edgeMargin &&
                        v < 1 - edgeMargin;

                    if (isInsideDropCore) {
                        dashboard.holdGridReflowOnTarget();

                        if (folderDwellCandidateId !== candidateNode.id) {
                            clearFolderDwellTimer();
                            folderDwellCandidateId = candidateNode.id;

                            const activateDelay =
                                candidateNode.node_type === "container"
                                    ? 90
                                    : 220;

                            folderDwellTimer = setTimeout(() => {
                                folderDwellTimer = null;
                                dashboard.setFolderMergeTarget(
                                    candidateNode.id,
                                );
                            }, activateDelay);

                            folderEvictTimer = setTimeout(() => {
                                folderEvictTimer = null;
                                evictedTargetId = candidateNode.id;
                                folderDwellCandidateId = null;
                                dashboard.setFolderMergeTarget(null);
                                dashboard.updateDragReflow(rawCol, rawRow);
                            }, 1050);
                        }
                    } else {
                        clearFolderDwellTimer();
                        if (dashboard.folderMergeTargetId) {
                            dashboard.setFolderMergeTarget(null);
                        }
                        dashboard.updateDragReflow(rawCol, rawRow);
                    }
                } else {
                    if (!candidateNode) {
                        evictedTargetId = null;
                    }
                    clearFolderDwellTimer();
                    if (dashboard.folderMergeTargetId) {
                        dashboard.setFolderMergeTarget(null);
                    }
                    dashboard.updateDragReflow(rawCol, rawRow);
                }
            }
        }

        const edgeThreshold = 44;
        const nearLeft = e.clientX < edgeThreshold;
        const nearRight = e.clientX > window.innerWidth - edgeThreshold;

        if (!nearLeft && !nearRight) {
            clearEdgeDragTimer();
            return;
        }

        if (!edgeDragTimer) {
            edgeDragTimer = setTimeout(async () => {
                edgeDragTimer = null;
                const draggedId = dashboard.activeDragNodeId;
                if (!draggedId) return;

                const moved = nearRight
                    ? dashboard.selectNextWorkspace()
                    : dashboard.selectPrevWorkspace();

                if (moved && dashboard.activeWorkspace) {
                    await dashboard.moveNodeToWorkspace(
                        draggedId,
                        dashboard.activeWorkspace.id,
                    );
                }
            }, 520);
        }
    }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<AmbientWallpaper />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<main
    data-wallpaper-surface="true"
    onpointerdown={handleBackgroundPointerDown}
    onclick={handleBackgroundClick}
    ondblclick={handleBackgroundDblClick}
    class="relative min-h-screen pt-2 pb-36 space-y-4 overflow-x-hidden transform-gpu will-change-[transform,opacity] transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] {isFullModalRecessed
        ? 'scale-[0.958] opacity-55 pointer-events-none'
        : isQuickActionRecessed
          ? 'scale-[0.974] opacity-68 pointer-events-none'
          : ''}"
>
    <section class="max-w-[1520px] mx-auto px-4">
        <Header />
    </section>

    {#if dashboard.workspaces.length === 0}
        <section class="max-w-md mx-auto mt-20 px-4 text-center select-none">
            <div class="ios-modal-surface rounded-[30px] p-8 space-y-4">
                <h2 class="text-xl font-semibold text-white ios-tight-tracking">
                    Welcome to Homie
                </h2>
                <p class="text-xs text-white/60 leading-relaxed">
                    Create your first Home Screen page to start pinning apps,
                    widgets, calendars, and Vikunja tasks.
                </p>
                <button
                    type="button"
                    onclick={() => (dashboard.isWorkspaceModalOpen = true)}
                    class="inline-flex items-center gap-1.5 rounded-full bg-primary text-white px-4 py-2 text-xs font-semibold shadow-md hover:brightness-110 active:scale-95 transition-all cursor-pointer"
                >
                    <Plus class="size-3.5 stroke-[2.5]" />
                    <span>Create Home Screen</span>
                </button>
            </div>
        </section>
    {/if}

    <DragDropProvider
        onDragStart={dashboard.handleDragStart}
        onDragOver={dashboard.handleDragOver}
        onDragEnd={dashboard.handleDragEnd}
    >
        <!-- Continuous Horizontal Spatial Viewport -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            data-wallpaper-surface="true"
            ontouchstart={handleViewportTouchStart}
            ontouchmove={handleViewportTouchMove}
            ontouchend={handleViewportTouchEnd}
            ontouchcancel={handleViewportTouchEnd}
            class="relative w-full overflow-x-clip touch-pan-y"
        >
            <div
                data-wallpaper-surface="true"
                style="transform: translate3d(calc({-dashboard.pagePosition} * 100%), 0, 0);"
                class="flex w-full will-change-transform"
            >
                {#each dashboard.workspaces as ws, pageIdx (ws.id)}
                    {@const isActivePage =
                        ws.id === dashboard.activeWorkspace?.id}
                    {@const isNearViewport =
                        Math.abs(dashboard.pagePosition - pageIdx) <= 1.05}
                    {@const pageNodes = dashboard.getWorkspaceRootNodes(ws.id)}

                    <div
                        data-wallpaper-surface="true"
                        class="w-full shrink-0 px-4 {isNearViewport
                            ? ''
                            : 'invisible pointer-events-none'}"
                    >
                        <section
                            bind:this={gridSectionEls[ws.id]}
                            data-wallpaper-surface="true"
                            style="grid-template-columns: repeat({dashboard.activeGridCols}, minmax(0, 1fr));"
                            class="relative grid auto-rows-[100px] gap-4 max-w-[1520px] mx-auto"
                        >
                            {#if isActivePage}
                                {#each cells as cell (`${cell.x}:${cell.y}`)}
                                    <GridCell
                                        x={cell.x}
                                        y={cell.y}
                                        occupied={cell.occupied}
                                    />
                                {/each}

                                {#if dashboard.isEditMode && dashboard.dropPreview}
                                    <div
                                        style="grid-column: {dashboard
                                            .dropPreview.x} / span {dashboard
                                            .dropPreview
                                            .w}; grid-row: {dashboard
                                            .dropPreview.y} / span {dashboard
                                            .dropPreview.h};"
                                        class="block pointer-events-none z-0 ios-drop-ghost"
                                    ></div>
                                {/if}
                            {:else}
                                <div
                                    aria-hidden="true"
                                    style="grid-column: 1 / -1; grid-row: 1 / span {dashboard.activeGridRows};"
                                    class="pointer-events-none"
                                ></div>
                            {/if}

                            {#each pageNodes as node (node.id)}
                                <SortableNode {node}>
                                    <NodeRenderer {node} />
                                </SortableNode>
                            {/each}
                        </section>
                    </div>
                {/each}
            </div>
        </div>

        <PageDots />
        <Dock />
    </DragDropProvider>
</main>

<ControlCenterPopover />
<SpotlightModal />
<ContextMenu />
<FolderModal />
<CalendarModal />
<VikunjaTaskModal />
<AppLibraryModal />
<NodeFormModal />
<WorkspaceModal />
