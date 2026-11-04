<script lang="ts">
    import { Plus } from "@lucide/svelte";
    import { dashboard } from "../../state/dashboard.svelte";
    import { getNodeIconSrc, type DashboardNode } from "../../types";
    import SortableNode from "../SortableNode.svelte";
    import ActionTile from "./ActionTile.svelte";

    interface Props {
        node: DashboardNode;
    }

    let { node }: Props = $props();

    let children = $derived(dashboard.getChildren(node.id));
    let capacity = $derived((node.width || 1) * (node.height || 1));
    let hasOverflow = $derived(children.length > capacity);

    let directItems = $derived(
        hasOverflow
            ? children.slice(0, capacity - 1)
            : children.slice(0, capacity),
    );

    let overflowItems = $derived(
        hasOverflow ? children.slice(capacity - 1, capacity - 1 + 4) : [],
    );
</script>

{#snippet miniCluster(items: DashboardNode[])}
    <div class="grid grid-cols-2 grid-rows-2 gap-1 w-full h-full">
        {#each items as item (item.id)}
            {@const src = getNodeIconSrc(item)}
            <div
                class="bg-background/80 border border-card-border rounded-md flex items-center justify-center p-0.5 overflow-hidden"
            >
                {#if src}
                    <img
                        {src}
                        alt={item.title}
                        class="w-4 h-4 object-contain"
                    />
                {:else}
                    <span
                        class="text-[9px] font-semibold text-primary truncate"
                    >
                        {item.title.slice(0, 2)}
                    </span>
                {/if}
            </div>
        {/each}
    </div>
{/snippet}

{#if capacity === 1}
    <div
        role="button"
        tabindex="0"
        onclick={() => (dashboard.openFolderId = node.id)}
        onkeydown={(e) =>
            e.key === "Enter" && (dashboard.openFolderId = node.id)}
        class="group w-full h-full flex flex-col items-center gap-1.5 cursor-pointer text-center overflow-hidden select-none"
    >
        <div
            class="w-full flex-1 min-h-0 bg-card text-card-foreground border-[1.2px] border-card-border group-hover:border-primary shadow-md rounded-xl p-2 overflow-hidden transition-colors"
        >
            {@render miniCluster(children.slice(0, 4))}
        </div>
        <span
            class="text-xs text-foreground/80 group-hover:text-foreground transition-colors truncate w-full shrink-0 leading-tight"
        >
            {node.title}
        </span>
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
                class="absolute bottom-6 right-2 z-20 inline-flex items-center gap-1 rounded-full bg-secondary text-secondary-foreground px-2 py-0.5 text-[10px] font-semibold shadow-md hover:scale-105 transition-transform cursor-pointer"
            >
                <Plus class="size-3" />
                Item
            </button>
        {/if}

        <div
            class="w-full flex-1 min-h-0 bg-card/60 text-card-foreground border-[1.2px] border-card-border shadow-md rounded-xl p-2.5 overflow-hidden"
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
                        onclick={() => (dashboard.openFolderId = node.id)}
                        title="Open {node.title}"
                        class="group w-full h-full flex flex-col items-center gap-1.5 cursor-pointer text-center overflow-hidden"
                    >
                        <div
                            class="w-full flex-1 min-h-0 bg-card border-[1.2px] border-card-border group-hover:border-primary shadow-md rounded-xl p-1.5 overflow-hidden transition-colors"
                        >
                            {@render miniCluster(overflowItems)}
                        </div>
                        <span
                            class="text-xs text-foreground/80 group-hover:text-foreground transition-colors truncate w-full shrink-0 leading-tight"
                        >
                            More
                        </span>
                    </button>
                {/if}
            </div>
        </div>

        <span
            class="text-xs text-foreground/80 truncate w-full text-center shrink-0 leading-tight"
        >
            {node.title}
        </span>
    </div>
{/if}
