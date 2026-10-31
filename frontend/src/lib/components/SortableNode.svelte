<script lang="ts">
    import type { Snippet } from "svelte";
    import { createDraggable, createDroppable } from "@dnd-kit/svelte";
    import { dashboard } from "../state/dashboard.svelte";
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

    let isRootGridNode = $derived(!inContainer && !inDock);

    let gridStyle = $derived(
        !isRootGridNode
            ? ""
            : `--col-start: ${node.grid_x}; --row-start: ${node.grid_y}; --col-span: ${node.width || 1}; --row-span: ${node.height || 1}; --col-span-sm: ${Math.min(node.width || 1, 4)}; --col-span-md: ${Math.min(node.width || 1, 8)}; --col-span-xl: ${Math.min(node.width || 1, 12)};`,
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
        : 'w-full h-full'} {isRootGridNode
        ? 'col-[span_var(--col-span-sm)/span_var(--col-span-sm)] md:col-[span_var(--col-span-md)/span_var(--col-span-md)] xl:col-[span_var(--col-span-xl)/span_var(--col-span-xl)] row-[span_var(--row-span)/span_var(--row-span)] 2xl:col-[var(--col-start)/span_var(--col-span)] 2xl:row-[var(--row-start)/span_var(--row-span)]'
        : ''}"
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
