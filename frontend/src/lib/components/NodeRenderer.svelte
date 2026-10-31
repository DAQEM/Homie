<script lang="ts">
    import type { DashboardNode } from "../types";
    import ActionTile from "./widgets/ActionTile.svelte";
    import ContainerTile from "./widgets/ContainerTile.svelte";
    import ClockTile from "./widgets/ClockTile.svelte";
    import SearchTile from "./widgets/SearchTile.svelte";
    import TodoTile from "./widgets/TodoTile.svelte";
    import CalendarTile from "./widgets/CalendarTile.svelte";

    interface Props {
        node: DashboardNode;
    }

    let { node }: Props = $props();
</script>

{#if node.node_type === "action"}
    <ActionTile {node} />
{:else if node.node_type === "container"}
    <ContainerTile {node} />
{:else if node.node_type === "clock"}
    <ClockTile {node} />
{:else if node.node_type === "search"}
    <SearchTile {node} />
{:else if node.node_type === "todo"}
    <TodoTile {node} />
{:else if node.node_type === "calendar"}
    <CalendarTile {node} />
{/if}
