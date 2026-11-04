<script lang="ts">
    import {
        Check,
        Plus,
        Search,
        SlidersHorizontal,
        Sparkles,
        Wifi,
    } from "@lucide/svelte";
    import { dashboard } from "../state/dashboard.svelte";

    let timeText = $derived(
        new Intl.DateTimeFormat("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        }).format(dashboard.now),
    );

    let dateText = $derived(
        new Intl.DateTimeFormat("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
        }).format(dashboard.now),
    );

    let isLiveSSE = $derived(dashboard.hydrationStatus.includes("Live"));
</script>

<header
    class="w-full flex items-center justify-between px-2 py-1 select-none text-xs font-semibold text-white/92"
>
    <!-- Top-Left: iPadOS Time, Date & Contextual Edit Mode '+' Pill -->
    <div class="flex items-center gap-3">
        <div
            class="flex items-center gap-2 ios-tabular-nums tracking-tight ios-vibrant-label"
        >
            <span>{timeText}</span>
            <span class="ios-vibrant-secondary font-medium">{dateText}</span>
        </div>

        {#if dashboard.isEditMode}
            <button
                type="button"
                onclick={() => dashboard.openCreateNodeModal(null)}
                title="Add Widget or Shortcut"
                class="ios-glass-pill rounded-full px-3 py-1 text-xs font-semibold text-white hover:bg-white/20 active:scale-95 transition-all flex items-center gap-1 cursor-pointer"
            >
                <Plus class="size-3.5 stroke-[2.5]" />
                <span>Add</span>
            </button>
        {/if}
    </div>

    <!-- Center: Subtle Vibrant Active Workspace Indicator -->
    {#if dashboard.activeWorkspace}
        <div
            class="hidden sm:flex items-center gap-1.5 text-[11px] font-medium ios-vibrant-secondary"
        >
            <span>{dashboard.activeWorkspace.name}</span>
        </div>
    {/if}

    <!-- Top-Right: Spotlight Trigger, Edit Mode & iPadOS Control Center Capsule -->
    <div class="flex items-center gap-2">
        {#if !dashboard.isEditMode}
            <button
                type="button"
                onclick={() => dashboard.openSpotlight()}
                title="Spotlight Search (⌘K)"
                class="ios-glass-pill rounded-full px-2.5 py-1 text-[11px] font-medium text-white/85 hover:text-white hover:bg-white/15 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
            >
                <Search class="size-3 text-white/75" />
                <span class="hidden sm:inline">Search</span>
            </button>

            <button
                type="button"
                onclick={() => dashboard.toggleEditMode()}
                title="Edit Home Screen (⌘E)"
                class="ios-glass-pill rounded-full px-2.5 py-1 text-[11px] font-medium text-white/80 hover:text-white hover:bg-white/15 active:scale-95 transition-all flex items-center gap-1 cursor-pointer"
            >
                <Sparkles class="size-3 text-primary" />
                <span class="hidden sm:inline">Edit</span>
            </button>

            <!-- iPadOS Control Center Status Capsule -->
            <button
                type="button"
                onclick={() => dashboard.toggleControlCenter()}
                title="Control Center"
                aria-label="Open Control Center"
                class="ios-glass-pill rounded-full px-2.5 py-1 text-[11px] font-medium text-white/90 hover:text-white hover:bg-white/18 active:scale-95 transition-all flex items-center gap-2 cursor-pointer {dashboard.isControlCenterOpen
                    ? 'ring-1.5 ring-white/50 bg-white/20'
                    : ''}"
            >
                <span
                    class="size-1.5 rounded-full {isLiveSSE
                        ? 'bg-[#30D158] shadow-[0_0_6px_#30D158]'
                        : 'bg-[#0A84FF]'}"
                ></span>
                <Wifi class="size-3.5 text-white/85" />
                <SlidersHorizontal class="size-3 text-white/75" />
            </button>
        {:else}
            <button
                type="button"
                onclick={() => dashboard.toggleEditMode()}
                class="bg-primary text-primary-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.32),0_4px_12px_rgba(10,132,255,0.45)] hover:brightness-110 active:scale-95 rounded-full px-3.5 py-1 text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer"
            >
                <Check class="size-3.5 stroke-[2.5]" />
                <span>Done</span>
            </button>
        {/if}
    </div>
</header>
