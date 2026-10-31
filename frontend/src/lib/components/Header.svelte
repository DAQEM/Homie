<script lang="ts">
    import { Check, Filter, ListFilter, LogOut, Plus } from "@lucide/svelte";
    import { dashboard } from "../state/dashboard.svelte";
    import Button from "./ui/Button.svelte";
    import VerticalLine from "./ui/VerticalLine.svelte";
</script>

<header class="flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-4">
        <nav class="flex items-center gap-2">
            {#each dashboard.workspaces as ws (ws.id)}
                <Button
                    variant={dashboard.activeWorkspace?.id === ws.id
                        ? "default"
                        : "ghost"}
                    onclick={() => dashboard.selectWorkspace(ws.id)}
                >
                    {ws.name}
                </Button>
            {/each}

            {#if dashboard.isEditMode}
                {#if dashboard.workspaces}
                    <VerticalLine class="h-6" />
                {/if}
                <Button
                    onclick={() => (dashboard.isWorkspaceModalOpen = true)}
                    variant="secondary"
                    size="icon"
                >
                    <Plus class="size-4" />
                </Button>
            {/if}
        </nav>
    </div>

    <div class="flex items-center gap-2">
        <Button variant="ghost" onclick={() => {}}>
            <LogOut class="size-4" />
            Log out
        </Button>

        <VerticalLine class="h-6" />

        {#if dashboard.isEditMode}
            <Button
                variant="ghost"
                onclick={() => dashboard.openCreateNodeModal(null)}
            >
                <Plus class="size-4" />
                Add Node
            </Button>
            <VerticalLine class="h-6" />
        {/if}

        <Button variant="ghost" onclick={() => dashboard.toggleEditMode()}>
            {#if dashboard.isEditMode}
                <Check class="size-4" />
                Done
            {:else}
                <ListFilter class="size-4" />
                Customize
            {/if}
        </Button>
    </div>
</header>
