<script lang="ts">
    import {
        ArrowRightLeft,
        Copy,
        LayoutGrid,
        SlidersHorizontal,
        Trash2,
    } from "@lucide/svelte";
    import { dashboard, WIDGET_SIZE_PRESETS } from "../state/dashboard.svelte";

    let node = $derived(dashboard.contextMenuNode);
    let sizePresets = $derived(
        node && !node.parent_id && node.grid_x > 0
            ? (WIDGET_SIZE_PRESETS[node.node_type] ?? [])
            : [],
    );
    let otherWorkspaces = $derived(
        dashboard.workspaces.filter((w) => w.id !== node?.workspace_id),
    );
</script>

{#if dashboard.contextMenu.open && node}
    <!-- Transparent click-catcher backdrop -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        onclick={() => dashboard.closeContextMenu()}
        oncontextmenu={(e) => {
            e.preventDefault();
            dashboard.closeContextMenu();
        }}
        class="fixed inset-0 z-50"
    >
        <!-- iPadOS Translucent Context Menu Platter -->
        <div
            style="left: {dashboard.contextMenu.x}px; top: {dashboard
                .contextMenu.y}px;"
            onclick={(e) => e.stopPropagation()}
            class="fixed w-56 ios-modal-surface rounded-[18px] p-1.5 text-xs text-white shadow-2xl divide-y divide-white/10 select-none ios-context-menu"
        >
            <!-- Header & Inline S / M / L Size Picker -->
            <div class="px-2.5 py-2 space-y-2">
                <div class="font-semibold text-white/90 truncate text-[11px]">
                    {node.title}
                </div>

                {#if sizePresets.length > 1}
                    <div
                        class="flex items-center gap-1 p-0.5 rounded-xl bg-black/30 border border-white/8"
                    >
                        {#each sizePresets as preset (`${preset.w}x${preset.h}`)}
                            {@const isCurrent =
                                (node.width || 1) === preset.w &&
                                (node.height || 1) === preset.h}
                            <button
                                type="button"
                                onclick={() =>
                                    dashboard.setNodeSizePreset(
                                        node,
                                        preset.w,
                                        preset.h,
                                    )}
                                class="flex-1 py-1 rounded-lg text-[10.5px] font-semibold transition-all cursor-pointer {isCurrent
                                    ? 'bg-white text-black shadow-xs'
                                    : 'text-white/65 hover:text-white'}"
                            >
                                {preset.shortLabel}
                            </button>
                        {/each}
                    </div>
                {/if}
            </div>

            <!-- Primary Actions -->
            <div class="py-1 space-y-0.5">
                <button
                    type="button"
                    onclick={(e) => dashboard.inspectNode(node, e)}
                    class="w-full px-2.5 py-1.5 rounded-xl hover:bg-white/12 flex items-center justify-between transition-colors cursor-pointer"
                >
                    <span>
                        {node.node_type === "action"
                            ? "Edit Shortcut"
                            : "Configure Widget"}
                    </span>
                    <SlidersHorizontal class="size-3.5 text-white/65" />
                </button>

                <button
                    type="button"
                    onclick={() => dashboard.duplicateNode(node.id)}
                    class="w-full px-2.5 py-1.5 rounded-xl hover:bg-white/12 flex items-center justify-between transition-colors cursor-pointer"
                >
                    <span>Duplicate</span>
                    <Copy class="size-3.5 text-white/65" />
                </button>

                <button
                    type="button"
                    onclick={() => {
                        dashboard.enterEditMode();
                        dashboard.closeContextMenu();
                    }}
                    class="w-full px-2.5 py-1.5 rounded-xl hover:bg-white/12 flex items-center justify-between transition-colors cursor-pointer"
                >
                    <span>Edit Home Screen</span>
                    <LayoutGrid class="size-3.5 text-white/65" />
                </button>
            </div>

            <!-- Move to Another Workspace Page -->
            {#if otherWorkspaces.length > 0}
                <div class="py-1 space-y-0.5">
                    <div
                        class="px-2.5 py-1 text-[10px] font-semibold text-white/40 uppercase tracking-wider"
                    >
                        Move to Page
                    </div>
                    {#each otherWorkspaces as ws (ws.id)}
                        <button
                            type="button"
                            onclick={() =>
                                dashboard.moveNodeToWorkspace(node.id, ws.id)}
                            class="w-full px-2.5 py-1.5 rounded-xl hover:bg-white/12 flex items-center justify-between transition-colors cursor-pointer"
                        >
                            <span class="truncate">{ws.name}</span>
                            <ArrowRightLeft class="size-3 text-white/50" />
                        </button>
                    {/each}
                </div>
            {/if}

            <!-- Destructive Remove -->
            <div class="pt-1">
                <button
                    type="button"
                    onclick={(e) => dashboard.deleteNode(node.id, e)}
                    class="w-full px-2.5 py-1.5 rounded-xl hover:bg-destructive/20 text-destructive font-medium flex items-center justify-between transition-colors cursor-pointer"
                >
                    <span>
                        {node.node_type === "action"
                            ? "Delete Bookmark"
                            : "Remove Widget"}
                    </span>
                    <Trash2 class="size-3.5" />
                </button>
            </div>
        </div>
    </div>
{/if}
