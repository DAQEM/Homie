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
    }

    let { node, inDock = false }: Props = $props();

    let children = $derived(dashboard.getChildren(node.id));
    let capacity = $derived((node.width || 1) * (node.height || 1));
    let hasOverflow = $derived(children.length > capacity);
    let isMergeTarget = $derived(dashboard.folderMergeTargetId === node.id);

    let directItems = $derived(
        hasOverflow
            ? children.slice(0, capacity - 1)
            : children.slice(0, capacity),
    );

    let overflowItems = $derived(
        hasOverflow ? children.slice(capacity - 1, capacity - 1 + 4) : [],
    );

    function handleOpenFolder(e: MouseEvent | KeyboardEvent) {
        const el = e.currentTarget as HTMLElement | null;
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
            : 'justify-center gap-1.5'} cursor-pointer text-center select-none"
    >
        {#if inDock}
            <span
                class="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 z-50 px-2.5 py-1 rounded-full ios-glass-pill text-[11px] font-medium text-white whitespace-nowrap opacity-0 group-hover:opacity-100 -translate-y-0.5 group-hover:translate-y-0 transition-all duration-150"
            >
                {node.title}
            </span>
        {/if}

        <div
            class="{inDock
                ? 'size-14 rounded-[15px]'
                : 'size-[62px] rounded-[16px]'} shrink-0 ios-icon-surface p-2 overflow-hidden transition-transform {isMergeTarget
                ? 'scale-110 ring-2 ring-white/80'
                : ''}"
        >
            {@render miniCluster(children.slice(0, 4))}
        </div>

        {#if !inDock}
            <span
                class="text-[11.5px] font-medium text-white/92 group-hover:text-white transition-colors truncate max-w-[84px] shrink-0 leading-tight ios-label-shadow"
            >
                {node.title}
            </span>
        {/if}
    </div>
{:else}
    <div class="relative w-full h-full flex flex-col gap-1.5 overflow-hidden">
        {#if dashboard.isEditMode}
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
            class="w-full flex-1 min-h-0 ios-widget-surface p-3 overflow-hidden transition-transform {isMergeTarget
                ? 'ring-2 ring-white/80 scale-[1.02]'
                : ''}"
        >
            <div
                style="grid-template-columns: repeat({node.width}, minmax(0, 1fr)); grid-template-rows: repeat({node.height}, minmax(0, 1fr));"
                class="grid gap-2.5 w-full h-full"
            >
                {#each directItems as child (child.id)}
                    <SortableNode
                        node={child}
                        inContainer={true}
                        showResizeBadge={false}
                    >
                        <ActionTile node={child} />
                    </SortableNode>
                {/each}

                {#if hasOverflow}
                    <button
                        type="button"
                        onclick={handleOpenFolder}
                        title="Open {node.title}"
                        class="group w-full h-full flex flex-col items-center justify-center gap-1.5 cursor-pointer text-center overflow-hidden"
                    >
                        <div
                            class="size-[62px] rounded-[16px] shrink-0 ios-icon-surface p-2 overflow-hidden"
                        >
                            {@render miniCluster(overflowItems)}
                        </div>
                        <span
                            class="text-[11px] font-medium text-white/85 group-hover:text-white transition-colors truncate max-w-[84px] shrink-0 leading-tight ios-label-shadow"
                        >
                            More
                        </span>
                    </button>
                {/if}
            </div>
        </div>

        <span
            class="text-[11.5px] font-medium text-white/90 truncate w-full text-center shrink-0 leading-tight ios-label-shadow"
        >
            {node.title}
        </span>
    </div>
{/if}
