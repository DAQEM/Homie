<script lang="ts">
    import { createDroppable } from "@dnd-kit/svelte";
    import { Plus } from "@lucide/svelte";
    import { dashboard } from "../state/dashboard.svelte";
    import SortableNode from "./SortableNode.svelte";
    import VerticalLine from "./ui/VerticalLine.svelte";
    import ActionTile from "./widgets/ActionTile.svelte";
    import ContainerTile from "./widgets/ContainerTile.svelte";

    const dockDropzone = createDroppable({
        id: "dock:dropzone",
        get disabled() {
            return !dashboard.isEditMode || dashboard.openFolderId !== null;
        },
    });

    let showDivider = $derived(
        dashboard.dockActionNodes.length > 0 &&
            (dashboard.dockContainerNodes.length > 0 || dashboard.isEditMode),
    );
</script>

<div
    class="fixed bottom-3.5 left-0 right-0 z-40 flex justify-center px-4 pointer-events-none select-none"
>
    {#if dashboard.dockNodes.length > 0 || dashboard.isEditMode}
        <nav
            {@attach dockDropzone.attach}
            aria-label="Dock"
            class="pointer-events-auto max-w-full ios-glass-dock px-3.5 py-2.5 flex items-center gap-3 transition-all duration-200 {dockDropzone.isDropTarget
                ? 'ring-2 ring-primary/80 scale-[1.02]'
                : ''}"
        >
            <!-- Left Zone: Pinned Action Apps -->
            {#each dashboard.dockActionNodes as node (node.id)}
                <SortableNode {node} inDock={true} showResizeBadge={false}>
                    <ActionTile {node} inDock={true} />
                </SortableNode>
            {/each}

            <!-- Iconic iPadOS Dock Vertical Hairline Divider -->
            {#if showDivider}
                <VerticalLine class="h-10 mx-0.5 bg-white/18" />
            {/if}

            <!-- Right Zone: Folders / Containers & Edit Mode Add Button -->
            {#each dashboard.dockContainerNodes as node (node.id)}
                <SortableNode {node} inDock={true} showResizeBadge={false}>
                    <ContainerTile {node} inDock={true} />
                </SortableNode>
            {/each}

            {#if dashboard.isEditMode}
                <button
                    type="button"
                    onclick={() => dashboard.openCreateNodeModal(null, -1, -1)}
                    title="Add to Dock"
                    class="group relative size-14 shrink-0 rounded-[16px] border border-dashed border-white/25 hover:border-primary/80 bg-white/[0.04] hover:bg-white/[0.1] flex items-center justify-center transition-all active:scale-95 cursor-pointer"
                >
                    <Plus
                        class="size-5 text-white/70 group-hover:text-primary transition-colors"
                    />
                    <span
                        class="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full ios-glass-pill text-[11px] font-medium text-white whitespace-nowrap opacity-0 group-hover:opacity-100 -translate-y-0.5 group-hover:translate-y-0 transition-all duration-150"
                    >
                        Add to Dock
                    </span>
                </button>
            {/if}
        </nav>
    {/if}
</div>
