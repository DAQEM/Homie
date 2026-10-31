<script lang="ts">
    import { dashboard } from "../state/dashboard.svelte";
</script>

<header class="flex flex-wrap items-center justify-between gap-4">
    <div class="dummy size-0"></div>
    <div class="flex items-center gap-4">
        <nav class="flex items-center gap-1">
            {#each dashboard.workspaces as ws (ws.id)}
                <button
                    type="button"
                    onclick={() => dashboard.selectWorkspace(ws.id)}
                    class="border px-3 py-1 text-xs {dashboard.activeWorkspace
                        ?.id === ws.id
                        ? 'font-bold underline'
                        : ''}"
                >
                    {ws.name}
                </button>
            {/each}

            {#if dashboard.isEditMode}
                <button
                    type="button"
                    onclick={() => (dashboard.isWorkspaceModalOpen = true)}
                    title="Add Workspace"
                    class="border px-2 py-1 text-xs"
                >
                    +
                </button>
            {/if}
        </nav>
    </div>

    <div class="flex items-center gap-2">
        {#if dashboard.isEditMode}
            <button
                type="button"
                onclick={() => dashboard.openCreateNodeModal(null)}
                class="border px-3 py-1 text-xs"
            >
                + Add Node
            </button>
        {/if}

        <button
            type="button"
            onclick={() => dashboard.toggleEditMode()}
            class="border px-3 py-1 text-xs"
        >
            {dashboard.isEditMode ? "Done" : "Edit"}
        </button>
    </div>
</header>
