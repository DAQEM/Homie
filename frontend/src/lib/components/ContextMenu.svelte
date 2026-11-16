<script lang="ts">
    import {
        Activity,
        ArrowRightLeft,
        Calendar,
        Check,
        Clipboard,
        ClipboardPaste,
        Clock,
        CloudSun,
        Copy,
        Eye,
        EyeOff,
        Folder,
        FolderOutput,
        Layers,
        LayoutGrid,
        ListTodo,
        Pin,
        PinOff,
        Plus,
        RefreshCw,
        Search,
        SlidersHorizontal,
        Sparkles,
        Trash2,
        Ungroup,
    } from "@lucide/svelte";
    import { dashboard, WIDGET_SIZE_PRESETS } from "../state/dashboard.svelte";
    import type { NodeType, WallpaperPreset } from "../types";
    import NodeRenderer from "./NodeRenderer.svelte";

    const WALLPAPER_SWATCHES: {
        id: WallpaperPreset;
        label: string;
        swatch: string;
    }[] = [
        {
            id: "cupertino",
            label: "Cupertino",
            swatch: "linear-gradient(135deg, #0A84FF 0%, #5E5CE6 100%)",
        },
        {
            id: "aurora",
            label: "Aurora",
            swatch: "linear-gradient(135deg, #30D158 0%, #5E5CE6 100%)",
        },
        {
            id: "solar",
            label: "Solar",
            swatch: "linear-gradient(135deg, #FF9F0A 0%, #FF453A 100%)",
        },
        {
            id: "titanium",
            label: "Titanium",
            swatch: "linear-gradient(135deg, #94A3B8 0%, #334155 100%)",
        },
    ];

    const QUICK_WIDGETS: { type: NodeType; label: string }[] = [
        { type: "clock", label: "Clock" },
        { type: "weather", label: "Weather" },
        { type: "todo", label: "Tasks" },
        { type: "calendar", label: "Calendar" },
        { type: "search", label: "Search" },
    ];

    let isCanvasMode = $derived(dashboard.contextMenu.mode === "canvas");
    let targetGridX = $derived(dashboard.contextMenu.gridX);
    let targetGridY = $derived(dashboard.contextMenu.gridY);

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

{#if dashboard.contextMenu.open && isCanvasMode}
    <!-- Empty Grid / Desktop Canvas Context Menu -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        onclick={() => dashboard.closeContextMenu()}
        oncontextmenu={(e) => {
            e.preventDefault();
            dashboard.closeContextMenu();
        }}
        class="fixed inset-0 z-50 bg-transparent select-none"
    >
        <div
            style="left: {dashboard.contextMenu.x}px; top: {dashboard
                .contextMenu.y}px; --qa-origin: {dashboard.contextMenu
                .transformOrigin};"
            onclick={(e) => e.stopPropagation()}
            class="fixed z-50 w-[256px] ios-modal-surface rounded-[20px] p-1.5 text-xs text-white shadow-2xl divide-y divide-white/10 select-none ios-quick-action-menu"
        >
            <!-- Header -->
            <div class="px-2.5 py-1.5 flex items-center justify-between gap-2">
                <span
                    class="font-semibold text-white/90 truncate text-[11.5px]"
                >
                    {dashboard.activeWorkspace?.name ?? "Home Screen"}
                </span>
                {#if targetGridX && targetGridY}
                    <span
                        class="px-1.5 py-0.5 rounded-full bg-white/10 text-[9.5px] font-mono text-white/60 ios-tabular-nums"
                    >
                        {targetGridX},{targetGridY}
                    </span>
                {/if}
            </div>

            <!-- Add / Paste Actions -->
            <div class="py-1 space-y-0.5">
                <button
                    type="button"
                    onclick={() =>
                        dashboard.openCreateNodeModal(
                            null,
                            targetGridX ?? undefined,
                            targetGridY ?? undefined,
                        )}
                    class="w-full px-2.5 py-1.5 rounded-xl hover:bg-primary/25 text-white font-medium flex items-center justify-between transition-colors cursor-pointer"
                >
                    <span>Add Shortcut / Widget…</span>
                    <Plus class="size-3.5 text-primary stroke-[2.5]" />
                </button>

                <button
                    type="button"
                    onclick={() =>
                        void dashboard.quickCreateNode(
                            "container",
                            targetGridX,
                            targetGridY,
                            { w: 1, h: 1 },
                        )}
                    class="w-full px-2.5 py-1.5 rounded-xl hover:bg-white/12 flex items-center justify-between transition-colors cursor-pointer"
                >
                    <span>New App Folder</span>
                    <Folder class="size-3.5 text-[#5E5CE6]" />
                </button>

                {#if dashboard.copiedNode}
                    <button
                        type="button"
                        onclick={() =>
                            void dashboard.pasteCopiedNodeAt(
                                targetGridX,
                                targetGridY,
                            )}
                        class="w-full px-2.5 py-1.5 rounded-xl hover:bg-white/12 flex items-center justify-between gap-2 transition-colors cursor-pointer"
                    >
                        <span class="truncate">
                            Paste "{dashboard.copiedNode.title}"
                        </span>
                        <ClipboardPaste
                            class="size-3.5 text-[#30D158] shrink-0"
                        />
                    </button>
                {/if}

                <!-- 1-Click Quick Widget Strip -->
                <div class="px-1.5 pt-1.5 pb-1 space-y-1">
                    <div
                        class="px-1 text-[9.5px] font-semibold uppercase tracking-wider text-white/40"
                    >
                        Quick Drop Widget
                    </div>
                    <div class="grid grid-cols-5 gap-1">
                        {#each QUICK_WIDGETS as qw (qw.type)}
                            <button
                                type="button"
                                onclick={() =>
                                    void dashboard.quickCreateNode(
                                        qw.type,
                                        targetGridX,
                                        targetGridY,
                                    )}
                                title="Drop {qw.label} Widget"
                                class="py-1.5 rounded-lg bg-white/8 hover:bg-primary text-white/85 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                            >
                                {#if qw.type === "clock"}
                                    <Clock class="size-3.5" />
                                {:else if qw.type === "weather"}
                                    <CloudSun class="size-3.5" />
                                {:else if qw.type === "todo"}
                                    <ListTodo class="size-3.5" />
                                {:else if qw.type === "calendar"}
                                    <Calendar class="size-3.5" />
                                {:else}
                                    <Search class="size-3.5" />
                                {/if}
                            </button>
                        {/each}
                    </div>
                </div>
            </div>

            <!-- Navigation & Tools -->
            <div class="py-1 space-y-0.5">
                <button
                    type="button"
                    onclick={() => {
                        dashboard.closeContextMenu();
                        dashboard.toggleEditMode();
                    }}
                    class="w-full px-2.5 py-1.5 rounded-xl hover:bg-white/12 flex items-center justify-between transition-colors cursor-pointer"
                >
                    <span>
                        {dashboard.isEditMode
                            ? "Done Editing"
                            : "Edit Home Screen"}
                    </span>
                    {#if dashboard.isEditMode}
                        <Check class="size-3.5 text-[#30D158]" />
                    {:else}
                        <Sparkles class="size-3.5 text-primary" />
                    {/if}
                </button>

                <button
                    type="button"
                    onclick={() => dashboard.openSpotlight()}
                    class="w-full px-2.5 py-1.5 rounded-xl hover:bg-white/12 flex items-center justify-between transition-colors cursor-pointer"
                >
                    <span>Spotlight Search</span>
                    <span class="text-[10px] text-white/45 font-mono">⌘K</span>
                </button>

                <button
                    type="button"
                    onclick={() => dashboard.openAppLibrary()}
                    class="w-full px-2.5 py-1.5 rounded-xl hover:bg-white/12 flex items-center justify-between transition-colors cursor-pointer"
                >
                    <span>App Library</span>
                    <LayoutGrid class="size-3.5 text-white/65" />
                </button>

                <button
                    type="button"
                    onclick={() => {
                        dashboard.closeContextMenu();
                        dashboard.isWorkspaceModalOpen = true;
                    }}
                    class="w-full px-2.5 py-1.5 rounded-xl hover:bg-white/12 flex items-center justify-between transition-colors cursor-pointer"
                >
                    <span>New Home Screen Page…</span>
                    <Layers class="size-3.5 text-white/65" />
                </button>

                <button
                    type="button"
                    onclick={() => dashboard.refreshAllWidgets()}
                    class="w-full px-2.5 py-1.5 rounded-xl hover:bg-white/12 flex items-center justify-between transition-colors cursor-pointer"
                >
                    <span>Refresh Widgets & Sync</span>
                    <RefreshCw class="size-3.5 text-white/65" />
                </button>
            </div>

            <!-- Appearance Quick Controls -->
            <div class="pt-1.5 pb-0.5 space-y-1">
                <div
                    class="px-2.5 py-1 flex items-center justify-between gap-2"
                >
                    <span class="text-[11px] text-white/70">Wallpaper</span>
                    <div class="flex items-center gap-1.5">
                        {#each WALLPAPER_SWATCHES as wp (wp.id)}
                            {@const active =
                                dashboard.wallpaperPreset === wp.id}
                            <button
                                type="button"
                                onclick={() =>
                                    dashboard.setWallpaperPreset(wp.id)}
                                title={wp.label}
                                style="background: {wp.swatch};"
                                class="size-4.5 rounded-full border border-white/25 transition-transform cursor-pointer {active
                                    ? 'scale-115 ring-1.5 ring-white'
                                    : 'opacity-75 hover:opacity-100'}"
                            ></button>
                        {/each}
                    </div>
                </div>

                <button
                    type="button"
                    onclick={() => dashboard.toggleIconLabels()}
                    class="w-full px-2.5 py-1.5 rounded-xl hover:bg-white/12 flex items-center justify-between transition-colors cursor-pointer"
                >
                    <span>
                        {dashboard.showIconLabels
                            ? "Hide Icon Labels"
                            : "Show Icon Labels"}
                    </span>
                    {#if dashboard.showIconLabels}
                        <EyeOff class="size-3.5 text-white/65" />
                    {:else}
                        <Eye class="size-3.5 text-white/65" />
                    {/if}
                </button>
            </div>
        </div>
    </div>
{:else if dashboard.contextMenu.open && node}
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
        <!-- Foreground Lifted Target Platter -->
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
                            {@const cur = dashboard.getEffectiveRect(node)}
                            {@const targetW = Math.min(
                                preset.w,
                                dashboard.activeGridCols,
                            )}
                            {@const isCurrent =
                                cur.w === targetW && cur.h === preset.h}
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

                {#if node.node_type === "calendar"}
                    <button
                        type="button"
                        onclick={() => {
                            dashboard.closeContextMenu();
                            void dashboard.syncCalendarNodeNow(node.id);
                        }}
                        class="w-full px-2.5 py-1.5 rounded-xl hover:bg-white/12 flex items-center justify-between transition-colors cursor-pointer"
                    >
                        <span>Sync Calendar Now</span>
                        <RefreshCw class="size-3.5 text-primary" />
                    </button>
                {:else if node.node_type === "todo"}
                    <button
                        type="button"
                        onclick={() => {
                            dashboard.closeContextMenu();
                            void dashboard.vikunja.syncNow(
                                node.settings?.vikunjaIntegrationId,
                            );
                        }}
                        class="w-full px-2.5 py-1.5 rounded-xl hover:bg-white/12 flex items-center justify-between transition-colors cursor-pointer"
                    >
                        <span>Sync Vikunja Now</span>
                        <RefreshCw class="size-3.5 text-primary" />
                    </button>
                {/if}

                {#if node.node_type === "action" && node.url}
                    <button
                        type="button"
                        onclick={() => dashboard.toggleHealthMonitor(node.id)}
                        class="w-full px-2.5 py-1.5 rounded-xl hover:bg-white/12 flex items-center justify-between transition-colors cursor-pointer"
                    >
                        <span>
                            {node.settings?.healthCheck
                                ? "Disable Health Monitor"
                                : "Monitor Service Health"}
                        </span>
                        <Activity
                            class="size-3.5 {node.settings?.healthCheck
                                ? 'text-[#30D158]'
                                : 'text-white/65'}"
                        />
                    </button>
                {/if}

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
                    onclick={() => dashboard.copyNode(node.id)}
                    class="w-full px-2.5 py-1.5 rounded-xl hover:bg-white/12 flex items-center justify-between transition-colors cursor-pointer"
                >
                    <span>Copy</span>
                    <Clipboard class="size-3.5 text-white/65" />
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
