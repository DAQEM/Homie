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
    class="fixed bottom-2 left-0 right-0 z-40 flex justify-center px-2 pointer-events-none"
>
    {#if dashboard.dockNodes || dashboard.isEditMode}
        <nav
            {@attach dockDropzone.attach}
            aria-label="Dock"
            class="pointer-events-auto max-w-full overflow-x-auto p-2 flex items-center gap-2"
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
                    class="w-20 h-20 shrink-0 aspect-square border border-dashed flex items-center justify-center text-xs rounded-xl opacity-60 hover:opacity-100"
                >
                    <Plus class="size-4" />
                </button>
            {/if}
        </nav>
    {/if}
</div>
