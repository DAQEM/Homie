<script lang="ts">
    import { ArrowLeft, Search, X } from "@lucide/svelte";
    import { dashboard } from "../state/dashboard.svelte";
    import {
        getNodeBrandGradient,
        getNodeIconSrc,
        type AppLibraryCategory,
        type DashboardNode,
    } from "../types";

    let searchQuery = $state("");
    let expandedCategoryId = $state<string | null>(null);
    let searchInputEl: HTMLInputElement | undefined = $state();

    $effect(() => {
        if (!dashboard.isAppLibraryOpen) {
            searchQuery = "";
            expandedCategoryId = null;
        }
    });

    let morphStyle = $derived.by(() => {
        const origin = dashboard.appLibraryOrigin;
        if (!origin || typeof window === "undefined") {
            return "--folder-dx: 0px; --folder-dy: 180px;";
        }
        const dx = Math.round(origin.cx - window.innerWidth / 2);
        const dy = Math.round(origin.cy - window.innerHeight / 2);
        return `--folder-dx: ${dx}px; --folder-dy: ${dy}px;`;
    });

    let filteredNodes = $derived.by<DashboardNode[]>(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return [];
        return dashboard.nodes.filter(
            (n) =>
                n.node_type === "action" &&
                (n.title.toLowerCase().includes(q) ||
                    (n.url && n.url.toLowerCase().includes(q))),
        );
    });

    let expandedCategory = $derived<AppLibraryCategory | null>(
        dashboard.appLibraryCategories.find(
            (c) => c.id === expandedCategoryId,
        ) ?? null,
    );

    function handleBackdropClick(e: MouseEvent) {
        if (e.target === e.currentTarget) {
            if (expandedCategoryId) {
                expandedCategoryId = null;
            } else {
                dashboard.closeAppLibrary();
            }
        }
    }

    function launchApp(node: DashboardNode) {
        dashboard.recordAppLaunch(node.id);
        if (node.url) {
            window.open(node.url, "_blank", "noopener,noreferrer");
        }
        dashboard.closeAppLibrary();
    }
</script>

{#snippet appIconButton(node: DashboardNode)}
    {@const iconSrc = getNodeIconSrc(node)}
    {@const hasCustomUpload = Boolean(
        node.icon && node.icon.startsWith("data:"),
    )}
    {@const brandGrad = getNodeBrandGradient(node)}
    <button
        type="button"
        onclick={() => launchApp(node)}
        class="group flex flex-col items-center justify-center gap-1.5 text-center select-none cursor-pointer"
    >
        <div
            style={!hasCustomUpload ? `background: ${brandGrad};` : ""}
            class="relative size-[60px] rounded-[16px] ios-icon-surface flex items-center justify-center overflow-hidden"
        >
            <div
                aria-hidden="true"
                class="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/18 to-transparent"
            ></div>
            {#if hasCustomUpload && iconSrc}
                <img
                    src={iconSrc}
                    alt={node.title}
                    class="w-full h-full object-cover"
                />
            {:else if iconSrc}
                <img
                    src={iconSrc}
                    alt={node.title}
                    class="w-8 h-8 object-contain drop-shadow-[0_3px_8px_rgba(0,0,0,0.45)]"
                />
            {:else}
                <span class="text-base font-bold text-white uppercase">
                    {node.title.slice(0, 2)}
                </span>
            {/if}
        </div>
        <span
            class="text-[11px] font-medium text-white/90 group-hover:text-white truncate max-w-[82px] leading-tight ios-label-shadow"
        >
            {node.title}
        </span>
    </button>
{/snippet}

{#if dashboard.isAppLibraryOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
        role="dialog"
        aria-modal="true"
        aria-label="App Library"
        tabindex="-1"
        onclick={handleBackdropClick}
        class="fixed inset-0 z-50 bg-black/40 backdrop-blur-2xl flex flex-col items-center justify-start pt-10 pb-28 px-4 overflow-y-auto select-none"
    >
        <div
            style={morphStyle}
            class="w-full max-w-[860px] flex flex-col items-center gap-6 ios-folder-morph"
        >
            <!-- Top iPadOS App Library Frosted Search Field -->
            <div
                class="w-full max-w-md ios-glass-pill rounded-full px-4 py-2.5 flex items-center gap-2.5"
            >
                <Search class="size-4 text-white/60 shrink-0" />
                <input
                    bind:this={searchInputEl}
                    type="text"
                    bind:value={searchQuery}
                    placeholder="App Library"
                    class="w-full bg-transparent text-sm font-medium text-white placeholder:text-white/45 focus:outline-none"
                />
                {#if searchQuery}
                    <button
                        type="button"
                        onclick={() => {
                            searchQuery = "";
                            searchInputEl?.focus();
                        }}
                        class="size-5 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white/80 cursor-pointer"
                    >
                        <X class="size-3" />
                    </button>
                {/if}
            </div>

            {#if searchQuery.trim() !== ""}
                <!-- Instant Search Results Grid -->
                <div
                    class="w-full ios-modal-surface rounded-[32px] p-6 min-h-[260px]"
                >
                    {#if filteredNodes.length > 0}
                        <div
                            class="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-5"
                        >
                            {#each filteredNodes as node (node.id)}
                                {@render appIconButton(node)}
                            {/each}
                        </div>
                    {:else}
                        <div
                            class="h-48 flex items-center justify-center text-sm text-white/45"
                        >
                            No shortcuts matching "{searchQuery}"
                        </div>
                    {/if}
                </div>
            {:else if expandedCategory}
                <!-- Expanded Single Category Platter -->
                <div class="w-full max-w-[540px] space-y-4">
                    <div class="flex items-center justify-between px-2">
                        <button
                            type="button"
                            onclick={() => (expandedCategoryId = null)}
                            class="ios-glass-pill rounded-full px-3 py-1 text-xs font-semibold text-white/85 hover:text-white flex items-center gap-1.5 cursor-pointer"
                        >
                            <ArrowLeft class="size-3.5" />
                            <span>All Categories</span>
                        </button>
                        <h3
                            class="text-lg font-semibold text-white ios-tight-tracking ios-label-shadow"
                        >
                            {expandedCategory.title}
                        </h3>
                        <div class="w-24"></div>
                    </div>

                    <div class="w-full ios-modal-surface rounded-[34px] p-6">
                        <div class="grid grid-cols-4 gap-5">
                            {#each expandedCategory.nodes as node (node.id)}
                                {@render appIconButton(node)}
                            {/each}
                        </div>
                    </div>
                </div>
            {:else}
                <!-- iPadOS 2x2 Category Pods Grid -->
                <div
                    class="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
                >
                    {#each dashboard.appLibraryCategories as category (category.id)}
                        {@const hasOverflow = category.nodes.length > 4}
                        {@const directNodes = hasOverflow
                            ? category.nodes.slice(0, 3)
                            : category.nodes.slice(0, 4)}
                        {@const overflowNodes = hasOverflow
                            ? category.nodes.slice(3, 7)
                            : []}

                        <div class="flex flex-col items-center gap-2">
                            <div
                                class="w-full aspect-square max-w-[240px] ios-widget-surface rounded-[30px] p-4 grid grid-cols-2 grid-rows-2 gap-3"
                            >
                                {#each directNodes as node (node.id)}
                                    {@render appIconButton(node)}
                                {/each}

                                {#if hasOverflow}
                                    <!-- 4th Slot: 2x2 Mini-Cluster that expands the full category -->
                                    <button
                                        type="button"
                                        onclick={() =>
                                            (expandedCategoryId = category.id)}
                                        title="Expand {category.title}"
                                        class="group flex flex-col items-center justify-center gap-1.5 cursor-pointer"
                                    >
                                        <div
                                            class="size-[60px] rounded-[16px] ios-icon-surface p-2 grid grid-cols-2 grid-rows-2 gap-1.5"
                                        >
                                            {#each overflowNodes as sub (sub.id)}
                                                {@const subSrc =
                                                    getNodeIconSrc(sub)}
                                                {@const subGrad =
                                                    getNodeBrandGradient(sub)}
                                                <div
                                                    style="background: {subGrad};"
                                                    class="rounded-[4px] flex items-center justify-center p-0.5 overflow-hidden"
                                                >
                                                    {#if subSrc}
                                                        <img
                                                            src={subSrc}
                                                            alt={sub.title}
                                                            class="w-3.5 h-3.5 object-contain"
                                                        />
                                                    {:else}
                                                        <span
                                                            class="text-[7px] font-bold text-white uppercase"
                                                        >
                                                            {sub.title.slice(
                                                                0,
                                                                2,
                                                            )}
                                                        </span>
                                                    {/if}
                                                </div>
                                            {/each}
                                        </div>
                                        <span
                                            class="text-[11px] font-medium text-white/75 group-hover:text-white leading-tight ios-label-shadow"
                                        >
                                            +{category.nodes.length - 3} more
                                        </span>
                                    </button>
                                {/if}
                            </div>

                            <span
                                class="text-xs font-semibold text-white/90 ios-tight-tracking ios-label-shadow"
                            >
                                {category.title}
                            </span>
                        </div>
                    {/each}
                </div>
            {/if}
        </div>
    </div>
{/if}
