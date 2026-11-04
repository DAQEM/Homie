<script lang="ts">
    import { DragDropProvider } from "@dnd-kit/svelte";
    import {
        GRID_COLS,
        GRID_ROWS,
        dashboard,
    } from "./lib/state/dashboard.svelte";
    import AmbientWallpaper from "./lib/components/ui/AmbientWallpaper.svelte";
    import Header from "./lib/components/Header.svelte";
    import GridCell from "./lib/components/GridCell.svelte";
    import SortableNode from "./lib/components/SortableNode.svelte";
    import NodeRenderer from "./lib/components/NodeRenderer.svelte";
    import PageDots from "./lib/components/PageDots.svelte";
    import Dock from "./lib/components/Dock.svelte";
    import ContextMenu from "./lib/components/ContextMenu.svelte";
    import FolderModal from "./lib/components/FolderModal.svelte";
    import NodeFormModal from "./lib/components/NodeFormModal.svelte";
    import WorkspaceModal from "./lib/components/WorkspaceModal.svelte";
    import SpotlightModal from "./lib/components/SpotlightModal.svelte";

    $effect(() => dashboard.init());

    // Capture-phase pointer listener so @dnd-kit's stopPropagation() cannot swallow drag coordinates
    $effect(() => {
        const onCaptureMove = (e: PointerEvent) => handlePointerMove(e);
        const onCaptureUp = () => {
            clearEdgeDragTimer();
            clearFolderDwellTimer();
            clearWallpaperLongPress();
        };
        window.addEventListener("pointermove", onCaptureMove, {
            capture: true,
        });
        window.addEventListener("pointerup", onCaptureUp, { capture: true });
        return () => {
            window.removeEventListener("pointermove", onCaptureMove, {
                capture: true,
            });
            window.removeEventListener("pointerup", onCaptureUp, {
                capture: true,
            });
        };
    });

    let gridSectionEl: HTMLElement | undefined = $state();
    let lastWheelSwitchAt = 0;
    let edgeDragTimer: ReturnType<typeof setTimeout> | null = null;
    let folderDwellTimer: ReturnType<typeof setTimeout> | null = null;
    let folderDwellCandidateId: string | null = null;
    let wallpaperLongPressTimer: ReturnType<typeof setTimeout> | null = null;
    let wallpaperDownPos = { x: 0, y: 0 };

    let cells = $derived.by(() => {
        const list: { x: number; y: number; occupied: boolean }[] = [];
        for (let y = 1; y <= GRID_ROWS; y++) {
            for (let x = 1; x <= GRID_COLS; x++) {
                list.push({
                    x,
                    y,
                    occupied: dashboard.isCellOccupied(x, y),
                });
            }
        }
        return list;
    });

    let isRecessed = $derived(
        dashboard.openFolderId !== null || dashboard.isSpotlightOpen,
    );

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
        if (e.button !== 0 || !isBackgroundTarget(e.target)) return;
        wallpaperDownPos = { x: e.clientX, y: e.clientY };
        clearWallpaperLongPress();

        if (!dashboard.isEditMode) {
            wallpaperLongPressTimer = setTimeout(() => {
                wallpaperLongPressTimer = null;
                dashboard.enterEditMode();
            }, 420);
        }
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
            (e.target as HTMLElement | null)?.isContentEditable;

        if (e.key === "Escape") {
            if (dashboard.isSpotlightOpen) {
                dashboard.closeSpotlight();
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
                !dashboard.openFolderId &&
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
            dashboard.openFolderId ||
            dashboard.nodeModal.open ||
            dashboard.isWorkspaceModalOpen
        ) {
            return;
        }

        if (
            Math.abs(e.deltaX) > 42 &&
            Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5
        ) {
            const now = performance.now();
            if (now - lastWheelSwitchAt < 520) return;

            if (e.deltaX > 0 && dashboard.selectNextWorkspace()) {
                lastWheelSwitchAt = now;
            } else if (e.deltaX < 0 && dashboard.selectPrevWorkspace()) {
                lastWheelSwitchAt = now;
            }
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

        if (!dashboard.isEditMode || !dashboard.activeDragNodeId) {
            clearEdgeDragTimer();
            clearFolderDwellTimer();
            return;
        }

        if (gridSectionEl && !dashboard.openFolderId) {
            const rect = gridSectionEl.getBoundingClientRect();
            const isInsideGrid =
                e.clientX >= rect.left &&
                e.clientX <= rect.right &&
                e.clientY >= rect.top &&
                e.clientY <= rect.bottom + 40;

            if (isInsideGrid) {
                const colWidth = rect.width / GRID_COLS;
                const rowHeight = 116;
                const relX = e.clientX - rect.left;
                const relY = e.clientY - rect.top;
                const rawCol = Math.floor(relX / colWidth) + 1;
                const rawRow = Math.floor(relY / rowHeight) + 1;

                const draggedNode = dashboard.nodes.find(
                    (n) => n.id === dashboard.activeDragNodeId,
                );
                const cellOffsetX = (relX % colWidth) / colWidth;
                const cellOffsetY = (relY % rowHeight) / rowHeight;
                const isNearCellCenter =
                    cellOffsetX > 0.22 &&
                    cellOffsetX < 0.78 &&
                    cellOffsetY > 0.2 &&
                    cellOffsetY < 0.8;

                const targetAtCell =
                    draggedNode?.node_type === "action" && isNearCellCenter
                        ? dashboard.rootNodes.find(
                              (n) =>
                                  n.id !== draggedNode.id &&
                                  (n.node_type === "action" ||
                                      n.node_type === "container") &&
                                  rawCol >= n.grid_x &&
                                  rawCol < n.grid_x + (n.width || 1) &&
                                  rawRow >= n.grid_y &&
                                  rawRow < n.grid_y + (n.height || 1),
                          )
                        : undefined;

                if (targetAtCell) {
                    if (folderDwellCandidateId !== targetAtCell.id) {
                        clearFolderDwellTimer();
                        dashboard.setFolderMergeTarget(null);
                        folderDwellCandidateId = targetAtCell.id;
                        folderDwellTimer = setTimeout(() => {
                            folderDwellTimer = null;
                            dashboard.setFolderMergeTarget(targetAtCell.id);
                        }, 460);
                    }
                } else {
                    clearFolderDwellTimer();
                    if (dashboard.folderMergeTargetId) {
                        dashboard.setFolderMergeTarget(null);
                    }
                }

                if (!dashboard.folderMergeTargetId) {
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

<svelte:window
    onkeydown={handleGlobalKeydown}
    onwheel={handleHorizontalWheel}
/>

<AmbientWallpaper />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<main
    data-wallpaper-surface="true"
    onpointerdown={handleBackgroundPointerDown}
    onclick={handleBackgroundClick}
    ondblclick={handleBackgroundDblClick}
    class="relative min-h-screen px-4 pt-2 pb-36 space-y-4 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] {isRecessed
        ? 'scale-[0.955] blur-[6px] opacity-60 pointer-events-none'
        : ''}"
>
    <section class="max-w-[1520px] mx-auto">
        <Header />
    </section>

    <DragDropProvider
        onDragStart={dashboard.handleDragStart}
        onDragOver={dashboard.handleDragOver}
        onDragEnd={dashboard.handleDragEnd}
    >
        {#key dashboard.activeWorkspace?.id}
            <section
                bind:this={gridSectionEl}
                data-wallpaper-surface="true"
                class="relative grid grid-cols-4 md:grid-cols-8 lg:grid-cols-16 auto-rows-[100px] gap-4 max-w-[1520px] mx-auto {dashboard.pageSlideDirection ===
                'right'
                    ? 'ios-page-slide-right'
                    : dashboard.pageSlideDirection === 'left'
                      ? 'ios-page-slide-left'
                      : ''}"
            >
                {#each cells as cell (`${cell.x}:${cell.y}`)}
                    <GridCell x={cell.x} y={cell.y} occupied={cell.occupied} />
                {/each}

                {#if dashboard.isEditMode && dashboard.dropPreview}
                    <div
                        style="grid-column: {dashboard.dropPreview
                            .x} / span {dashboard.dropPreview
                            .w}; grid-row: {dashboard.dropPreview
                            .y} / span {dashboard.dropPreview.h};"
                        class="hidden lg:block pointer-events-none z-0 ios-drop-ghost"
                    ></div>
                {/if}

                {#each dashboard.rootNodes as node (node.id)}
                    <SortableNode {node}>
                        <NodeRenderer {node} />
                    </SortableNode>
                {/each}
            </section>
        {/key}

        <PageDots />
        <Dock />
    </DragDropProvider>
</main>

<SpotlightModal />
<ContextMenu />
<FolderModal />
<NodeFormModal />
<WorkspaceModal />
