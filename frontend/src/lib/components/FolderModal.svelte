<script lang="ts">
    import { DragDropProvider } from "@dnd-kit/svelte";
    import { Folder, Plus, X } from "@lucide/svelte";
    import { dashboard } from "../state/dashboard.svelte";
    import SortableNode from "./SortableNode.svelte";
    import Button from "./ui/Button.svelte";
    import ActionTile from "./widgets/ActionTile.svelte";

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
        class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
    >
        <div
            class="max-w-lg w-full bg-card text-card-foreground border-[1.2px] border-card-border rounded-2xl shadow-2xl p-5 space-y-4"
        >
            <div
                class="flex items-center justify-between border-b border-card-border pb-3"
            >
                <div class="flex items-center gap-2 min-w-0">
                    <Folder class="size-5 text-primary shrink-0" />
                    <h2 class="text-base font-bold truncate">{folder.title}</h2>
                </div>

                <div class="flex items-center gap-2">
                    <Button
                        variant="secondary"
                        size="sm"
                        onclick={() => dashboard.openCreateNodeModal(folder.id)}
                    >
                        <Plus class="size-3.5" />
                        Add Item
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        onclick={() => (dashboard.openFolderId = null)}
                    >
                        <X class="size-4" />
                    </Button>
                </div>
            </div>

            <DragDropProvider onDragEnd={dashboard.handleDragEnd}>
                {#if children.length > 0}
                    <div class="grid grid-cols-4 auto-rows-[100px] gap-4">
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
                {:else}
                    <div class="py-10 text-center text-sm text-foreground/40">
                        This folder is empty. Click "Add Item" to add a
                        shortcut.
                    </div>
                {/if}
            </DragDropProvider>
        </div>
    </div>
{/if}
