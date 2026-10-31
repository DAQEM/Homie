<script lang="ts">
    import { DragDropProvider } from "@dnd-kit/svelte";
    import { dashboard } from "../state/dashboard.svelte";
    import SortableNode from "./SortableNode.svelte";
    import ActionTile from "./ActionTile.svelte";

    let folder = $derived(dashboard.openFolder);
    let children = $derived(folder ? dashboard.getChildren(folder.id) : []);

    function handleBackdropClick(e: MouseEvent) {
        if (e.target === e.currentTarget) {
            dashboard.openFolderId = null;
        }
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            dashboard.openFolderId = null;
        }
    }
</script>

{#if folder}
    <div
        role="dialog"
        aria-modal="true"
        aria-label={folder.title}
        tabindex="-1"
        onclick={handleBackdropClick}
        onkeydown={handleKeydown}
        class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
    >
        <div class="max-w-lg w-full bg-white text-black border p-4 space-y-4">
            <div class="flex items-center justify-between border-b pb-2">
                <h2 class="text-base font-bold">{folder.title}</h2>

                <div class="flex items-center gap-2">
                    <button
                        type="button"
                        onclick={() => dashboard.openCreateNodeModal(folder.id)}
                        class="border px-2 py-1 text-xs"
                    >
                        + Add Item
                    </button>
                    <button
                        type="button"
                        onclick={() => (dashboard.openFolderId = null)}
                        class="border px-2 py-1 text-xs"
                    >
                        Close
                    </button>
                </div>
            </div>

            <DragDropProvider onDragEnd={dashboard.handleDragEnd}>
                <div class="grid grid-cols-4 gap-2">
                    {#each children as child (child.id)}
                        <SortableNode
                            node={child}
                            inContainer={true}
                            inModal={true}
                            showResizeBadge={false}
                        >
                            <ActionTile node={child} />
                        </SortableNode>
                    {/each}
                </div>
            </DragDropProvider>
        </div>
    </div>
{/if}
