<script lang="ts">
    import { Plus, Trash2 } from "@lucide/svelte";
    import { dashboard } from "../../state/dashboard.svelte";
    import type { CalendarEvent, DashboardNode } from "../../types";

    interface Props {
        node: DashboardNode;
    }

    let { node }: Props = $props();

    let quickInput = $state("");
    let now = new Date();

    let events = $derived<CalendarEvent[]>(node.settings?.events ?? []);
    let isWide = $derived((node.width || 2) >= 4);

    const EVENT_COLORS = [
        "#0A84FF",
        "#30D158",
        "#FF9F0A",
        "#BF5AF2",
        "#64D2FF",
    ];

    let weekdayHeader = $derived(
        new Intl.DateTimeFormat("en-US", { weekday: "long" })
            .format(now)
            .toUpperCase(),
    );

    let monthShortHeader = $derived(
        new Intl.DateTimeFormat("en-US", { month: "long" })
            .format(now)
            .toUpperCase(),
    );

    let dayNumber = $derived(now.getDate());

    // Build mini monthly calendar grid for 4x2 / 4x4 layout
    let miniMonthDays = $derived.by(() => {
        const year = now.getFullYear();
        const month = now.getMonth();
        const firstDay = new Date(year, month, 1).getDay(); // 0 (Sun) .. 6 (Sat)
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const leadingBlanks = (firstDay + 6) % 7; // Monday-first
        const cells: (number | null)[] = [];
        for (let i = 0; i < leadingBlanks; i++) cells.push(null);
        for (let d = 1; d <= daysInMonth; d++) cells.push(d);
        return cells;
    });

    async function addQuickEvent(e: SubmitEvent) {
        e.preventDefault();
        const raw = quickInput.trim();
        if (!raw) return;

        // Automatically parse leading time like "14:00 Team Sync" or "09:30-10:30 Standup"
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
            color: EVENT_COLORS[events.length % EVENT_COLORS.length],
        };

        await dashboard.updateNodeSettings(node.id, {
            ...node.settings,
            events: [...events, ev],
        });

        quickInput = "";
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
        <!-- Left Column: Apple Calendar Date Header & Live Mini Month Grid -->
        <div
            class="w-[140px] shrink-0 flex flex-col justify-between border-r border-white/[0.08] pr-3"
        >
            <div>
                <div
                    class="text-[10px] font-bold tracking-wider text-[#FF453A] uppercase"
                >
                    {weekdayHeader}
                </div>
                <div
                    class="text-3xl font-light text-white ios-tabular-nums leading-tight"
                >
                    {dayNumber}
                </div>
            </div>

            <div class="space-y-1 my-auto">
                <div
                    class="text-[9px] font-bold text-white/45 tracking-wider uppercase"
                >
                    {monthShortHeader}
                </div>
                <div
                    class="grid grid-cols-7 gap-y-0.5 text-center text-[9px] ios-tabular-nums"
                >
                    {#each ["M", "T", "W", "T", "F", "S", "S"] as wd}
                        <span class="text-white/35 font-semibold">{wd}</span>
                    {/each}
                    {#each miniMonthDays as d}
                        {#if d === null}
                            <span></span>
                        {:else}
                            <span
                                class="size-4 mx-auto flex items-center justify-center rounded-full {d ===
                                dayNumber
                                    ? 'bg-[#FF453A] text-white font-bold'
                                    : 'text-white/75'}"
                            >
                                {d}
                            </span>
                        {/if}
                    {/each}
                </div>
            </div>
        </div>
    {:else}
        <!-- Small (2x2) Header: Iconic Apple Calendar Red Weekday + Large Date -->
        <div class="flex items-baseline justify-between shrink-0">
            <div>
                <div
                    class="text-[10px] font-bold tracking-wider text-[#FF453A] uppercase leading-none"
                >
                    {weekdayHeader}
                </div>
                <div
                    class="text-3xl font-light text-white ios-tabular-nums leading-none mt-0.5"
                >
                    {dayNumber}
                </div>
            </div>
            <span class="text-[11px] font-medium text-white/45 truncate">
                {node.title}
            </span>
        </div>
    {/if}

    <!-- Right / Bottom Column: "Up Next" Color-Coded Event Timeline & Inline Quick Entry -->
    <div class="flex-1 min-w-0 flex flex-col justify-between gap-2 h-full">
        <div class="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-0.5">
            {#each events as ev, idx (ev.id)}
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
                            class="text-[10.5px] text-white/50 ios-tabular-nums truncate"
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
                <div
                    class="h-full flex items-center justify-center text-xs text-white/35"
                >
                    No more events today
                </div>
            {/each}
        </div>

        <form
            onsubmit={addQuickEvent}
            class="pt-1.5 border-t border-white/[0.08] flex items-center gap-1.5 shrink-0"
        >
            <Plus class="size-3.5 text-[#FF453A] shrink-0" />
            <input
                type="text"
                bind:value={quickInput}
                placeholder={isWide ? "14:00 Event title..." : "Add event..."}
                disabled={dashboard.isEditMode}
                class="flex-1 min-w-0 bg-transparent text-xs text-white placeholder:text-white/35 focus:outline-none"
            />
        </form>
    </div>
</div>
