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

    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let pointerStartPos = { x: 0, y: 0 };

    let isResizing = $derived(dashboard.resizingNodeId === node.id);
    let isFlipped = $derived(dashboard.flippedNodeId === node.id);
    let isContextTarget = $derived(
        dashboard.contextMenu.open && dashboard.contextMenu.nodeId === node.id,
    );

    let isDisabled = $derived(
        !dashboard.isEditMode ||
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

    $effect.pre(() => {
        const _key = `${effectiveRect.x}:${effectiveRect.y}:${effectiveRect.w}:${effectiveRect.h}`;
        if (outerEl && isRootGridNode && !draggable.isDragging) {
            prevRect = outerEl.getBoundingClientRect();
        }
    });

    $effect(() => {
        const currentKey = `${effectiveRect.x}:${effectiveRect.y}:${effectiveRect.w}:${effectiveRect.h}`;
        if (
            outerEl &&
            prevRect &&
            prevGridKey &&
            prevGridKey !== currentKey &&
            isRootGridNode &&
            !draggable.isDragging
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
                        duration: 310,
                        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
                    },
                );
            }
        }
        prevGridKey = currentKey;
    });

    function clearLongPress() {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    }

    function handlePointerDown(e: PointerEvent) {
        if (e.button !== 0 || isFlipped) return;

        // Record which sub-cell of a multi-cell widget was grabbed so drag reflow doesn't jump
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
        clearLongPress();
        longPressTimer = setTimeout(() => {
            longPressTimer = null;
            dashboard.enterEditMode();
        }, 420);
    }

    function handlePointerMove(e: PointerEvent) {
        if (!longPressTimer) return;
        const dist = Math.hypot(
            e.clientX - pointerStartPos.x,
            e.clientY - pointerStartPos.y,
        );
        if (dist > 8) {
            clearLongPress();
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
    oncontextmenu={(e) => dashboard.openContextMenu(node, e)}
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={clearLongPress}
    onpointercancel={clearLongPress}
    style={gridStyle}
    class="relative ios-flip-scene {inDock
        ? 'size-14 shrink-0'
        : 'w-full h-full'} {isRootGridNode
        ? 'col-[span_var(--col-span-sm)/span_var(--col-span-sm)] md:col-[span_var(--col-span-md)/span_var(--col-span-md)] row-[span_var(--row-span)/span_var(--row-span)] lg:col-[var(--col-start)/span_var(--col-span)] lg:row-[var(--row-start)/span_var(--row-span)]'
        : ''} {isResizing ||
    isFlipped ||
    isContextTarget ||
    draggable.isDragging
        ? 'z-40'
        : 'z-10'} {isContextTarget
        ? 'scale-[1.04] transition-transform duration-200'
        : ''}"
>
    <div
        {@attach draggable.attach}
        class="relative w-full h-full {dashboard.isEditMode && !isFlipped
            ? 'cursor-grab active:cursor-grabbing'
            : ''} {draggable.isDragging
            ? 'pointer-events-none opacity-85 scale-[1.05] z-50 drop-shadow-[0_24px_48px_rgba(0,0,0,0.65)]'
            : ''}"
    >
        <!-- Inner Jiggle Layer -->
        <div
            style={dashboard.isEditMode &&
            !draggable.isDragging &&
            !isResizing &&
            !isFlipped
                ? jiggleTiming
                : ""}
            class="relative w-full h-full {dashboard.isEditMode &&
            !draggable.isDragging &&
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
