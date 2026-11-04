<script lang="ts">
    import { DragDropProvider } from "@dnd-kit/svelte";
    import { Plus } from "@lucide/svelte";
    import { dashboard } from "../state/dashboard.svelte";
    import SortableNode from "./SortableNode.svelte";
    import ActionTile from "./widgets/ActionTile.svelte";

    let folder = $derived(dashboard.openFolder);
    let children = $derived(folder ? dashboard.getChildren(folder.id) : []);

    let folderBoxEl: HTMLDivElement | undefined = $state();
    let titleDraft = $state("");
    let outsideDragTimer: ReturnType<typeof setTimeout> | null = null;

    $effect(() => {
        if (folder) {
            titleDraft = folder.title;
        }
    });

    // Compute origin translation vector from the clicked folder's center to viewport center
    let morphStyle = $derived.by(() => {
        const origin = dashboard.openFolderOrigin;
        if (!origin || typeof window === "undefined") {
            return "--folder-dx: 0px; --folder-dy: 0px;";
        }
        const dx = Math.round(origin.cx - window.innerWidth / 2);
        const dy = Math.round(origin.cy - window.innerHeight / 2);
        return `--folder-dx: ${dx}px; --folder-dy: ${dy}px;`;
    });

    function clearOutsideDragTimer() {
        if (outsideDragTimer) {
            clearTimeout(outsideDragTimer);
            outsideDragTimer = null;
        }
    }

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

    async function handleTitleCommit() {
        if (!folder) return;
        const trimmed = titleDraft.trim();
        if (!trimmed) {
            titleDraft = folder.title;
            return;
        }
        await dashboard.renameNode(folder.id, trimmed);
    }

    function handleFolderPointerMove(e: PointerEvent) {
        if (
            !dashboard.isEditMode ||
            !dashboard.activeDragNodeId ||
            !folderBoxEl
        ) {
            clearOutsideDragTimer();
            return;
        }

        const rect = folderBoxEl.getBoundingClientRect();
        const isOutside =
            e.clientX < rect.left - 24 ||
            e.clientX > rect.right + 24 ||
            e.clientY < rect.top - 24 ||
            e.clientY > rect.bottom + 24;

        if (!isOutside) {
            clearOutsideDragTimer();
            return;
        }

        if (!outsideDragTimer) {
            outsideDragTimer = setTimeout(async () => {
                outsideDragTimer = null;
                const draggedId = dashboard.activeDragNodeId;
                if (draggedId) {
                    await dashboard.extractNodeFromFolderToGrid(draggedId);
                }
            }, 260);
        }
    }
</script>

{#if folder}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
        role="dialog"
        aria-modal="true"
        aria-label={folder.title}
        tabindex="-1"
        onclick={handleBackdropClick}
        onkeydown={handleKeydown}
        onpointermove={handleFolderPointerMove}
        onpointerup={clearOutsideDragTimer}
        class="fixed inset-0 z-50 bg-black/35 backdrop-blur-xl flex flex-col items-center justify-center p-4 select-none"
    >
        <!-- Origin-Anchored Morphing Folder Container -->
        <div
            style={morphStyle}
            class="w-full max-w-[420px] flex flex-col items-center gap-4 ios-folder-morph"
        >
            <!-- Inline Editable iPadOS Folder Header -->
            <input
                type="text"
                bind:value={titleDraft}
                onblur={handleTitleCommit}
                onkeydown={(e) => {
                    if (e.key === "Enter") {
                        e.currentTarget.blur();
                    }
                }}
                aria-label="Folder Name"
                class="text-2xl font-semibold text-white text-center ios-tight-tracking ios-label-shadow bg-transparent hover:bg-white/8 focus:bg-white/12 rounded-2xl px-4 py-1 outline-none transition-colors w-72"
            />

            <!-- Frosted Glass 4x3 Squircle Platter -->
            <div
                bind:this={folderBoxEl}
                class="w-full ios-modal-surface rounded-[34px] p-6 space-y-4"
            >
                <DragDropProvider
                    onDragStart={dashboard.handleDragStart}
                    onDragEnd={dashboard.handleDragEnd}
                >
                    <div
                        class="grid grid-cols-4 auto-rows-[92px] gap-4 min-h-[196px]"
                    >
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

                        <!-- Add App Shortcut directly inside Folder -->
                        <button
                            type="button"
                            onclick={() =>
                                dashboard.openCreateNodeModal(folder.id)}
                            title="Add Shortcut to {folder.title}"
                            class="group w-full h-full flex flex-col items-center justify-center gap-1.5 opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
                        >
                            <div
                                class="size-[62px] rounded-[16px] border border-dashed border-white/25 group-hover:border-primary bg-white/[0.04] flex items-center justify-center transition-colors"
                            >
                                <Plus
                                    class="size-5 text-white/70 group-hover:text-primary"
                                />
                            </div>
                            <span
                                class="text-[11px] font-medium text-white/75 leading-tight"
                            >
                                Add
                            </span>
                        </button>
                    </div>
                </DragDropProvider>
            </div>
        </div>
    </div>
{/if}
