<script lang="ts">
    import { createDroppable } from "@dnd-kit/svelte";
    import { dashboard } from "../state/dashboard.svelte";
    import SortableNode from "./SortableNode.svelte";
    import ActionTile from "./widgets/ActionTile.svelte";
    import ContainerTile from "./widgets/ContainerTile.svelte";
    import { Plus } from "@lucide/svelte";

    const dockDropzone = createDroppable({
        id: "dock:dropzone",
        get disabled() {
            return !dashboard.isEditMode || dashboard.openFolderId !== null;
        },
    });
</script>

<div
    class="fixed bottom-3 left-0 right-0 z-40 flex justify-center px-4 pointer-events-none"
>
    {#if dashboard.dockNodes.length > 0 || dashboard.isEditMode}
        <nav
            {@attach dockDropzone.attach}
            aria-label="Dock"
            class="pointer-events-auto max-w-full overflow-x-auto bg-card/85 backdrop-blur-md border-[1.2px] border-card-border shadow-2xl rounded-2xl px-3 py-2.5 flex items-center gap-3 transition-colors {dockDropzone.isDropTarget
                ? 'border-primary ring-2 ring-primary/30'
                : ''}"
        >
            {#each dashboard.dockNodes as node (node.id)}
                <SortableNode {node} inDock={true} showResizeBadge={false}>
                    {#if node.node_type === "action"}
                        <ActionTile {node} />
                    {:else if node.node_type === "container"}
                        <ContainerTile {node} />
                    {/if}
                </SortableNode>
            {/each}

            {#if dashboard.isEditMode}
                <button
                    type="button"
                    onclick={() => dashboard.openCreateNodeModal(null, -1, -1)}
                    title="Add node to Dock"
                    class="group w-20 h-[100px] shrink-0 flex flex-col items-center gap-1.5 opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
                >
                    <div
                        class="w-full flex-1 border border-dashed border-card-border group-hover:border-primary rounded-xl flex items-center justify-center transition-colors"
                    >
                        <Plus
                            class="size-4 text-foreground/80 group-hover:text-primary"
                        />
                    </div>
                    <span
                        class="text-xs text-foreground/70 truncate w-full text-center leading-tight"
                    >
                        Add
                    </span>
                </button>
            {/if}
        </nav>
    {/if}
</div>
