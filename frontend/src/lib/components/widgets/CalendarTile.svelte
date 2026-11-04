<script lang="ts">
    import { Plus, RotateCcw, Trash2 } from "@lucide/svelte";
    import { dashboard } from "../../state/dashboard.svelte";
    import type { CalendarEvent, DashboardNode } from "../../types";

    interface Props {
        node: DashboardNode;
    }

    let { node }: Props = $props();

    let now = $derived(dashboard.now);
    let todayYear = $derived(now.getFullYear());
    let todayMonth = $derived(now.getMonth());
    let todayDay = $derived(now.getDate());

    function toIsoDate(y: number, m: number, d: number): string {
        return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }

    let todayIso = $derived(toIsoDate(todayYear, todayMonth, todayDay));
    let selectedDay = $state<number | null>(null);
    let activeDay = $derived(selectedDay ?? todayDay);
    let activeIso = $derived(toIsoDate(todayYear, todayMonth, activeDay));
    let isViewingToday = $derived(activeDay === todayDay);

    let isComposerOpen = $state(false);
    let quickInput = $state("");
    let composerInputEl: HTMLInputElement | undefined = $state();

    let events = $derived<CalendarEvent[]>(node.settings?.events ?? []);
    let isWide = $derived((node.width || 2) >= 4);

    // Filter events for the selected day (undated legacy events appear on Today)
    let dayEvents = $derived(
        events.filter((ev) =>
            ev.date ? ev.date === activeIso : isViewingToday,
        ),
    );

    // Set of days in the current month that have at least one event
    let daysWithEvents = $derived.by(() => {
        const set = new Set<number>();
        for (const ev of events) {
            if (!ev.date) {
                set.add(todayDay);
            } else {
                const parts = ev.date.split("-").map(Number);
                if (parts[0] === todayYear && parts[1] === todayMonth + 1) {
                    set.add(parts[2]);
                }
            }
        }
        return set;
    });

    const EVENT_COLORS = [
        "#0A84FF",
        "#30D158",
        "#FF9F0A",
        "#BF5AF2",
        "#64D2FF",
    ];

    let selectedDateObj = $derived(new Date(todayYear, todayMonth, activeDay));

    let weekdayHeader = $derived(
        new Intl.DateTimeFormat("en-US", { weekday: "long" })
            .format(selectedDateObj)
            .toUpperCase(),
    );

    let monthShortHeader = $derived(
        new Intl.DateTimeFormat("en-US", { month: "long" })
            .format(now)
            .toUpperCase(),
    );

    // Build mini monthly calendar grid for 4x2 / 4x4 layout
    let miniMonthDays = $derived.by(() => {
        const firstDay = new Date(todayYear, todayMonth, 1).getDay();
        const daysInMonth = new Date(todayYear, todayMonth + 1, 0).getDate();
        const leadingBlanks = (firstDay + 6) % 7; // Monday-first
        const cells: (number | null)[] = [];
        for (let i = 0; i < leadingBlanks; i++) cells.push(null);
        for (let d = 1; d <= daysInMonth; d++) cells.push(d);
        return cells;
    });

    function openComposer(e?: MouseEvent) {
        e?.stopPropagation();
        if (dashboard.isEditMode) return;
        isComposerOpen = true;
        queueMicrotask(() => composerInputEl?.focus());
    }

    async function addQuickEvent(e: SubmitEvent) {
        e.preventDefault();
        const raw = quickInput.trim();
        if (!raw) {
            isComposerOpen = false;
            return;
        }

        let time = "All day";
        let title = raw;
        const match = raw.match(
            /^(\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?)\s+(.+)$/,
        );
        if (match) {
            time = match[1];
            title = match[2];
        }

        const ev: CalendarEvent = {
            id: crypto.randomUUID(),
            title,
            time,
            date: activeIso,
            color: EVENT_COLORS[events.length % EVENT_COLORS.length],
        };

        await dashboard.updateNodeSettings(node.id, {
            ...node.settings,
            events: [...events, ev],
        });

        quickInput = "";
        isComposerOpen = false;
    }

    async function removeEvent(id: string) {
        const updated = events.filter((ev) => ev.id !== id);
        await dashboard.updateNodeSettings(node.id, {
            ...node.settings,
            events: updated,
        });
    }
</script>

<div
    class="w-full h-full ios-widget-surface p-3.5 flex {isWide
        ? 'gap-4'
        : 'flex-col gap-2'} overflow-hidden select-none"
>
    {#if isWide}
        <!-- Left Column: Apple Calendar Date Header & Interactive Mini Month Grid -->
        <div
            class="w-[148px] shrink-0 flex flex-col justify-between border-r border-white/[0.08] pr-3"
        >
            <div class="flex items-start justify-between gap-1">
                <div>
                    <div
                        class="text-[10px] font-bold tracking-wider text-[#FF453A] uppercase"
                    >
                        {weekdayHeader}
                    </div>
                    <div
                        class="text-3xl font-light text-white ios-tabular-nums leading-tight"
                    >
                        {activeDay}
                    </div>
                </div>

                {#if !isViewingToday}
                    <button
                        type="button"
                        onclick={() => (selectedDay = null)}
                        title="Jump back to Today"
                        class="px-2 py-0.5 rounded-full bg-[#FF453A]/20 text-[#FF453A] text-[9.5px] font-bold flex items-center gap-0.5 hover:bg-[#FF453A] hover:text-white transition-colors cursor-pointer"
                    >
                        <RotateCcw class="size-2.5" />
                        Today
                    </button>
                {/if}
            </div>

            <div class="space-y-1 my-auto">
                <div
                    class="text-[9px] font-bold ios-vibrant-secondary tracking-wider uppercase"
                >
                    {monthShortHeader}
                </div>
                <div
                    class="grid grid-cols-7 gap-y-0.5 text-center text-[9.5px] ios-tabular-nums"
                >
                    {#each ["M", "T", "W", "T", "F", "S", "S"] as wd}
                        <span class="text-white/35 font-semibold">{wd}</span>
                    {/each}
                    {#each miniMonthDays as d}
                        {#if d === null}
                            <span></span>
                        {:else}
                            {@const isToday = d === todayDay}
                            {@const isSelected = d === activeDay}
                            {@const hasDot = daysWithEvents.has(d)}
                            <button
                                type="button"
                                onclick={() => (selectedDay = d)}
                                class="relative size-4.5 mx-auto flex flex-col items-center justify-center rounded-full transition-colors cursor-pointer {isSelected
                                    ? isToday
                                        ? 'bg-[#FF453A] text-white font-bold shadow-xs'
                                        : 'bg-white text-black font-bold'
                                    : isToday
                                      ? 'text-[#FF453A] font-bold hover:bg-white/10'
                                      : 'text-white/75 hover:bg-white/10'}"
                            >
                                <span>{d}</span>
                                {#if hasDot && !isSelected}
                                    <span
                                        class="absolute -bottom-0.5 size-1 rounded-full bg-[#FF453A]"
                                    ></span>
                                {/if}
                            </button>
                        {/if}
                    {/each}
                </div>
            </div>
        </div>
    {:else}
        <!-- Small (2x2) Header: Iconic Apple Calendar Red Weekday + Large Date + '+' Button -->
        <div class="flex items-start justify-between shrink-0">
            <div>
                <div
                    class="text-[10px] font-bold tracking-wider text-[#FF453A] uppercase leading-none"
                >
                    {weekdayHeader}
                </div>
                <div
                    class="text-3xl font-light text-white ios-tabular-nums leading-none mt-0.5"
                >
                    {activeDay}
                </div>
            </div>

            {#if !dashboard.isEditMode}
                <button
                    type="button"
                    onclick={openComposer}
                    title="Add Event"
                    class="size-6 rounded-full bg-white/10 hover:bg-[#FF453A] text-white/80 hover:text-white flex items-center justify-center transition-all active:scale-90 cursor-pointer"
                >
                    <Plus class="size-3.5 stroke-[2.5]" />
                </button>
            {/if}
        </div>
    {/if}

    <!-- Right / Bottom Column: "Up Next" Color-Coded Event Timeline -->
    <div class="flex-1 min-w-0 flex flex-col justify-between gap-2 h-full">
        {#if isWide}
            <div class="flex items-center justify-between shrink-0">
                <span
                    class="text-[10.5px] font-semibold uppercase tracking-wider ios-vibrant-secondary"
                >
                    {isViewingToday
                        ? "Up Next"
                        : `Events • ${monthShortHeader.slice(0, 3)} ${activeDay}`}
                </span>
                {#if !dashboard.isEditMode}
                    <button
                        type="button"
                        onclick={openComposer}
                        title="Add Event"
                        class="size-5.5 rounded-full bg-white/10 hover:bg-[#FF453A] text-white/80 hover:text-white flex items-center justify-center transition-all active:scale-90 cursor-pointer"
                    >
                        <Plus class="size-3 stroke-[2.5]" />
                    </button>
                {/if}
            </div>
        {/if}

        {#if isComposerOpen && !dashboard.isEditMode}
            <form
                onsubmit={addQuickEvent}
                class="ios-nested-surface px-2.5 py-1.5 flex items-center gap-1.5 shrink-0 ring-1 ring-[#FF453A]/60"
            >
                <span class="size-2 rounded-full bg-[#FF453A] shrink-0"></span>
                <input
                    bind:this={composerInputEl}
                    type="text"
                    bind:value={quickInput}
                    onkeydown={(e) => {
                        if (e.key === "Escape") {
                            e.stopPropagation();
                            quickInput = "";
                            isComposerOpen = false;
                        }
                    }}
                    onblur={() => {
                        if (!quickInput.trim()) isComposerOpen = false;
                    }}
                    placeholder="14:00 Event title..."
                    class="flex-1 min-w-0 bg-transparent text-xs text-white placeholder:text-white/40 focus:outline-none"
                />
            </form>
        {/if}

        <div class="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-0.5">
            {#each dayEvents as ev, idx (ev.id)}
                {@const barColor =
                    ev.color ?? EVENT_COLORS[idx % EVENT_COLORS.length]}
                <div
                    class="group relative ios-nested-surface pl-3 pr-2 py-1.5 flex items-center justify-between gap-2 overflow-hidden"
                >
                    <span
                        style="background: {barColor};"
                        class="absolute left-0 top-1 bottom-1 w-1 rounded-r-full"
                    ></span>

                    <div class="min-w-0 flex-1">
                        <div
                            class="text-xs font-semibold text-white/95 truncate leading-tight"
                        >
                            {ev.title}
                        </div>
                        <div
                            class="text-[10.5px] ios-vibrant-secondary ios-tabular-nums truncate"
                        >
                            {ev.time}
                        </div>
                    </div>

                    <button
                        type="button"
                        onclick={() => removeEvent(ev.id)}
                        class="opacity-0 group-hover:opacity-100 text-white/35 hover:text-destructive p-0.5 rounded transition-all shrink-0 cursor-pointer"
                        title="Remove event"
                    >
                        <Trash2 class="size-3" />
                    </button>
                </div>
            {:else}
                <button
                    type="button"
                    onclick={openComposer}
                    class="w-full h-full flex flex-col items-center justify-center gap-0.5 text-xs ios-vibrant-secondary hover:text-white/80 transition-colors cursor-pointer"
                >
                    <span>No events scheduled</span>
                    <span class="text-[10px] text-[#FF453A] font-semibold">
                        Tap + to schedule
                    </span>
                </button>
            {/each}
        </div>
    </div>
</div>
