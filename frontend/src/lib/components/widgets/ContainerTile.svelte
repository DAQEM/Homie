<script lang="ts">
    import { Plus } from "@lucide/svelte";
    import { dashboard } from "../../state/dashboard.svelte";
    import {
        getNodeBrandGradient,
        getNodeIconSrc,
        type DashboardNode,
    } from "../../types";
    import SortableNode from "../SortableNode.svelte";
    import ActionTile from "./ActionTile.svelte";

    interface Props {
        node: DashboardNode;
        inDock?: boolean;
        staticPreview?: boolean;
    }

    let { node, inDock = false, staticPreview = false }: Props = $props();

    let squircleEl: HTMLDivElement | undefined = $state();

    $effect(() => {
        if (squircleEl && !staticPreview) {
            dashboard.registerFolderAnchor(node.id, squircleEl);
            return () => dashboard.registerFolderAnchor(node.id, null);
        }
    });

    let children = $derived(dashboard.getChildren(node.id));
    let capacity = $derived((node.width || 1) * (node.height || 1));
    let hasOverflow = $derived(children.length > capacity);
    let isMergeTarget = $derived(dashboard.folderMergeTargetId === node.id);
    let isExpandedOpen = $derived(
        !staticPreview &&
            dashboard.openFolderId === node.id &&
            !dashboard.isFolderClosing,
    );

    let directItems = $derived(
        hasOverflow
            ? children.slice(0, capacity - 1)
            : children.slice(0, capacity),
    );

    let overflowItems = $derived(
        hasOverflow ? children.slice(capacity - 1, capacity - 1 + 4) : [],
    );

    function handleOpenFolder(e: MouseEvent | KeyboardEvent) {
        const el = squircleEl ?? (e.currentTarget as HTMLElement | null);
        dashboard.openFolderWithOrigin(node.id, el);
    }
</script>

{#snippet miniCluster(items: DashboardNode[])}
    <div class="grid grid-cols-2 grid-rows-2 gap-1.5 w-full h-full">
        {#each items as item (item.id)}
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
                    <span class="text-[8px] font-bold text-white truncate">
                        {item.title.slice(0, 2)}
                    </span>
                {/if}
            </div>
        {/each}
    </div>
{/snippet}

{#if capacity === 1 || inDock}
    <div
        role="button"
        tabindex="0"
        onclick={handleOpenFolder}
        onkeydown={(e) => e.key === "Enter" && handleOpenFolder(e)}
        class="group relative w-full h-full flex flex-col items-center {inDock
            ? 'justify-center'
            : 'justify-center gap-1.5'} cursor-pointer text-center select-none transition-all duration-200 {isExpandedOpen
            ? 'opacity-0 scale-75'
            : 'opacity-100 scale-100'}"
    >
        {#if inDock}
            <span
                class="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 z-50 px-2.5 py-1 rounded-full ios-glass-pill text-[11px] font-medium text-white whitespace-nowrap opacity-0 group-hover:opacity-100 -translate-y-0.5 group-hover:translate-y-0 transition-all duration-150"
            >
                {node.title}
            </span>
        {/if}

        {#if isMergeTarget}
            <div
                class="pointer-events-none absolute inset-0 -m-1.5 rounded-[22px] bg-primary/25 backdrop-blur-md ring-2 ring-primary scale-105 transition-all duration-200 z-0"
            ></div>
        {/if}

        <div
            bind:this={squircleEl}
            class="relative z-10 {inDock
                ? 'size-14'
                : 'size-[62px]'} shrink-0 ios-squircle-shadow {isMergeTarget
                ? 'scale-105'
                : ''}"
        >
            <div
                class="w-full h-full ios-icon-surface p-2 overflow-hidden relative"
            >
                {@render miniCluster(children.slice(0, 4))}

                <svg
                    aria-hidden="true"
                    viewBox="0 0 100 100"
                    class="pointer-events-none absolute inset-0 w-full h-full z-20"
                >
                    <path
                        d="M 50,1 C 81.5,1 88.5,1 93.8,6.2 C 99,11.5 99,18.5 99,50 C 99,81.5 99,88.5 93.8,93.8 C 88.5,99 81.5,99 50,99 C 18.5,99 11.5,99 6.2,93.8 C 1,88.5 1,81.5 1,50 C 1,18.5 1,11.5 6.2,6.2 C 11.5,1 18.5,1 50,1 Z"
                        fill="none"
                        stroke="url(#ios-g2-rim)"
                        stroke-width="2"
                    />
                </svg>
            </div>
        </div>

        {#if !inDock && dashboard.showIconLabels}
            <span
                class="relative z-10 text-[11.5px] font-medium ios-vibrant-label group-hover:text-white transition-colors truncate max-w-[84px] shrink-0 leading-tight"
            >
                {node.title}
            </span>
        {/if}
    </div>
{:else}
    <div class="relative w-full h-full flex flex-col gap-1.5 overflow-hidden">
        {#if dashboard.isEditMode && !staticPreview}
            <button
                type="button"
                onclick={(e) => {
                    e.stopPropagation();
                    dashboard.openCreateNodeModal(node.id);
                }}
                class="absolute bottom-7 right-3 z-20 inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-2.5 py-0.5 text-[10px] font-semibold shadow-lg hover:scale-105 transition-transform cursor-pointer"
            >
                <Plus class="size-3" />
                Add App
            </button>
        {/if}

        <div
            class="w-full flex-1 min-h-0 ios-widget-surface p-3 overflow-hidden transition-all duration-200 {isMergeTarget
                ? 'ring-2 ring-primary bg-primary/15 scale-[1.02]'
                : ''}"
        >
            <div
                style="grid-template-columns: repeat({node.width}, minmax(0, 1fr)); grid-template-rows: repeat({node.height}, minmax(0, 1fr));"
                class="grid gap-2.5 w-full h-full"
            >
                {#each directItems as child (child.id)}
                    {#if staticPreview}
                        <div class="w-full h-full">
                            <ActionTile node={child} />
                        </div>
                    {:else}
                        <SortableNode
                            node={child}
                            inContainer={true}
                            showResizeBadge={false}
                        >
                            <ActionTile node={child} />
                        </SortableNode>
                    {/if}
                {/each}

                {#if hasOverflow}
                    <button
                        type="button"
                        onclick={handleOpenFolder}
                        title="Open {node.title}"
                        class="group w-full h-full flex flex-col items-center justify-center gap-1.5 cursor-pointer text-center overflow-hidden"
                    >
                        <div
                            bind:this={squircleEl}
                            class="size-[62px] shrink-0 ios-squircle-shadow"
                        >
                            <div
                                class="w-full h-full ios-icon-surface p-2 overflow-hidden"
                            >
                                {@render miniCluster(overflowItems)}
                            </div>
                        </div>
                        {#if dashboard.showIconLabels}
                            <span
                                class="text-[11px] font-medium ios-vibrant-label group-hover:text-white transition-colors truncate max-w-[84px] shrink-0 leading-tight"
                            >
                                More
                            </span>
                        {/if}
                    </button>
                {/if}
            </div>
        </div>

        {#if dashboard.showIconLabels}
            <span
                class="text-[11.5px] font-medium ios-vibrant-label truncate w-full text-center shrink-0 leading-tight"
            >
                {node.title}
            </span>
        {/if}
    </div>
{/if}
