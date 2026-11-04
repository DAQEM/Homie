<script lang="ts">
    import {
        Activity,
        Eye,
        EyeOff,
        Layers,
        LayoutGrid,
        Palette,
        Plus,
        Search,
        Sparkles,
        Wifi,
    } from "@lucide/svelte";
    import { dashboard } from "../state/dashboard.svelte";
    import type { WallpaperPreset } from "../types";

    const WALLPAPER_OPTIONS: {
        id: WallpaperPreset;
        label: string;
        swatch: string;
    }[] = [
        {
            id: "cupertino",
            label: "Cupertino",
            swatch: "linear-gradient(135deg, #0A84FF 0%, #5E5CE6 55%, #64D2FF 100%)",
        },
        {
            id: "aurora",
            label: "Aurora",
            swatch: "linear-gradient(135deg, #30D158 0%, #0F766E 55%, #5E5CE6 100%)",
        },
        {
            id: "solar",
            label: "Solar",
            swatch: "linear-gradient(135deg, #FF9F0A 0%, #FF453A 55%, #BF5AF2 100%)",
        },
        {
            id: "titanium",
            label: "Titanium",
            swatch: "linear-gradient(135deg, #94A3B8 0%, #475569 55%, #1E293B 100%)",
        },
    ];

    let isLiveSSE = $derived(dashboard.hydrationStatus.includes("Live"));
    let liveUptime = $derived(
        typeof dashboard.signals["system:hello:uptime"] === "string"
            ? (dashboard.signals["system:hello:uptime"] as string)
            : "Online",
    );
    let liveGreeting = $derived(
        typeof dashboard.signals["system:hello:greeting"] === "string"
            ? (dashboard.signals["system:hello:greeting"] as string)
            : "Brotli Snapshot Active",
    );
</script>

{#if dashboard.isControlCenterOpen}
    <!-- Transparent Click-Catcher Backdrop -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        onclick={() => dashboard.closeControlCenter()}
        class="fixed inset-0 z-50 select-none"
    >
        <!-- Top-Right iPadOS Control Center Platter -->
        <div
            style="--qa-origin: top right;"
            onclick={(e) => e.stopPropagation()}
            class="fixed top-11 right-4 z-50 w-[332px] ios-modal-surface rounded-[30px] p-4 space-y-3 text-white shadow-2xl ios-quick-action-menu"
        >
            <!-- Top Row: Connectivity Pod + 2x2 Quick Actions Grid -->
            <div class="grid grid-cols-2 gap-3">
                <!-- Left 1x1 Pod: Go Signal Bus & Hydration Telemetry -->
                <div
                    class="ios-cc-module p-3 flex flex-col justify-between gap-2.5"
                >
                    <div class="flex items-center gap-2.5">
                        <div
                            class="size-8 rounded-full {isLiveSSE
                                ? 'bg-[#30D158]'
                                : 'bg-primary'} text-white flex items-center justify-center shrink-0 shadow-sm"
                        >
                            <Wifi class="size-4" />
                        </div>
                        <div class="min-w-0">
                            <div class="text-xs font-semibold truncate">
                                Signal Bus
                            </div>
                            <div
                                class="text-[10px] text-[#30D158] font-medium ios-tabular-nums truncate"
                            >
                                {liveUptime}
                            </div>
                        </div>
                    </div>

                    <div class="space-y-0.5 pt-1 border-t border-white/8">
                        <div
                            class="flex items-center gap-1 text-[10px] text-white/75 font-medium truncate"
                        >
                            <Activity class="size-3 text-primary shrink-0" />
                            <span class="truncate"
                                >{dashboard.hydrationStatus}</span
                            >
                        </div>
                        <div
                            class="text-[9.5px] text-white/45 truncate ios-tabular-nums"
                        >
                            {liveGreeting}
                        </div>
                    </div>
                </div>

                <!-- Right 2x2 Circular iPadOS Quick Action Buttons -->
                <div
                    class="ios-cc-module p-2.5 grid grid-cols-2 grid-rows-2 gap-2 place-items-center"
                >
                    <button
                        type="button"
                        onclick={() => {
                            dashboard.closeControlCenter();
                            dashboard.openSpotlight();
                        }}
                        title="Spotlight Search"
                        class="size-11 rounded-full bg-white/10 hover:bg-primary text-white flex items-center justify-center transition-colors cursor-pointer"
                    >
                        <Search class="size-4" />
                    </button>

                    <button
                        type="button"
                        onclick={() => {
                            dashboard.closeControlCenter();
                            dashboard.toggleEditMode();
                        }}
                        title="Jiggle Mode"
                        class="size-11 rounded-full {dashboard.isEditMode
                            ? 'bg-primary text-white'
                            : 'bg-white/10 hover:bg-primary text-white'} flex items-center justify-center transition-colors cursor-pointer"
                    >
                        <Sparkles class="size-4" />
                    </button>

                    <button
                        type="button"
                        onclick={() => {
                            dashboard.closeControlCenter();
                            dashboard.openCreateNodeModal(null);
                        }}
                        title="Add Widget or Shortcut"
                        class="size-11 rounded-full bg-white/10 hover:bg-primary text-white flex items-center justify-center transition-colors cursor-pointer"
                    >
                        <Plus class="size-4" />
                    </button>

                    <button
                        type="button"
                        onclick={() => {
                            dashboard.closeControlCenter();
                            dashboard.openAppLibrary();
                        }}
                        title="App Library"
                        class="size-11 rounded-full bg-white/10 hover:bg-primary text-white flex items-center justify-center transition-colors cursor-pointer"
                    >
                        <LayoutGrid class="size-4" />
                    </button>
                </div>
            </div>

            <!-- Middle Pod: Ambient Wallpaper Studio -->
            <div class="ios-cc-module p-3 space-y-2.5">
                <div class="flex items-center justify-between">
                    <div
                        class="flex items-center gap-1.5 text-xs font-semibold text-white/90"
                    >
                        <Palette class="size-3.5 text-secondary" />
                        <span>Ambient Wallpaper</span>
                    </div>
                    <span class="text-[10px] text-white/45 capitalize">
                        {dashboard.wallpaperPreset}
                    </span>
                </div>

                <div class="grid grid-cols-4 gap-2">
                    {#each WALLPAPER_OPTIONS as opt (opt.id)}
                        {@const isSelected =
                            dashboard.wallpaperPreset === opt.id}
                        <button
                            type="button"
                            onclick={() => dashboard.setWallpaperPreset(opt.id)}
                            class="group flex flex-col items-center gap-1 p-1.5 rounded-2xl transition-all cursor-pointer {isSelected
                                ? 'bg-white/18 ring-1.5 ring-white'
                                : 'hover:bg-white/8'}"
                        >
                            <span
                                style="background: {opt.swatch};"
                                class="size-8 rounded-full shadow-md border border-white/20 group-hover:scale-105 transition-transform"
                            ></span>
                            <span
                                class="text-[10px] font-medium {isSelected
                                    ? 'text-white font-semibold'
                                    : 'text-white/60'}"
                            >
                                {opt.label}
                            </span>
                        </button>
                    {/each}
                </div>
            </div>

            <!-- Bottom Row: Display & Spatial Motion Toggles -->
            <div class="grid grid-cols-2 gap-3">
                <button
                    type="button"
                    onclick={() => dashboard.toggleIconLabels()}
                    class="ios-cc-module p-3 flex items-center gap-2.5 text-left cursor-pointer {dashboard.showIconLabels
                        ? 'ring-1 ring-white/25 bg-white/14'
                        : ''}"
                >
                    <div
                        class="size-8 rounded-full {dashboard.showIconLabels
                            ? 'bg-white text-black'
                            : 'bg-white/10 text-white/70'} flex items-center justify-center shrink-0 transition-colors"
                    >
                        {#if dashboard.showIconLabels}
                            <Eye class="size-4" />
                        {:else}
                            <EyeOff class="size-4" />
                        {/if}
                    </div>
                    <div class="min-w-0">
                        <div class="text-xs font-semibold truncate">
                            Icon Labels
                        </div>
                        <div class="text-[10px] text-white/55">
                            {dashboard.showIconLabels ? "Shown" : "Minimal"}
                        </div>
                    </div>
                </button>

                <button
                    type="button"
                    onclick={() => dashboard.toggleReducedParallax()}
                    class="ios-cc-module p-3 flex items-center gap-2.5 text-left cursor-pointer {!dashboard.reducedParallax
                        ? 'ring-1 ring-white/25 bg-white/14'
                        : ''}"
                >
                    <div
                        class="size-8 rounded-full {!dashboard.reducedParallax
                            ? 'bg-primary text-white'
                            : 'bg-white/10 text-white/70'} flex items-center justify-center shrink-0 transition-colors"
                    >
                        <Layers class="size-4" />
                    </div>
                    <div class="min-w-0">
                        <div class="text-xs font-semibold truncate">
                            Depth Effect
                        </div>
                        <div class="text-[10px] text-white/55">
                            {dashboard.reducedParallax ? "Off" : "Active"}
                        </div>
                    </div>
                </button>
            </div>
        </div>
    </div>
{/if}
