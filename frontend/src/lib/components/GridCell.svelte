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
    class="hidden 2xl:block w-full h-full rounded-xl transition-all {occupied
        ? 'pointer-events-none invisible'
        : ''} {!occupied && dashboard.isEditMode
        ? 'border border-dashed border-card-border hover:border-primary/60 bg-card/20 opacity-60 hover:opacity-100'
        : ''} {droppable.isDropTarget
        ? 'border-solid border-2 border-primary bg-primary/10 opacity-100'
        : ''}"
>
    {#if !occupied && dashboard.isEditMode}
        <button
            type="button"
            onclick={() => dashboard.openCreateNodeModal(null, x, y)}
            class="w-full h-full flex items-center justify-center text-foreground/60 hover:text-primary transition-colors cursor-pointer"
        >
            <Plus class="size-4" />
        </button>
    {/if}
</div>
