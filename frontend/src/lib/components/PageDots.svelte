<script lang="ts">
    import { Plus, X } from "@lucide/svelte";
    import { dashboard } from "../state/dashboard.svelte";

    let isHovered = $state(false);
    let showLabels = $derived(isHovered || dashboard.isEditMode);
</script>

{#if dashboard.workspaces.length > 0}
    <div
        class="fixed bottom-[92px] left-0 right-0 z-40 flex justify-center px-4 pointer-events-none select-none"
    >
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            onmouseenter={() => (isHovered = true)}
            onmouseleave={() => (isHovered = false)}
            aria-label="Home Screen Pages"
            class="pointer-events-auto ios-glass-pill rounded-full px-2.5 py-1.5 flex items-center gap-1.5 transition-all duration-200"
        >
            {#each dashboard.workspaces as ws, idx (ws.id)}
                {@const isActive = dashboard.activeWorkspace?.id === ws.id}
                {@const proximity = Math.max(
                    0,
                    1 - Math.abs(dashboard.pagePosition - idx),
                )}
                <div class="relative flex items-center">
                    <button
                        type="button"
                        onclick={() => dashboard.selectWorkspace(ws.id)}
                        title={ws.name}
                        style={!showLabels
                            ? `width: ${(8 + proximity * 10).toFixed(1)}px; opacity: ${(0.35 + proximity * 0.65).toFixed(2)};`
                            : ""}
                        class="group flex items-center justify-center rounded-full transition-colors duration-150 cursor-pointer {showLabels
                            ? isActive
                                ? 'bg-white text-black px-2.5 py-0.5 text-[11px] font-semibold shadow-sm'
                                : 'text-white/65 hover:text-white hover:bg-white/10 px-2.5 py-0.5 text-[11px] font-medium'
                            : 'h-2 bg-white shadow-[0_0_6px_rgba(255,255,255,0.35)]'}"
                    >
                        {#if showLabels}
                            <span class="truncate max-w-[96px]">{ws.name}</span>
                        {/if}
                    </button>

                    {#if dashboard.isEditMode && dashboard.workspaces.length > 1}
                        <button
                            type="button"
                            onclick={(e) => dashboard.deleteWorkspace(ws.id, e)}
                            title="Delete {ws.name} page"
                            class="-ml-1 -mt-3 z-10 size-3.5 rounded-full bg-white/85 text-black hover:bg-destructive hover:text-white flex items-center justify-center shadow transition-colors cursor-pointer"
                        >
                            <X class="size-2.5 stroke-[2.5]" />
                        </button>
                    {/if}
                </div>
            {/each}

            {#if dashboard.isEditMode}
                <button
                    type="button"
                    onclick={() => (dashboard.isWorkspaceModalOpen = true)}
                    title="New Home Screen Page"
                    class="size-5 rounded-full bg-white/14 hover:bg-primary text-white flex items-center justify-center transition-colors ml-0.5 cursor-pointer"
                >
                    <Plus class="size-3 stroke-[2.5]" />
                </button>
            {/if}
        </div>
    </div>
{/if}
