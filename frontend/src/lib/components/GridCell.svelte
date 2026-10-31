<script lang="ts">
    import { createDroppable } from "@dnd-kit/svelte";
    import {
        BLOCK_COLS,
        BLOCK_ROWS,
        dashboard,
    } from "../state/dashboard.svelte";

    interface Props {
        x: number;
        y: number;
        occupied?: boolean;
    }

    let { x, y, occupied = false }: Props = $props();

    let localCol = $derived(((x - 1) % BLOCK_COLS) + 1);
    let localRow = $derived(((y - 1) % BLOCK_ROWS) + 1);

    const droppable = createDroppable({
        get id() {
            return `cell:${x}:${y}`;
        },
        get disabled() {
            return (
                occupied ||
                !dashboard.isEditMode ||
                dashboard.openFolderId !== null
            );
        },
    });
</script>

<div
    {@attach droppable.attach}
    style="grid-column: {localCol}; grid-row: {localRow};"
    class="aspect-square w-full h-full {occupied
        ? 'pointer-events-none invisible'
        : ''} {!occupied && dashboard.isEditMode
        ? 'border border-dashed'
        : ''} {droppable.isDropTarget ? 'border-solid border-2' : ''}"
>
    {#if !occupied && dashboard.isEditMode}
        <button
            type="button"
            onclick={() => dashboard.openCreateNodeModal(null, x, y)}
            class="w-full h-full flex items-center justify-center text-xs opacity-40 hover:opacity-100"
            title="Add node at ({x}, {y})"
        >
            +
        </button>
    {/if}
</div>
