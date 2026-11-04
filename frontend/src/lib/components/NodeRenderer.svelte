<script lang="ts">
    import { dashboard } from "../state/dashboard.svelte";
    import type { DashboardNode } from "../types";
    import ActionTile from "./widgets/ActionTile.svelte";
    import ContainerTile from "./widgets/ContainerTile.svelte";
    import ClockTile from "./widgets/ClockTile.svelte";
    import SearchTile from "./widgets/SearchTile.svelte";
    import TodoTile from "./widgets/TodoTile.svelte";
    import CalendarTile from "./widgets/CalendarTile.svelte";

    interface Props {
        node: DashboardNode;
        inDock?: boolean;
        staticPreview?: boolean;
    }

    let { node, inDock = false, staticPreview = false }: Props = $props();

    let stackItems = $derived(dashboard.getStackItems(node));
    let isSmartStack = $derived(stackItems.length > 1);
    let activeIdx = $derived(dashboard.getActiveStackIndex(node.id));
    let activeNode = $derived(stackItems[activeIdx] ?? node);
    let isStackMergeTarget = $derived(
        dashboard.folderMergeTargetId === node.id &&
            node.node_type !== "action" &&
            node.node_type !== "container",
    );

    let lastWheelFlipAt = 0;
    let slideDirection = $state<"up" | "down">("down");

    function handleStackWheel(e: WheelEvent) {
        if (!isSmartStack || Math.abs(e.deltaY) < 14) return;
        e.preventDefault();
        e.stopPropagation();

        const now = performance.now();
        if (now - lastWheelFlipAt < 280) return;
        lastWheelFlipAt = now;

        slideDirection = e.deltaY > 0 ? "down" : "up";
        dashboard.cycleSmartStack(node.id, e.deltaY > 0 ? 1 : -1);
    }

    function selectStackSlice(idx: number, e: MouseEvent) {
        e.stopPropagation();
        slideDirection = idx > activeIdx ? "down" : "up";
        dashboard.setSmartStackIndex(node.id, idx);
    }
</script>

{#snippet renderSingleWidget(target: DashboardNode)}
    {#if target.node_type === "action"}
        <ActionTile node={target} {inDock} />
    {:else if target.node_type === "container"}
        <ContainerTile node={target} {inDock} {staticPreview} />
    {:else if target.node_type === "clock"}
        <ClockTile node={target} />
    {:else if target.node_type === "search"}
        <SearchTile node={target} />
    {:else if target.node_type === "todo"}
        <TodoTile node={target} />
    {:else if target.node_type === "calendar"}
        <CalendarTile node={target} />
    {/if}
{/snippet}

{#if isSmartStack}
    <div
        onwheel={{ handleEvent: handleStackWheel, passive: false }}
        class="group/stack relative w-full h-full overflow-hidden rounded-[22px] {isStackMergeTarget
            ? 'ring-2 ring-primary scale-[1.03] transition-transform duration-200'
            : ''}"
    >
        {#key activeNode.id}
            <div
                style="animation: {slideDirection === 'down'
                    ? 'ios-stack-slide-down'
                    : 'ios-stack-slide-up'} 280ms cubic-bezier(0.22, 1, 0.36, 1) both;"
                class="w-full h-full"
            >
                {@render renderSingleWidget(activeNode)}
            </div>
        {/key}

        <div
            class="absolute right-1.5 top-1/2 -translate-y-1/2 z-30 flex flex-col items-center gap-1 py-1.5 px-1 rounded-full bg-black/30 backdrop-blur-md opacity-0 group-hover/stack:opacity-100 {dashboard.isEditMode
                ? 'opacity-100'
                : ''} transition-opacity duration-200"
        >
            {#each stackItems as item, idx (item.id)}
                <button
                    type="button"
                    onclick={(e) => selectStackSlice(idx, e)}
                    title={item.title}
                    aria-label="Show {item.title}"
                    class="w-1.5 rounded-full transition-all duration-200 cursor-pointer {idx ===
                    activeIdx
                        ? 'h-3.5 bg-white shadow-[0_0_4px_rgba(255,255,255,0.8)]'
                        : 'h-1.5 bg-white/40 hover:bg-white/75'}"
                ></button>
            {/each}
        </div>
    </div>
{:else}
    <div
        class="relative w-full h-full {isStackMergeTarget
            ? 'ring-2 ring-primary rounded-[22px] scale-[1.03] transition-transform duration-200'
            : ''}"
    >
        {@render renderSingleWidget(node)}
    </div>
{/if}

<style>
    @keyframes -global-ios-stack-slide-down {
        from {
            opacity: 0;
            transform: translate3d(0, 22px, 0) scale(0.96);
        }
        to {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1);
        }
    }
    @keyframes -global-ios-stack-slide-up {
        from {
            opacity: 0;
            transform: translate3d(0, -22px, 0) scale(0.96);
        }
        to {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1);
        }
    }
</style>
