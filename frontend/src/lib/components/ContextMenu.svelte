<script lang="ts">
    import {
        ArrowRightLeft,
        Copy,
        FolderOutput,
        Layers,
        LayoutGrid,
        Pin,
        PinOff,
        SlidersHorizontal,
        Trash2,
        Ungroup,
    } from "@lucide/svelte";
    import { dashboard, WIDGET_SIZE_PRESETS } from "../state/dashboard.svelte";
    import NodeRenderer from "./NodeRenderer.svelte";

    let node = $derived(dashboard.contextMenuNode);
    let anchorRect = $derived(dashboard.contextMenu.anchorRect);
    let stackItems = $derived(node ? dashboard.getStackItems(node) : []);
    let isSmartStack = $derived(stackItems.length > 1);
    let activeStackNode = $derived(
        node
            ? (stackItems[dashboard.getActiveStackIndex(node.id)] ?? node)
            : null,
    );

    let isDocked = $derived(
        Boolean(
            node && !node.parent_id && node.grid_x === -1 && node.grid_y === -1,
        ),
    );
    let isInsideContainer = $derived(Boolean(node && node.parent_id));
    let canDock = $derived(
        Boolean(
            node &&
            (node.node_type === "action" ||
                (node.node_type === "container" &&
                    (node.width || 1) === 1 &&
                    (node.height || 1) === 1)),
        ),
    );
    let sizePresets = $derived(
        node && !node.parent_id && node.grid_x > 0
            ? (WIDGET_SIZE_PRESETS[node.node_type] ?? [])
            : [],
    );
    let otherWorkspaces = $derived(
        node && node.grid_x > 0 && !node.parent_id
            ? dashboard.workspaces.filter((w) => w.id !== node.workspace_id)
            : [],
    );

    let liftScale = $derived(
        node && ((node.width || 1) >= 2 || (node.height || 1) >= 2)
            ? 1.035
            : 1.08,
    );

    function handleLiftedPlatterClick(e: MouseEvent) {
        e.stopPropagation();
        if (!node) return;
        const target = node;
        dashboard.closeContextMenu();
        if (target.node_type === "action" && target.url) {
            dashboard.recordAppLaunch(target.id);
            window.open(target.url, "_blank", "noopener,noreferrer");
        } else if (target.node_type === "container") {
            dashboard.openFolderWithOrigin(target.id);
        }
    }
</script>

{#if dashboard.contextMenu.open && node}
    <!-- Frosted Dimmed Backdrop behind the Lifted Platter & Quick Actions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        onclick={() => dashboard.closeContextMenu()}
        oncontextmenu={(e) => {
            e.preventDefault();
            dashboard.closeContextMenu();
        }}
        class="fixed inset-0 z-50 bg-black/28 backdrop-blur-[3px] transition-opacity duration-200 select-none"
    >
        <!-- Foreground Lifted Target Platter (Static Preview = Safe Outside DragDropProvider) -->
        {#if anchorRect}
            <div
                style="left: {anchorRect.left}px; top: {anchorRect.top}px; width: {anchorRect.width}px; height: {anchorRect.height}px; --lift-scale: {liftScale};"
                onclick={handleLiftedPlatterClick}
                class="fixed z-50 ios-platter-lift cursor-pointer"
            >
                <div class="pointer-events-none w-full h-full">
                    <NodeRenderer
                        {node}
                        inDock={dashboard.contextMenu.inDock}
                        staticPreview={true}
                    />
                </div>
            </div>
        {/if}

        <!-- Quadrant-Aware iPadOS Quick Action Platter -->
        <div
            style="left: {dashboard.contextMenu.x}px; top: {dashboard
                .contextMenu.y}px; --qa-origin: {dashboard.contextMenu
                .transformOrigin};"
            onclick={(e) => e.stopPropagation()}
            class="fixed z-50 w-[236px] ios-modal-surface rounded-[20px] p-1.5 text-xs text-white shadow-2xl divide-y divide-white/10 select-none ios-quick-action-menu"
        >
            <!-- Header & Inline S / M / L Size Segmented Picker -->
            <div class="px-2.5 py-2 space-y-2">
                <div class="flex items-center justify-between gap-2">
                    <span
                        class="font-semibold text-white/92 truncate text-[11.5px]"
                    >
                        {activeStackNode?.title ?? node.title}
                    </span>
                    {#if isSmartStack}
                        <span
                            class="px-1.5 py-0.5 rounded-full bg-primary/25 text-primary text-[9.5px] font-bold shrink-0"
                        >
                            Stack ({stackItems.length})
                        </span>
                    {/if}
                </div>

                {#if sizePresets.length > 1 && !isSmartStack}
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

            <!-- Primary Quick Actions -->
            <div class="py-1 space-y-0.5">
                {#if isSmartStack}
                    <button
                        type="button"
                        onclick={() => {
                            dashboard.cycleSmartStack(node.id, 1);
                        }}
                        class="w-full px-2.5 py-1.5 rounded-xl hover:bg-white/12 flex items-center justify-between transition-colors cursor-pointer"
                    >
                        <span>Next in Smart Stack</span>
                        <Layers class="size-3.5 text-primary" />
                    </button>

                    <button
                        type="button"
                        onclick={() => dashboard.unstackActiveWidget(node.id)}
                        class="w-full px-2.5 py-1.5 rounded-xl hover:bg-white/12 flex items-center justify-between transition-colors cursor-pointer"
                    >
                        <span>Unstack Current Widget</span>
                        <Ungroup class="size-3.5 text-white/65" />
                    </button>
                {/if}

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

                {#if isInsideContainer}
                    <button
                        type="button"
                        onclick={() => {
                            dashboard.closeContextMenu();
                            void dashboard.extractNodeFromFolderToGrid(node.id);
                        }}
                        class="w-full px-2.5 py-1.5 rounded-xl hover:bg-white/12 flex items-center justify-between transition-colors cursor-pointer"
                    >
                        <span>Move to Home Screen</span>
                        <FolderOutput class="size-3.5 text-white/65" />
                    </button>
                {/if}

                {#if canDock}
                    <button
                        type="button"
                        onclick={() => dashboard.togglePinToDock(node.id)}
                        class="w-full px-2.5 py-1.5 rounded-xl hover:bg-white/12 flex items-center justify-between transition-colors cursor-pointer"
                    >
                        <span>
                            {isDocked ? "Move to Home Screen" : "Pin to Dock"}
                        </span>
                        {#if isDocked}
                            <PinOff class="size-3.5 text-white/65" />
                        {:else}
                            <Pin class="size-3.5 text-white/65" />
                        {/if}
                    </button>
                {/if}

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
