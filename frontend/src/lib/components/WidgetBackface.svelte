<script lang="ts">
    import { Check, RotateCcw } from "@lucide/svelte";
    import { dashboard, WIDGET_SIZE_PRESETS } from "../state/dashboard.svelte";
    import type { DashboardNode, NodeSettings, WorldClockCity } from "../types";

    interface Props {
        node: DashboardNode;
    }

    let { node }: Props = $props();

    const DEFAULT_QUAD_CITIES: WorldClockCity[] = [
        {
            name: node.title || "Amsterdam",
            timezone: node.settings?.timezone || "Europe/Amsterdam",
            flag: node.settings?.flag || "🇳🇱",
        },
        { name: "Cupertino", timezone: "America/Los_Angeles", flag: "🇺🇸" },
        { name: "New York", timezone: "America/New_York", flag: "🇺🇸" },
        { name: "Tokyo", timezone: "Asia/Tokyo", flag: "🇯🇵" },
    ];

    const POPULAR_TIMEZONES = [
        "Europe/Amsterdam",
        "Europe/London",
        "Europe/Paris",
        "Europe/Berlin",
        "Europe/Madrid",
        "Europe/Rome",
        "Europe/Zurich",
        "Europe/Stockholm",
        "America/New_York",
        "America/Chicago",
        "America/Denver",
        "America/Los_Angeles",
        "America/Toronto",
        "America/Vancouver",
        "America/Sao_Paulo",
        "Asia/Tokyo",
        "Asia/Seoul",
        "Asia/Singapore",
        "Asia/Hong_Kong",
        "Asia/Shanghai",
        "Asia/Kolkata",
        "Asia/Dubai",
        "Australia/Sydney",
        "Pacific/Auckland",
        "UTC",
    ];

    let title = $state(node.title);
    let selectedW = $state(node.width || 2);
    let selectedH = $state(node.height || 2);
    let settings = $state<NodeSettings>(
        structuredClone($state.snapshot(node.settings ?? {})),
    );

    let sizePresets = $derived(WIDGET_SIZE_PRESETS[node.node_type] ?? []);
    let isCompact = $derived((node.height || 1) === 1);
    let isQuadClock = $derived(
        node.node_type === "clock" && selectedW >= 4 && selectedH >= 4,
    );

    $effect(() => {
        if (isQuadClock && (!settings.cities || settings.cities.length < 4)) {
            settings.cities = structuredClone(DEFAULT_QUAD_CITIES);
        }
    });

    async function handleSave(e: SubmitEvent) {
        e.preventDefault();
        e.stopPropagation();
        if (isQuadClock && settings.cities && settings.cities.length > 0) {
            title = settings.cities[0].name.trim() || title;
            settings.timezone =
                settings.cities[0].timezone.trim() || settings.timezone;
            settings.flag = settings.cities[0].flag;
        }
        await dashboard.saveFlippedWidget(node.id, {
            title,
            width: selectedW,
            height: selectedH,
            settings,
        });
    }

    function handleCancel(e: MouseEvent) {
        e.stopPropagation();
        dashboard.flippedNodeId = null;
    }
</script>

<datalist id="iana-timezones-list">
    {#each POPULAR_TIMEZONES as tz (tz)}
        <option value={tz}></option>
    {/each}
</datalist>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<form
    onsubmit={handleSave}
    onclick={(e) => e.stopPropagation()}
    onpointerdown={(e) => e.stopPropagation()}
    class="w-full h-full ios-modal-surface rounded-[22px] {isCompact
        ? 'px-3.5 py-2 flex items-center gap-2.5'
        : 'p-3.5 flex flex-col justify-between gap-2'} overflow-y-auto select-none text-white"
>
    {#if isCompact}
        <!-- Compact Single-Row Backface for 4x1 / 6x1 / 8x1 Search Bar Widgets -->
        <input
            type="text"
            bind:value={settings.placeholder}
            placeholder="Placeholder..."
            class="w-36 ios-input px-2.5 py-1 text-xs text-white placeholder:text-white/40 shrink-0"
        />
        <input
            type="url"
            bind:value={settings.engineUrl}
            placeholder="https://www.google.com/search?q="
            class="flex-1 min-w-0 ios-input px-2.5 py-1 text-xs text-white placeholder:text-white/40"
        />
        <div class="flex items-center gap-1 shrink-0">
            {#each sizePresets as preset (`${preset.w}x${preset.h}`)}
                <button
                    type="button"
                    onclick={() => {
                        selectedW = preset.w;
                        selectedH = preset.h;
                    }}
                    class="size-6 rounded-full text-[10px] font-bold transition-colors cursor-pointer {selectedW ===
                        preset.w && selectedH === preset.h
                        ? 'bg-white text-black'
                        : 'bg-white/10 text-white/65 hover:text-white'}"
                >
                    {preset.shortLabel}
                </button>
            {/each}
        </div>
        <button
            type="submit"
            class="px-3 py-1 rounded-full bg-primary text-white text-xs font-semibold flex items-center gap-1 shrink-0 cursor-pointer"
        >
            <Check class="size-3 stroke-[2.5]" />
            Done
        </button>
    {:else}
        <!-- Multi-Row Backface Inspector for 2x2 / 4x2 / 4x4 Widgets -->
        <div
            class="flex items-center justify-between gap-2 border-b border-white/10 pb-2 shrink-0"
        >
            <span
                class="text-xs font-bold tracking-tight text-white/90 truncate"
            >
                {isQuadClock
                    ? "Configure 4-City World Clock"
                    : `Configure ${node.node_type.toUpperCase()}`}
            </span>
            <div class="flex items-center gap-1.5">
                <button
                    type="button"
                    onclick={handleCancel}
                    title="Flip Back"
                    class="size-6 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/75 cursor-pointer"
                >
                    <RotateCcw class="size-3" />
                </button>
                <button
                    type="submit"
                    class="px-2.5 py-0.5 rounded-full bg-primary text-white text-[11px] font-semibold flex items-center gap-1 shadow-sm hover:brightness-110 cursor-pointer"
                >
                    <Check class="size-3 stroke-[2.5]" />
                    Done
                </button>
            </div>
        </div>

        <div class="space-y-2 my-auto text-xs overflow-y-auto pr-0.5">
            {#if isQuadClock && settings.cities}
                <!-- 4-City World Clock Grid Configuration (for 4x4 Large Clock) -->
                <div class="grid grid-cols-2 gap-2">
                    {#each settings.cities.slice(0, 4) as city, idx (idx)}
                        <div
                            class="ios-nested-surface p-2.5 rounded-xl space-y-1.5"
                        >
                            <div
                                class="flex items-center justify-between gap-1.5"
                            >
                                <span
                                    class="text-[10px] font-bold uppercase tracking-wider text-primary"
                                >
                                    Clock {idx + 1}
                                </span>
                                <input
                                    type="text"
                                    bind:value={city.flag}
                                    placeholder="🌍"
                                    title="Flag Emoji"
                                    class="w-9 ios-input px-1 py-0.5 text-[11px] text-center"
                                />
                            </div>
                            <input
                                type="text"
                                required
                                bind:value={city.name}
                                placeholder="City name"
                                class="w-full ios-input px-2 py-1 text-[11px] text-white font-medium"
                            />
                            <input
                                type="text"
                                required
                                list="iana-timezones-list"
                                bind:value={city.timezone}
                                placeholder="Europe/Amsterdam"
                                class="w-full ios-input px-2 py-1 text-[10.5px] text-white/85 font-mono"
                            />
                        </div>
                    {/each}
                </div>

                <div class="flex items-center justify-between pt-1">
                    <span class="text-[10px] font-medium text-white/55">
                        Second Hand Motion
                    </span>
                    <div
                        class="flex items-center gap-1 p-0.5 rounded-full bg-black/30 border border-white/8"
                    >
                        <button
                            type="button"
                            onclick={() => (settings.sweepSeconds = true)}
                            class="px-2.5 py-0.5 rounded-full text-[10px] font-semibold cursor-pointer {settings.sweepSeconds !==
                            false
                                ? 'bg-white text-black'
                                : 'text-white/60 hover:text-white'}"
                        >
                            Sweep
                        </button>
                        <button
                            type="button"
                            onclick={() => (settings.sweepSeconds = false)}
                            class="px-2.5 py-0.5 rounded-full text-[10px] font-semibold cursor-pointer {settings.sweepSeconds ===
                            false
                                ? 'bg-white text-black'
                                : 'text-white/60 hover:text-white'}"
                        >
                            Quartz
                        </button>
                    </div>
                </div>
            {:else}
                <label class="block space-y-1">
                    <span class="text-[10px] font-medium text-white/55 block">
                        Title
                    </span>
                    <input
                        type="text"
                        required
                        bind:value={title}
                        class="w-full ios-input px-2.5 py-1 text-xs text-white"
                    />
                </label>

                {#if node.node_type === "clock"}
                    <div class="grid grid-cols-3 gap-1.5">
                        <label class="col-span-2 block space-y-1">
                            <span
                                class="text-[10px] font-medium text-white/55 block"
                            >
                                IANA Timezone
                            </span>
                            <input
                                type="text"
                                required
                                list="iana-timezones-list"
                                bind:value={settings.timezone}
                                placeholder="Europe/Amsterdam"
                                class="w-full ios-input px-2 py-1 text-[11px] text-white"
                            />
                        </label>
                        <label class="block space-y-1">
                            <span
                                class="text-[10px] font-medium text-white/55 block"
                            >
                                Flag
                            </span>
                            <input
                                type="text"
                                bind:value={settings.flag}
                                placeholder="🇳🇱"
                                class="w-full ios-input px-2 py-1 text-[11px] text-white text-center"
                            />
                        </label>
                    </div>

                    <div class="flex items-center justify-between pt-0.5">
                        <span class="text-[10px] font-medium text-white/55">
                            Second Hand
                        </span>
                        <div
                            class="flex items-center gap-1 p-0.5 rounded-full bg-black/30 border border-white/8"
                        >
                            <button
                                type="button"
                                onclick={() => (settings.sweepSeconds = true)}
                                class="px-2 py-0.5 rounded-full text-[10px] font-semibold cursor-pointer {settings.sweepSeconds !==
                                false
                                    ? 'bg-white text-black'
                                    : 'text-white/60 hover:text-white'}"
                            >
                                Sweep
                            </button>
                            <button
                                type="button"
                                onclick={() => (settings.sweepSeconds = false)}
                                class="px-2 py-0.5 rounded-full text-[10px] font-semibold cursor-pointer {settings.sweepSeconds ===
                                false
                                    ? 'bg-white text-black'
                                    : 'text-white/60 hover:text-white'}"
                            >
                                Quartz
                            </button>
                        </div>
                    </div>
                {/if}
            {/if}
        </div>

        {#if sizePresets.length > 1}
            <div
                class="flex items-center justify-between gap-1 pt-1.5 border-t border-white/10 shrink-0"
            >
                <span class="text-[10px] font-medium text-white/50">Size</span>
                <div class="flex items-center gap-1">
                    {#each sizePresets as preset (`${preset.w}x${preset.h}`)}
                        <button
                            type="button"
                            onclick={() => {
                                selectedW = preset.w;
                                selectedH = preset.h;
                            }}
                            class="px-2 py-0.5 rounded-full text-[10px] font-semibold transition-all cursor-pointer {selectedW ===
                                preset.w && selectedH === preset.h
                                ? 'bg-white text-black shadow-xs'
                                : 'bg-white/10 text-white/65 hover:text-white'}"
                        >
                            {preset.shortLabel}
                        </button>
                    {/each}
                </div>
            </div>
        {/if}
    {/if}
</form>
