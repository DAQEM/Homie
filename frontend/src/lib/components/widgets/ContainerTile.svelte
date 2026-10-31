<script lang="ts">
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
                class="aspect-square bg-card flex items-center justify-center p-0.5 overflow-hidden"
            >
                {#if src}
                    <img
                        {src}
                        alt={item.title}
                        class="w-4 h-4 object-contain"
                    />
                {:else}
                    <span class="text-[10px] truncate">{item.title}</span>
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
        class="aspect-square w-full h-full bg-card text-card-foreground border border-card-border rounded-xl p-2 flex flex-col justify-between cursor-pointer overflow-hidden"
    >
        <div class="flex-1 min-h-0">
            {@render miniCluster(children.slice(0, 4))}
        </div>
        <span class="text-xs truncate text-center mt-1">{node.title}</span>
    </div>
{:else}
    <div class="w-full h-full border p-2 flex flex-col gap-1 overflow-hidden">
        <div class="flex items-center justify-between">
            <span class="text-xs truncate">{node.title}</span>
            {#if dashboard.isEditMode}
                <button
                    type="button"
                    onclick={(e) => {
                        e.stopPropagation();
                        dashboard.openCreateNodeModal(node.id);
                    }}
                    class="border px-1 text-xs"
                >
                    + Item
                </button>
            {/if}
        </div>

        <div
            style="grid-template-columns: repeat({node.width}, minmax(0, 1fr)); grid-template-rows: repeat({node.height}, minmax(0, 1fr));"
            class="grid gap-1 flex-1 min-h-0"
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
                    class="aspect-square w-full h-full border p-1 cursor-pointer"
                >
                    {@render miniCluster(overflowItems)}
                </button>
            {/if}
        </div>
    </div>
{/if}
