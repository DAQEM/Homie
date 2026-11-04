<script lang="ts">
    import { createDroppable } from "@dnd-kit/svelte";
    import { LayoutGrid, Plus } from "@lucide/svelte";
    import { dashboard } from "../state/dashboard.svelte";
    import {
        getNodeBrandGradient,
        getNodeIconSrc,
        type DashboardNode,
    } from "../types";
    import SortableNode from "./SortableNode.svelte";
    import VerticalLine from "./ui/VerticalLine.svelte";
    import ActionTile from "./widgets/ActionTile.svelte";
    import ContainerTile from "./widgets/ContainerTile.svelte";

    const dockDropzone = createDroppable({
        id: "dock:dropzone",
        get disabled() {
            return (
                !dashboard.isEditMode ||
                dashboard.openFolderId !== null ||
                dashboard.isAppLibraryOpen
            );
        },
    });

    let showFirstDivider = $derived(
        dashboard.dockActionNodes.length > 0 &&
            (dashboard.dockContainerNodes.length > 0 || dashboard.isEditMode),
    );

    let showRecentsSection = $derived(
        !dashboard.isEditMode && dashboard.recentDockNodes.length > 0,
    );

    let showLibraryDivider = $derived(
        dashboard.dockActionNodes.length > 0 ||
            dashboard.dockContainerNodes.length > 0 ||
            dashboard.isEditMode ||
            showRecentsSection,
    );

    let appLibraryPreviewNodes = $derived.by<DashboardNode[]>(() => {
        const flat: DashboardNode[] = [];
        for (const cat of dashboard.appLibraryCategories) {
            for (const n of cat.nodes) {
                flat.push(n);
                if (flat.length >= 4) return flat;
            }
        }
        return flat;
    });

    function handleAppLibraryClick(e: MouseEvent) {
        const btn = e.currentTarget as HTMLElement | null;
        dashboard.openAppLibrary(btn);
    }
</script>

<div
    class="fixed bottom-3.5 left-0 right-0 z-40 flex justify-center px-4 pointer-events-none select-none"
>
    <nav
        {@attach dockDropzone.attach}
        aria-label="Global Dock"
        class="pointer-events-auto max-w-full ios-glass-dock px-3.5 py-2.5 flex items-center gap-3 transition-all duration-200 {dockDropzone.isDropTarget
            ? 'ring-2 ring-primary/80 scale-[1.02]'
            : ''}"
    >
        <!-- Zone 1: Globally Pinned Action Apps -->
        {#each dashboard.dockActionNodes as node (node.id)}
            <SortableNode {node} inDock={true} showResizeBadge={false}>
                <ActionTile {node} inDock={true} />
            </SortableNode>
        {/each}

        {#if showFirstDivider}
            <VerticalLine class="h-10 mx-0.5 bg-white/18" />
        {/if}

        <!-- Zone 2: Globally Pinned Folders / Containers & Edit Mode Add Button -->
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
                class="group relative size-14 shrink-0 rounded-[15px] border border-dashed border-white/25 hover:border-primary/80 bg-white/[0.04] hover:bg-white/[0.1] flex items-center justify-center transition-all active:scale-95 cursor-pointer"
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

        <!-- Zone 3: Automatic iPadOS Recent Apps Pod -->
        {#if showRecentsSection}
            <VerticalLine class="h-10 mx-0.5 bg-white/18" />
            {#each dashboard.recentDockNodes as recentNode (recentNode.id)}
                <div class="relative size-14 shrink-0">
                    <ActionTile node={recentNode} inDock={true} />
                </div>
            {/each}
        {/if}

        <!-- Zone 4: Iconic iPadOS App Library Pod -->
        {#if showLibraryDivider}
            <VerticalLine class="h-10 mx-0.5 bg-white/18" />
        {/if}

        <button
            type="button"
            onclick={handleAppLibraryClick}
            title="App Library"
            aria-label="Open App Library"
            class="group relative size-14 shrink-0 flex items-center justify-center cursor-pointer"
        >
            <span
                class="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 z-50 px-2.5 py-1 rounded-full ios-glass-pill text-[11px] font-medium text-white whitespace-nowrap opacity-0 group-hover:opacity-100 -translate-y-0.5 group-hover:translate-y-0 transition-all duration-150"
            >
                App Library
            </span>

            <div
                class="size-14 rounded-[15px] ios-icon-surface p-2 overflow-hidden flex items-center justify-center {dashboard.isAppLibraryOpen
                    ? 'ring-2 ring-primary scale-95'
                    : ''}"
            >
                {#if appLibraryPreviewNodes.length > 0}
                    <div
                        class="grid grid-cols-2 grid-rows-2 gap-1.5 w-full h-full"
                    >
                        {#each appLibraryPreviewNodes as item (item.id)}
                            {@const src = getNodeIconSrc(item)}
                            {@const grad = getNodeBrandGradient(item)}
                            <div
                                style="background: {grad};"
                                class="rounded-[5px] shadow-[inset_0_0.5px_0_0_rgba(255,255,255,0.25)] flex items-center justify-center p-0.5 overflow-hidden"
                            >
                                {#if src}
                                    <img
                                        {src}
                                        alt={item.title}
                                        class="w-3.5 h-3.5 object-contain drop-shadow-xs"
                                    />
                                {:else}
                                    <span
                                        class="text-[7px] font-bold text-white uppercase leading-none"
                                    >
                                        {item.title.slice(0, 2)}
                                    </span>
                                {/if}
                            </div>
                        {/each}
                    </div>
                {:else}
                    <LayoutGrid class="size-6 text-white/80" />
                {/if}
            </div>
        </button>
    </nav>
</div>
