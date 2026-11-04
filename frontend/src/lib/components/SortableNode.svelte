<script lang="ts">
    import type { Snippet } from "svelte";
    import { createDraggable, createDroppable } from "@dnd-kit/svelte";
    import { SlidersHorizontal, X } from "@lucide/svelte";
    import { dashboard, WIDGET_SIZE_PRESETS } from "../state/dashboard.svelte";
    import type { DashboardNode } from "../types";
    import WidgetBackface from "./WidgetBackface.svelte";

    interface Props {
        node: DashboardNode;
        inContainer?: boolean;
        inDock?: boolean;
        inModal?: boolean;
        showResizeBadge?: boolean;
        children?: Snippet;
    }

    let {
        node,
        inContainer = false,
        inDock = false,
        inModal = false,
        showResizeBadge = true,
        children,
    }: Props = $props();

    let outerEl: HTMLDivElement | undefined = $state();
    let prevRect: DOMRect | null = null;
    let prevGridKey = "";

    let isTactilePressed = $state(false);
    let isHoldingGesture = $state(false);
    let quickActionTimer: ReturnType<typeof setTimeout> | null = null;
    let jigglePromoteTimer: ReturnType<typeof setTimeout> | null = null;
    let pointerStartPos = { x: 0, y: 0 };
    let pointerDownInitialBounds = { left: 0, top: 0, width: 0, height: 0 };

    let isResizing = $derived(dashboard.resizingNodeId === node.id);
    let isFlipped = $derived(dashboard.flippedNodeId === node.id);
    let isContextTarget = $derived(
        dashboard.contextMenu.open && dashboard.contextMenu.nodeId === node.id,
    );
    let isDirectDragTarget = $derived(
        dashboard.isDirectDragging && dashboard.activeDragNodeId === node.id,
    );

    let isDisabled = $derived(
        !dashboard.isEditMode ||
            dashboard.isDirectDragging ||
            isResizing ||
            isFlipped ||
            (!inModal && dashboard.openFolderId !== null),
    );

    let isRootGridNode = $derived(!inContainer && !inDock);

    let effectiveRect = $derived(
        isRootGridNode
            ? dashboard.getEffectiveRect(node)
            : {
                  x: node.grid_x,
                  y: node.grid_y,
                  w: node.width || 1,
                  h: node.height || 1,
              },
    );

    let gridStyle = $derived(
        !isRootGridNode
            ? ""
            : `--col-start: ${effectiveRect.x}; --row-start: ${effectiveRect.y}; --col-span: ${effectiveRect.w}; --row-span: ${effectiveRect.h}; --col-span-sm: ${Math.min(effectiveRect.w, 4)}; --col-span-md: ${Math.min(effectiveRect.w, 8)};`,
    );

    let directDragStyle = $derived(
        isDirectDragTarget
            ? `transform: translate3d(${dashboard.directDragDelta.x}px, ${dashboard.directDragDelta.y}px, 0) scale(1.05);`
            : "",
    );

    let jiggleTiming = $derived.by(() => {
        let hash = 0;
        for (let i = 0; i < node.id.length; i++) {
            hash = (hash * 31 + node.id.charCodeAt(i)) | 0;
        }
        const abs = Math.abs(hash);
        const delayMs = -(abs % 280);
        const durationMs = 250 + (abs % 55);
        return `animation-delay: ${delayMs}ms; animation-duration: ${durationMs}ms;`;
    });

    let canResizeWidget = $derived(
        showResizeBadge &&
            !inDock &&
            !inContainer &&
            (WIDGET_SIZE_PRESETS[node.node_type]?.length ?? 0) > 1,
    );

    const droppable = createDroppable({
        get id() {
            return node.id;
        },
        get disabled() {
            return isDisabled;
        },
    });

    const draggable = createDraggable({
        get id() {
            return node.id;
        },
        get disabled() {
            return isDisabled;
        },
    });

    // Global capture listener while holding so releasing over ContextMenu backdrop always clears timers
    $effect(() => {
        if (!isHoldingGesture) return;
        const onWindowUp = () => clearGestureTimers();
        window.addEventListener("pointerup", onWindowUp, { capture: true });
        window.addEventListener("pointercancel", onWindowUp, { capture: true });
        return () => {
            window.removeEventListener("pointerup", onWindowUp, {
                capture: true,
            });
            window.removeEventListener("pointercancel", onWindowUp, {
                capture: true,
            });
        };
    });

    // Continuously record the live visual screen rect while @dnd-kit is dragging this node
    $effect(() => {
        if (!draggable.isDragging || !outerEl) return;
        const recordNow = () => {
            if (outerEl && draggable.isDragging) {
                dashboard.recordActiveDragRect(
                    node.id,
                    outerEl.getBoundingClientRect(),
                );
            }
        };
        recordNow();
        window.addEventListener("pointermove", recordNow, { capture: true });
        return () => {
            window.removeEventListener("pointermove", recordNow, {
                capture: true,
            });
        };
    });

    $effect.pre(() => {
        const _key = `${effectiveRect.x}:${effectiveRect.y}:${effectiveRect.w}:${effectiveRect.h}`;
        const _settleSeq = dashboard.settlingDrop?.seq;
        if (
            outerEl &&
            isRootGridNode &&
            !draggable.isDragging &&
            !isDirectDragTarget
        ) {
            prevRect = outerEl.getBoundingClientRect();
        }
    });

    // Full-Cycle Spring Drop Settlement & Sibling Reflow FLIP
    $effect(() => {
        const currentKey = `${effectiveRect.x}:${effectiveRect.y}:${effectiveRect.w}:${effectiveRect.h}`;
        const _settleSeq = dashboard.settlingDrop?.seq;

        if (outerEl && !draggable.isDragging && !isDirectDragTarget) {
            const releaseBounds = dashboard.consumeReleaseRect(node.id);
            if (releaseBounds) {
                const nextRect = outerEl.getBoundingClientRect();
                const dx = releaseBounds.left - nextRect.left;
                const dy = releaseBounds.top - nextRect.top;

                if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
                    outerEl.animate(
                        [
                            {
                                transform: `translate3d(${dx}px, ${dy}px, 0) scale(1.06)`,
                            },
                            { transform: "translate3d(0, 0, 0) scale(1)" },
                        ],
                        {
                            duration: 360,
                            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
                        },
                    );
                }
            } else if (
                prevRect &&
                prevGridKey &&
                prevGridKey !== currentKey &&
                isRootGridNode
            ) {
                const nextRect = outerEl.getBoundingClientRect();
                const dx = prevRect.left - nextRect.left;
                const dy = prevRect.top - nextRect.top;

                if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
                    outerEl.animate(
                        [
                            { transform: `translate3d(${dx}px, ${dy}px, 0)` },
                            { transform: "translate3d(0, 0, 0)" },
                        ],
                        {
                            duration: 320,
                            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
                        },
                    );
                }
            }
        }
        prevGridKey = currentKey;
    });

    function clearGestureTimers() {
        isTactilePressed = false;
        isHoldingGesture = false;
        if (quickActionTimer) {
            clearTimeout(quickActionTimer);
            quickActionTimer = null;
        }
        if (jigglePromoteTimer) {
            clearTimeout(jigglePromoteTimer);
            jigglePromoteTimer = null;
        }
    }

    function promoteHoldGesture() {
        clearGestureTimers();
        if (isRootGridNode) {
            dashboard.promoteHoldToDirectDrag(
                node.id,
                pointerStartPos.x,
                pointerStartPos.y,
                pointerDownInitialBounds,
            );
        } else {
            dashboard.closeContextMenu();
            dashboard.enterEditMode();
        }
    }

    function handlePointerDown(e: PointerEvent) {
        if (e.button !== 0 || isFlipped) return;

        // Prevent child actions inside a container from triggering the parent container's hold timer
        if (inContainer || inDock || inModal) {
            e.stopPropagation();
        }

        if (outerEl && isRootGridNode) {
            const rect = outerEl.getBoundingClientRect();
            const wCols = Math.max(1, node.width || 1);
            const hRows = Math.max(1, node.height || 1);
            const colOffset = Math.floor(
                ((e.clientX - rect.left) / rect.width) * wCols,
            );
            const rowOffset = Math.floor(
                ((e.clientY - rect.top) / rect.height) * hRows,
            );
            dashboard.setDragGrabOffset(colOffset, rowOffset);
        } else {
            dashboard.setDragGrabOffset(0, 0);
        }

        if (dashboard.isEditMode) return;

        const target = e.target as HTMLElement | null;
        if (
            target?.closest("input, button, textarea, label") &&
            node.node_type !== "action" &&
            node.node_type !== "container"
        ) {
            return;
        }

        pointerStartPos = { x: e.clientX, y: e.clientY };
        if (outerEl) {
            const r = outerEl.getBoundingClientRect();
            pointerDownInitialBounds = {
                left: r.left,
                top: r.top,
                width: r.width,
                height: r.height,
            };
        }

        clearGestureTimers();
        isTactilePressed = true;
        isHoldingGesture = true;

        // Stage 2 (280ms): Foreground Platter Lift & Quick Actions
        quickActionTimer = setTimeout(() => {
            quickActionTimer = null;
            isTactilePressed = false;
            if (!dashboard.isEditMode && outerEl) {
                dashboard.openContextMenu(node, e, outerEl, inDock);
            }
        }, 280);

        // Stage 3 (680ms): Seamless Promotion into Jiggle Mode
        jigglePromoteTimer = setTimeout(() => {
            promoteHoldGesture();
        }, 680);
    }

    function handlePointerMove(e: PointerEvent) {
        if (!isHoldingGesture) return;
        const dist = Math.hypot(
            e.clientX - pointerStartPos.x,
            e.clientY - pointerStartPos.y,
        );

        // Moved > 8px before Stage 2 (280ms): user is swiping the page, cancel hold
        if (quickActionTimer && dist > 8) {
            clearGestureTimers();
            return;
        }

        // Moved > 10px during Stage 2 (while Platter Lift is open): promote immediately!
        if (!quickActionTimer && dist > 10) {
            promoteHoldGesture();
        }
    }

    function handleResizePointerDown(e: PointerEvent) {
        e.stopPropagation();
        e.preventDefault();
        if (!outerEl) return;

        const startX = e.clientX;
        const startY = e.clientY;
        const startW = node.width || 1;
        const startH = node.height || 1;
        let draggedDistance = 0;

        dashboard.startResize(node.id);

        const onMove = (moveEvent: PointerEvent) => {
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;
            draggedDistance = Math.hypot(dx, dy);

            if (draggedDistance > 6) {
                const rawCols = Math.max(1, Math.round(startW + dx / 96));
                const rawRows = Math.max(1, Math.round(startH + dy / 116));
                dashboard.updateResizePreview(node.id, rawCols, rawRows);
            }
        };

        const onUp = async () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);

            if (draggedDistance <= 6) {
                dashboard.clearDragPreview();
                dashboard.resizingNodeId = null;
                await dashboard.cycleNodeSizePreset(node);
            } else {
                await dashboard.finishResize();
            }
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    bind:this={outerEl}
    {@attach droppable.attach}
    oncontextmenu={(e) => {
        e.stopPropagation();
        dashboard.openContextMenu(node, e, outerEl, inDock);
    }}
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={clearGestureTimers}
    onpointercancel={clearGestureTimers}
    style={gridStyle}
    class="relative ios-flip-scene {inDock
        ? 'size-14 shrink-0'
        : 'w-full h-full'} {isRootGridNode
        ? 'col-[span_var(--col-span-sm)/span_var(--col-span-sm)] md:col-[span_var(--col-span-md)/span_var(--col-span-md)] row-[span_var(--row-span)/span_var(--row-span)] lg:col-[var(--col-start)/span_var(--col-span)] lg:row-[var(--row-start)/span_var(--row-span)]'
        : ''} {isResizing ||
    isFlipped ||
    draggable.isDragging ||
    isDirectDragTarget
        ? 'z-40'
        : 'z-10'} {isContextTarget ? 'opacity-0 pointer-events-none' : ''}"
>
    <div
        {@attach draggable.attach}
        style={directDragStyle}
        class="relative w-full h-full {dashboard.isEditMode && !isFlipped
            ? 'cursor-grab active:cursor-grabbing'
            : ''} {draggable.isDragging || isDirectDragTarget
            ? 'pointer-events-none opacity-92 scale-[1.05] z-50 drop-shadow-[0_26px_48px_rgba(0,0,0,0.68)]'
            : ''} {isTactilePressed ? 'ios-tactile-press' : ''}"
    >
        <!-- Inner Jiggle Layer -->
        <div
            style={dashboard.isEditMode &&
            !draggable.isDragging &&
            !isDirectDragTarget &&
            !isResizing &&
            !isFlipped
                ? jiggleTiming
                : ""}
            class="relative w-full h-full {dashboard.isEditMode &&
            !draggable.isDragging &&
            !isDirectDragTarget &&
            !isResizing &&
            !isFlipped
                ? effectiveRect.w === 1 && effectiveRect.h === 1
                    ? 'ios-jiggle-icon'
                    : 'ios-jiggle-widget'
                : ''}"
        >
            {#if dashboard.isEditMode && !isFlipped}
                <button
                    type="button"
                    onpointerdown={(e) => e.stopPropagation()}
                    onclick={(e) => dashboard.deleteNode(node.id, e)}
                    title="Remove {node.title}"
                    class="absolute -top-2 -left-2 z-30 size-5.5 rounded-full bg-white/90 text-black/80 hover:bg-destructive hover:text-white shadow-[0_2px_10px_rgba(0,0,0,0.5)] backdrop-blur-md flex items-center justify-center hover:scale-110 active:scale-95 transition-all cursor-pointer"
                >
                    <X class="size-3 stroke-[2.75]" />
                </button>

                {#if !inDock}
                    <button
                        type="button"
                        onpointerdown={(e) => e.stopPropagation()}
                        onclick={(e) => dashboard.inspectNode(node, e)}
                        title="Configure {node.title}"
                        class="absolute -top-2 -right-2 z-30 size-5.5 rounded-full ios-glass-pill text-white/90 hover:text-white hover:bg-primary shadow-[0_2px_10px_rgba(0,0,0,0.5)] flex items-center justify-center hover:scale-110 active:scale-95 transition-all cursor-pointer"
                    >
                        <SlidersHorizontal class="size-2.5 stroke-[2.5]" />
                    </button>
                {/if}

                {#if canResizeWidget}
                    <button
                        type="button"
                        onpointerdown={handleResizePointerDown}
                        title="Drag to resize or click to cycle size ({effectiveRect.w}×{effectiveRect.h})"
                        aria-label="Resize {node.title}"
                        class="group/resize absolute -bottom-1.5 -right-1.5 z-30 size-7 flex items-end justify-end p-0.5 cursor-nwse-resize select-none touch-none"
                    >
                        {#if isResizing}
                            <span
                                class="absolute -top-6 right-0 px-2 py-0.5 rounded-full bg-primary text-white text-[10px] font-bold ios-tabular-nums shadow-lg whitespace-nowrap"
                            >
                                {effectiveRect.w}×{effectiveRect.h}
                            </span>
                        {/if}
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            class="size-5 text-white/85 group-hover/resize:text-white group-hover/resize:scale-110 drop-shadow-[0_2px_4px_rgba(0,0,0,0.75)] transition-transform"
                        >
                            <path
                                d="M 7 20 L 14 20 C 17.3137 20 20 17.3137 20 14 L 20 7"
                                stroke="currentColor"
                                stroke-width="3.2"
                                stroke-linecap="round"
                            />
                        </svg>
                    </button>
                {/if}
            {/if}

            <div class="ios-flip-card {isFlipped ? 'is-flipped' : ''}">
                <div class="ios-flip-face">
                    {@render children?.()}
                </div>

                {#if isFlipped}
                    <div class="ios-flip-face ios-flip-face-back">
                        <WidgetBackface {node} />
                    </div>
                {/if}
            </div>
        </div>
    </div>
</div>
