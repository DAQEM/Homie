<script lang="ts">
    import { Check, Plus, Search, Sparkles, Wifi } from "@lucide/svelte";
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

    let liveUptime = $derived(
        typeof dashboard.signals["system:hello:uptime"] === "string"
            ? (dashboard.signals["system:hello:uptime"] as string)
            : null,
    );
</script>

<header
    class="w-full flex items-center justify-between px-2 py-1 select-none text-xs font-semibold text-white/90"
>
    <!-- Top-Left: iPadOS Time, Date & Contextual Edit Mode '+' Pill -->
    <div class="flex items-center gap-3">
        <div
            class="flex items-center gap-2 ios-tabular-nums tracking-tight ios-label-shadow"
        >
            <span>{timeText}</span>
            <span class="text-white/70 font-medium">{dateText}</span>
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

    <!-- Center: Subtle Active Workspace Indicator -->
    {#if dashboard.activeWorkspace}
        <div
            class="hidden sm:flex items-center gap-1.5 text-[11px] font-medium text-white/55 ios-label-shadow"
        >
            <span>{dashboard.activeWorkspace.name}</span>
        </div>
    {/if}

    <!-- Top-Right: Spotlight Trigger, Live SSE Signal Status & Edit/Done Pill -->
    <div class="flex items-center gap-2">
        {#if !dashboard.isEditMode}
            <div
                title={liveUptime
                    ? `${dashboard.hydrationStatus} • ${liveUptime}`
                    : dashboard.hydrationStatus}
                class="hidden sm:flex items-center gap-1.5 text-[11px] font-medium text-white/75 ios-tabular-nums ios-label-shadow mr-1"
            >
                <span
                    class="size-1.5 rounded-full {dashboard.hydrationStatus.includes(
                        'Live',
                    )
                        ? 'bg-[#30D158] shadow-[0_0_6px_#30D158]'
                        : 'bg-[#0A84FF]'}"
                ></span>
                {#if liveUptime}
                    <span class="text-white/55">{liveUptime}</span>
                {/if}
                <Wifi class="size-3.5 text-white/80 ml-0.5" />
            </div>

            <button
                type="button"
                onclick={() => dashboard.openSpotlight()}
                title="Spotlight Search (⌘K)"
                class="ios-glass-pill rounded-full px-2.5 py-1 text-[11px] font-medium text-white/80 hover:text-white hover:bg-white/15 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
            >
                <Search class="size-3 text-white/75" />
                <span class="hidden sm:inline">Search</span>
            </button>

            <button
                type="button"
                onclick={() => dashboard.toggleEditMode()}
                title="Edit Home Screen (⌘E)"
                class="ios-glass-pill rounded-full px-2.5 py-1 text-[11px] font-medium text-white/75 hover:text-white hover:bg-white/15 active:scale-95 transition-all flex items-center gap-1 cursor-pointer"
            >
                <Sparkles class="size-3 text-primary" />
                <span>Edit</span>
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
