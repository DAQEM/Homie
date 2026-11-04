<script lang="ts">
    import { createDroppable } from "@dnd-kit/svelte";
    import { dashboard } from "../state/dashboard.svelte";

    interface Props {
        x: number;
        y: number;
        occupied?: boolean;
    }

    let { x, y }: Props = $props();

    const droppable = createDroppable({
        get id() {
            return `cell:${x}:${y}`;
        },
        get disabled() {
            return !dashboard.isEditMode || dashboard.openFolderId !== null;
        },
    });
</script>

<div
    {@attach droppable.attach}
    style="grid-column: {x}; grid-row: {y};"
    class="hidden lg:block w-full h-full pointer-events-auto select-none"
></div>
