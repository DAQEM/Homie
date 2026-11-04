<script lang="ts">
    import type { Snippet } from "svelte";
    import { createDraggable, createDroppable } from "@dnd-kit/svelte";
    import { Pencil, X } from "@lucide/svelte";
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
        ? 'w-20 h-[100px] shrink-0'
        : 'w-full h-full'} {isRootGridNode
        ? 'col-[span_var(--col-span-sm)/span_var(--col-span-sm)] md:col-[span_var(--col-span-md)/span_var(--col-span-md)] xl:col-[span_var(--col-span-xl)/span_var(--col-span-xl)] row-[span_var(--row-span)/span_var(--row-span)] 2xl:col-[var(--col-start)/span_var(--col-span)] 2xl:row-[var(--row-start)/span_var(--row-span)]'
        : ''} {droppable.isDropTarget ? 'ring-2 ring-primary rounded-xl' : ''}"
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
                class="absolute -top-1.5 -left-1.5 z-30 size-5 rounded-full bg-destructive text-destructive-foreground shadow-md flex items-center justify-center hover:scale-110 transition-transform cursor-pointer"
            >
                <X class="size-3" />
            </button>

            {#if showResizeBadge && !inDock}
                <button
                    type="button"
                    onclick={(e) => dashboard.openEditNodeModal(node, e)}
                    title="Edit {node.title}"
                    class="absolute -top-1.5 -right-1.5 z-30 px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold shadow-md flex items-center gap-1 hover:scale-105 transition-transform cursor-pointer"
                >
                    <span>{node.width}×{node.height}</span>
                    <Pencil class="size-2.5" />
                </button>
            {/if}
        {/if}

        {@render children?.()}
    </div>
</div>
