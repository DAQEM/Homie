<script lang="ts">
    import type { DashboardNode } from "../types";
    import ClockTile from "./widgets/ClockTile.svelte";

    interface Props {
        node: DashboardNode;
    }

    let { node }: Props = $props();
</script>

<ClockTile {node} />
