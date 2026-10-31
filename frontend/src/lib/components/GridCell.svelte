<script lang="ts">
    import { createDroppable } from "@dnd-kit/svelte";
    import { dashboard } from "../state/dashboard.svelte";
    import { Plus } from "@lucide/svelte";

    interface Props {
        x: number;
        y: number;
        occupied?: boolean;
    }

    let { x, y, occupied = false }: Props = $props();

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
    style="grid-column: {x}; grid-row: {y};"
    class="hidden 2xl:block w-full h-full rounded-xl opacity-60 hover:opacity-100 {occupied
        ? 'pointer-events-none invisible'
        : ''} {!occupied && dashboard.isEditMode
        ? 'border border-dashed'
        : ''} {droppable.isDropTarget ? 'border-solid border-2' : ''}"
>
    {#if !occupied && dashboard.isEditMode}
        <button
            type="button"
            onclick={() => dashboard.openCreateNodeModal(null, x, y)}
            class="w-full h-full flex items-center justify-center opacity-60 hover:opacity-100"
        >
            <Plus class="size-4" />
        </button>
    {/if}
</div>
