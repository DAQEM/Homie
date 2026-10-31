<script lang="ts">
    import type { Snippet } from "svelte";
    import { createDraggable, createDroppable } from "@dnd-kit/svelte";
    import {
        BLOCK_COLS,
        BLOCK_ROWS,
        dashboard,
    } from "../state/dashboard.svelte";
    import type { DashboardNode } from "../types";

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

    let isDisabled = $derived(
        !dashboard.isEditMode || (!inModal && dashboard.openFolderId !== null),
    );

    let localCol = $derived(((node.grid_x - 1) % BLOCK_COLS) + 1);
    let localRow = $derived(((node.grid_y - 1) % BLOCK_ROWS) + 1);

    let gridStyle = $derived(
        inContainer || inDock
            ? ""
            : `grid-column: ${localCol} / span ${node.width || 1}; grid-row: ${localRow} / span ${node.height || 1};`,
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
</script>

<div
    {@attach droppable.attach}
    style={gridStyle}
    class="relative z-10 {inDock
        ? 'w-20 h-20 shrink-0 aspect-square'
        : 'w-full h-full'} {node.width === 1 && node.height === 1
        ? 'aspect-square'
        : ''} {droppable.isDropTarget ? 'outline-2 outline-dashed' : ''}"
>
    <div
        {@attach draggable.attach}
        class="relative w-full h-full {dashboard.isEditMode
            ? 'cursor-grab active:cursor-grabbing'
            : ''} {draggable.isDragging ? 'opacity-50 z-50' : ''}"
    >
        {#if dashboard.isEditMode}
            <button
                type="button"
                onclick={(e) => dashboard.deleteNode(node.id, e)}
                title="Delete {node.title}"
                class="absolute top-0 left-0 z-30 border px-1 text-xs bg-white text-black"
            >
                x
            </button>

            {#if showResizeBadge && !inDock}
                <button
                    type="button"
                    onclick={(e) => dashboard.openEditNodeModal(node, e)}
                    title="Edit {node.title}"
                    class="absolute top-0 right-0 z-30 border px-1 text-xs bg-white text-black"
                >
                    {node.width}x{node.height} edit
                </button>
            {/if}
        {/if}

        {@render children?.()}
    </div>
</div>
