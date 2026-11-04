<script lang="ts">
    import {
        AlertCircle,
        ChevronLeft,
        ChevronRight,
        Link2,
        MapPin,
        Maximize2,
        RefreshCw,
        RotateCcw,
    } from "@lucide/svelte";
    import { dashboard } from "../../state/dashboard.svelte";
    import type { CalendarEvent, DashboardNode } from "../../types";

    interface Props {
        node: DashboardNode;
    }

    let { node }: Props = $props();

    let tileEl: HTMLDivElement | undefined = $state();

    let now = $derived(dashboard.now);
    let todayYear = $derived(now.getFullYear());
    let todayMonth = $derived(now.getMonth());
    let todayDay = $derived(now.getDate());

    function toIsoDate(y: number, m: number, d: number): string {
        return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }

    let todayIso = $derived(toIsoDate(todayYear, todayMonth, todayDay));

    // Interactive month/year/day navigation state inside the widget
    let navYear = $state<number | null>(null);
    let navMonth = $state<number | null>(null);
    let selectedDay = $state<number | null>(null);

    let viewedYear = $derived(navYear ?? todayYear);
    let viewedMonth = $derived(navMonth ?? todayMonth);
    let isCurrentMonth = $derived(
        viewedYear === todayYear && viewedMonth === todayMonth,
    );

    let activeDay = $derived(selectedDay ?? (isCurrentMonth ? todayDay : 1));
    let activeIso = $derived(toIsoDate(viewedYear, viewedMonth, activeDay));
    let isViewingToday = $derived(activeIso === todayIso);

    // Synced .ics feed events (or gallery preview fallback)
    let allEvents = $derived<CalendarEvent[]>(
        dashboard.getCalendarEventsForNode(node),
    );
    let syncStatus = $derived(dashboard.getCalendarStatusForNode(node.id));
    let isSyncing = $derived(Boolean(dashboard.syncingCalendarNodes[node.id]));
    let hasConfiguredFeeds = $derived(
        Boolean(
            (node.settings?.calendarFeeds &&
                node.settings.calendarFeeds.length > 0) ||
            (node.settings?.icalUrl && node.settings.icalUrl.trim() !== ""),
        ),
    );
    let failedFeed = $derived(syncStatus?.feeds.find((f) => !f.ok) ?? null);

    let isWide = $derived((node.width || 2) >= 4);
    let isLarge = $derived((node.width || 2) >= 4 && (node.height || 2) >= 4);

    // Events for the active selected day
    let dayEvents = $derived(
        allEvents.filter((ev) =>
            ev.date ? ev.date === activeIso : isViewingToday,
        ),
    );

    // Upcoming events later in the viewed month
    let upcomingInViewedMonth = $derived.by(() => {
        const prefix = `${viewedYear}-${String(viewedMonth + 1).padStart(2, "0")}-`;
        return allEvents
            .filter(
                (ev) =>
                    ev.date &&
                    ev.date.startsWith(prefix) &&
                    ev.date > activeIso,
            )
            .slice(0, isLarge ? 6 : 3);
    });

    // Up to 3 colored event dots per day in the viewed month
    let dayDotsMap = $derived.by(() => {
        const map = new Map<number, string[]>();
        for (const ev of allEvents) {
            if (!ev.date) {
                if (isCurrentMonth) {
                    const arr = map.get(todayDay) ?? [];
                    if (arr.length < 3) arr.push(ev.color ?? "#FF453A");
                    map.set(todayDay, arr);
                }
            } else {
                const parts = ev.date.split("-").map(Number);
                if (parts[0] === viewedYear && parts[1] === viewedMonth + 1) {
                    const d = parts[2];
                    const arr = map.get(d) ?? [];
                    if (arr.length < 3) arr.push(ev.color ?? "#FF453A");
                    map.set(d, arr);
                }
            }
        }
        return map;
    });

    const EVENT_COLORS = [
        "#0A84FF",
        "#30D158",
        "#FF9F0A",
        "#BF5AF2",
        "#64D2FF",
    ];

    let selectedDateObj = $derived(
        new Date(viewedYear, viewedMonth, activeDay),
    );

    let weekdayHeader = $derived(
        new Intl.DateTimeFormat("en-US", { weekday: "long" })
            .format(selectedDateObj)
            .toUpperCase(),
    );

    let monthYearHeader = $derived(
        new Intl.DateTimeFormat("en-US", {
            month: "short",
            year: viewedYear !== todayYear ? "numeric" : undefined,
        })
            .format(new Date(viewedYear, viewedMonth, 1))
            .toUpperCase(),
    );

    // Build monthly calendar grid for 4x2 / 4x4 layout
    let miniMonthDays = $derived.by(() => {
        const firstDay = new Date(viewedYear, viewedMonth, 1).getDay();
        const daysInMonth = new Date(viewedYear, viewedMonth + 1, 0).getDate();
        const leadingBlanks = (firstDay + 6) % 7; // Monday-first
        const cells: (number | null)[] = [];
        for (let i = 0; i < leadingBlanks; i++) cells.push(null);
        for (let d = 1; d <= daysInMonth; d++) cells.push(d);
        return cells;
    });

    function formatShortIsoDate(iso?: string): string {
        if (!iso) return "";
        const [y, m, d] = iso.split("-").map(Number);
        if (!y || !m || !d) return iso;
        return new Intl.DateTimeFormat("en-US", {
            month: "short",
            day: "numeric",
        }).format(new Date(y, m - 1, d));
    }

    function stepMonth(delta: number, e?: MouseEvent) {
        e?.stopPropagation();
        const next = new Date(viewedYear, viewedMonth + delta, 1);
        navYear = next.getFullYear();
        navMonth = next.getMonth();
        if (
            next.getFullYear() === todayYear &&
            next.getMonth() === todayMonth
        ) {
            selectedDay = todayDay;
        } else {
            selectedDay = 1;
        }
    }

    function stepDay(delta: number, e?: MouseEvent) {
        e?.stopPropagation();
        const next = new Date(viewedYear, viewedMonth, activeDay + delta);
        navYear = next.getFullYear();
        navMonth = next.getMonth();
        selectedDay = next.getDate();
    }

    function resetToToday(e?: MouseEvent) {
        e?.stopPropagation();
        navYear = null;
        navMonth = null;
        selectedDay = null;
    }

    function openFullModal(e?: MouseEvent, dateIso?: string) {
        e?.stopPropagation();
        if (dashboard.isEditMode || node.id === "gallery-preview-node") return;
        dashboard.openCalendarModal(node.id, dateIso ?? activeIso, tileEl);
    }

    function openFeedSetup(e: MouseEvent) {
        e.stopPropagation();
        dashboard.inspectNode(node, e);
    }

    function handleSyncNow(e: MouseEvent) {
        e.stopPropagation();
        void dashboard.syncCalendarNodeNow(node.id);
    }
</script>

<div
    bind:this={tileEl}
    class="w-full h-full ios-widget-surface p-3.5 flex {isWide
        ? 'gap-3'
        : 'flex-col gap-2'} overflow-hidden select-none"
>
    {#if isWide}
        <!-- Left Column: Apple Calendar Date Header & Interactive Multi-Month Grid -->
        <div
            class="{isLarge
                ? 'w-[184px]'
                : 'w-[136px]'} shrink-0 flex flex-col justify-between border-r border-white/[0.08] pr-2.5"
        >
            <div class="flex items-start justify-between gap-1">
                <div class="min-w-0">
                    <div
                        class="text-[10px] font-bold tracking-wider text-[#FF453A] uppercase truncate"
                    >
                        {weekdayHeader}
                    </div>
                    <div class="flex items-baseline gap-1.5">
                        <span
                            class="text-3xl font-light text-white ios-tabular-nums leading-tight"
                        >
                            {activeDay}
                        </span>
                        {#if !isCurrentMonth}
                            <span
                                class="text-[9.5px] font-semibold text-white/50 uppercase truncate"
                            >
                                {monthYearHeader}
                            </span>
                        {/if}
                    </div>
                </div>

                {#if !isViewingToday}
                    <button
                        type="button"
                        onclick={resetToToday}
                        title="Jump back to Today"
                        class="px-1.5 py-0.5 rounded-full bg-[#FF453A]/20 text-[#FF453A] text-[9px] font-bold flex items-center gap-0.5 hover:bg-[#FF453A] hover:text-white transition-colors cursor-pointer shrink-0"
                    >
                        <RotateCcw class="size-2.5" />
                        Today
                    </button>
                {/if}
            </div>

            <!-- Interactive Month Switcher + Mini Calendar Grid -->
            <div class="space-y-1.5 my-auto">
                <div class="flex items-center justify-between gap-1">
                    <span
                        class="text-[9.5px] font-bold ios-vibrant-secondary tracking-wider uppercase truncate"
                    >
                        {monthYearHeader}
                    </span>

                    <div class="flex items-center gap-0.5 shrink-0">
                        <button
                            type="button"
                            onclick={(e) => stepMonth(-1, e)}
                            title="Previous Month"
                            class="size-4.5 rounded-full hover:bg-white/15 flex items-center justify-center text-white/70 hover:text-white transition-colors cursor-pointer"
                        >
                            <ChevronLeft class="size-3" />
                        </button>
                        <button
                            type="button"
                            onclick={(e) => stepMonth(1, e)}
                            title="Next Month"
                            class="size-4.5 rounded-full hover:bg-white/15 flex items-center justify-center text-white/70 hover:text-white transition-colors cursor-pointer"
                        >
                            <ChevronRight class="size-3" />
                        </button>
                    </div>
                </div>

                <div
                    class="grid grid-cols-7 {isLarge
                        ? 'gap-y-1.5 text-[10.5px]'
                        : 'gap-y-0.5 text-[9.5px]'} text-center ios-tabular-nums"
                >
                    {#each ["M", "T", "W", "T", "F", "S", "S"] as wd}
                        <span class="text-white/35 font-semibold">{wd}</span>
                    {/each}
                    {#each miniMonthDays as d}
                        {#if d === null}
                            <span></span>
                        {:else}
                            {@const isToday = isCurrentMonth && d === todayDay}
                            {@const isSelected = d === activeDay}
                            {@const dots = dayDotsMap.get(d) ?? []}
                            <button
                                type="button"
                                onclick={() => (selectedDay = d)}
                                ondblclick={(e) =>
                                    openFullModal(
                                        e,
                                        toIsoDate(viewedYear, viewedMonth, d),
                                    )}
                                class="relative {isLarge
                                    ? 'size-6'
                                    : 'size-4.5'} mx-auto flex flex-col items-center justify-center rounded-full transition-colors cursor-pointer {isSelected
                                    ? isToday
                                        ? 'bg-[#FF453A] text-white font-bold shadow-xs'
                                        : 'bg-white text-black font-bold'
                                    : isToday
                                      ? 'text-[#FF453A] font-bold hover:bg-white/10'
                                      : 'text-white/75 hover:bg-white/10'}"
                            >
                                <span>{d}</span>
                                {#if dots.length > 0 && !isSelected}
                                    <span
                                        class="absolute -bottom-0.5 flex items-center gap-0.5"
                                    >
                                        {#each dots as c}
                                            <span
                                                style="background: {c};"
                                                class="size-1 rounded-full"
                                            ></span>
                                        {/each}
                                    </span>
                                {/if}
                            </button>
                        {/if}
                    {/each}
                </div>
            </div>
        </div>
    {:else}
        <!-- Small (2x2) Header: Weekday + Date + Day Steppers + Sync & Expand Buttons -->
        <div class="flex items-start justify-between shrink-0">
            <div>
                <div
                    class="text-[10px] font-bold tracking-wider text-[#FF453A] uppercase leading-none"
                >
                    {weekdayHeader.slice(0, 3)} • {monthYearHeader}
                </div>
                <div class="flex items-center gap-1.5 mt-0.5">
                    <span
                        class="text-3xl font-light text-white ios-tabular-nums leading-none"
                    >
                        {activeDay}
                    </span>
                    <div class="flex items-center">
                        <button
                            type="button"
                            onclick={(e) => stepDay(-1, e)}
                            title="Previous Day"
                            class="size-4.5 rounded-full hover:bg-white/15 flex items-center justify-center text-white/60 hover:text-white cursor-pointer"
                        >
                            <ChevronLeft class="size-3" />
                        </button>
                        <button
                            type="button"
                            onclick={(e) => stepDay(1, e)}
                            title="Next Day"
                            class="size-4.5 rounded-full hover:bg-white/15 flex items-center justify-center text-white/60 hover:text-white cursor-pointer"
                        >
                            <ChevronRight class="size-3" />
                        </button>
                    </div>
                </div>
            </div>

            {#if !dashboard.isEditMode}
                <div class="flex items-center gap-1">
                    {#if !isViewingToday}
                        <button
                            type="button"
                            onclick={resetToToday}
                            title="Back to Today"
                            class="size-6 rounded-full bg-[#FF453A]/20 text-[#FF453A] hover:bg-[#FF453A] hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                        >
                            <RotateCcw class="size-3" />
                        </button>
                    {/if}

                    {#if hasConfiguredFeeds}
                        <button
                            type="button"
                            onclick={handleSyncNow}
                            title={failedFeed
                                ? `Sync error: ${failedFeed.error}`
                                : "Refresh .ics Calendar Feeds"}
                            class="size-6 rounded-full bg-white/10 hover:bg-white/20 text-white/75 hover:text-white flex items-center justify-center transition-all cursor-pointer"
                        >
                            {#if failedFeed}
                                <AlertCircle class="size-3 text-[#FF9F0A]" />
                            {:else}
                                <RefreshCw
                                    class="size-3 {isSyncing
                                        ? 'animate-spin text-primary'
                                        : ''}"
                                />
                            {/if}
                        </button>
                    {:else}
                        <button
                            type="button"
                            onclick={openFeedSetup}
                            title="Connect Google, Apple, or Outlook .ics Feed"
                            class="size-6 rounded-full bg-white/10 hover:bg-primary text-white/75 hover:text-white flex items-center justify-center transition-all cursor-pointer"
                        >
                            <Link2 class="size-3" />
                        </button>
                    {/if}

                    <button
                        type="button"
                        onclick={(e) => openFullModal(e)}
                        title="Open Full Calendar"
                        class="size-6 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white flex items-center justify-center transition-all cursor-pointer"
                    >
                        <Maximize2 class="size-3" />
                    </button>
                </div>
            {/if}
        </div>
    {/if}

    <!-- Right / Bottom Column: Read-Only .ics Event Timeline -->
    <div class="flex-1 min-w-0 flex flex-col justify-between gap-1.5 h-full">
        {#if isWide}
            <div class="flex items-center justify-between gap-1.5 shrink-0">
                <div class="flex items-center gap-1.5 min-w-0">
                    <span
                        class="text-[10.5px] font-semibold uppercase tracking-wider ios-vibrant-secondary truncate"
                    >
                        {isViewingToday
                            ? "Today's Schedule"
                            : `${monthYearHeader} ${activeDay}`}
                    </span>
                    {#if failedFeed}
                        <button
                            type="button"
                            onclick={openFeedSetup}
                            title="Feed sync error: {failedFeed.error}. Click to configure."
                            class="px-1.5 py-0.5 rounded-full bg-[#FF453A]/20 text-[#FF453A] text-[9px] font-bold flex items-center gap-0.5 cursor-pointer"
                        >
                            <AlertCircle class="size-2.5" />
                            <span>Feed Error</span>
                        </button>
                    {/if}
                </div>

                {#if !dashboard.isEditMode}
                    <div class="flex items-center gap-1 shrink-0">
                        {#if hasConfiguredFeeds}
                            <button
                                type="button"
                                onclick={handleSyncNow}
                                title="Refresh .ics Calendar Feeds"
                                class="size-5.5 rounded-full bg-white/10 hover:bg-white/20 text-white/75 hover:text-white flex items-center justify-center transition-all cursor-pointer"
                            >
                                <RefreshCw
                                    class="size-2.5 {isSyncing
                                        ? 'animate-spin text-primary'
                                        : ''}"
                                />
                            </button>
                        {:else}
                            <button
                                type="button"
                                onclick={openFeedSetup}
                                title="Connect Google, Apple, or Outlook .ics Feed"
                                class="px-2 py-0.5 rounded-full bg-white/10 hover:bg-primary text-white/80 hover:text-white text-[9.5px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                            >
                                <Link2 class="size-2.5" />
                                <span>.ics</span>
                            </button>
                        {/if}

                        <button
                            type="button"
                            onclick={(e) => openFullModal(e)}
                            title="Expand Full Calendar View"
                            class="size-5.5 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white flex items-center justify-center transition-all cursor-pointer"
                        >
                            <Maximize2 class="size-2.5" />
                        </button>
                    </div>
                {/if}
            </div>
        {/if}

        <div class="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-0.5">
            {#each dayEvents as ev, idx (ev.id)}
                {@const barColor =
                    ev.color ?? EVENT_COLORS[idx % EVENT_COLORS.length]}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                    onclick={(e) => openFullModal(e, ev.date ?? activeIso)}
                    title="{ev.title} ({ev.time})"
                    class="group relative ios-nested-surface pl-3 pr-2 py-1.5 flex items-start justify-between gap-1.5 overflow-hidden cursor-pointer"
                >
                    <span
                        style="background: {barColor};"
                        class="absolute left-0 top-1 bottom-1 w-1 rounded-r-full"
                    ></span>

                    <div class="min-w-0 flex-1 space-y-0.5">
                        <!-- Full-width Event Title (wraps up to 2 lines, never squeezed by time) -->
                        <div
                            class="text-xs font-semibold text-white/95 leading-snug line-clamp-2 break-words"
                        >
                            {ev.title}
                        </div>

                        <!-- Secondary Metadata Line: Time + Feed Name + Location -->
                        <div
                            class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] ios-vibrant-secondary ios-tabular-nums"
                        >
                            <span class="font-medium text-white/65 shrink-0">
                                {ev.time}
                            </span>

                            {#if ev.feedName && isWide}
                                <span
                                    class="text-[9.5px] text-white/45 truncate max-w-[90px]"
                                >
                                    • {ev.feedName}
                                </span>
                            {/if}

                            {#if ev.location}
                                <span
                                    class="inline-flex items-center gap-0.5 text-white/45 truncate max-w-full"
                                >
                                    <MapPin class="size-2.5 shrink-0" />
                                    <span class="truncate">{ev.location}</span>
                                </span>
                            {/if}
                        </div>
                    </div>
                </div>
            {:else}
                {#if upcomingInViewedMonth.length > 0}
                    <div class="space-y-1.5 pt-0.5">
                        <div
                            class="text-[9.5px] font-semibold uppercase tracking-wider text-white/40 px-1 truncate"
                        >
                            Coming Up in {monthYearHeader}
                        </div>
                        {#each upcomingInViewedMonth as upEv (upEv.id)}
                            <button
                                type="button"
                                onclick={(e) => openFullModal(e, upEv.date)}
                                title="{upEv.title} ({formatShortIsoDate(
                                    upEv.date,
                                )} • {upEv.time})"
                                style="border-left: 2.5px solid {upEv.color ||
                                    '#0A84FF'};"
                                class="w-full text-left ios-nested-surface px-2.5 py-1.5 rounded-lg flex flex-col gap-0.5 opacity-90 hover:opacity-100 transition-opacity cursor-pointer"
                            >
                                <span
                                    class="text-[11.5px] font-semibold text-white/95 leading-snug line-clamp-2 break-words"
                                >
                                    {upEv.title}
                                </span>
                                <span
                                    class="text-[10px] text-white/55 ios-tabular-nums"
                                >
                                    {formatShortIsoDate(upEv.date)} • {upEv.time}
                                </span>
                            </button>
                        {/each}
                    </div>
                {:else}
                    <div
                        class="w-full h-full flex flex-col items-center justify-center gap-1 text-center"
                    >
                        <button
                            type="button"
                            onclick={(e) => openFullModal(e)}
                            class="text-xs ios-vibrant-secondary hover:text-white/85 transition-colors cursor-pointer"
                        >
                            {hasConfiguredFeeds
                                ? `No events on ${monthYearHeader} ${activeDay}`
                                : "No .ics calendar connected"}
                        </button>
                        <div class="flex items-center gap-2 text-[10px]">
                            {#if !hasConfiguredFeeds && node.id !== "gallery-preview-node"}
                                <button
                                    type="button"
                                    onclick={openFeedSetup}
                                    class="text-primary font-semibold hover:underline cursor-pointer"
                                >
                                    Connect .ics Feed
                                </button>
                            {:else}
                                <button
                                    type="button"
                                    onclick={(e) => openFullModal(e)}
                                    class="text-white/70 font-semibold hover:text-white hover:underline cursor-pointer"
                                >
                                    Open Full Calendar
                                </button>
                            {/if}
                        </div>
                    </div>
                {/if}
            {/each}

            {#if isLarge && dayEvents.length > 0 && upcomingInViewedMonth.length > 0}
                <div class="pt-2 space-y-1.5 border-t border-white/8">
                    <div
                        class="text-[9.5px] font-semibold uppercase tracking-wider text-white/40 px-1"
                    >
                        Later in {monthYearHeader}
                    </div>
                    {#each upcomingInViewedMonth.slice(0, 4) as upEv (upEv.id)}
                        <button
                            type="button"
                            onclick={(e) => openFullModal(e, upEv.date)}
                            title="{upEv.title} ({formatShortIsoDate(
                                upEv.date,
                            )} • {upEv.time})"
                            style="border-left: 2.5px solid {upEv.color ||
                                '#0A84FF'};"
                            class="w-full text-left ios-nested-surface px-2.5 py-1.5 rounded-lg flex flex-col gap-0.5 opacity-90 hover:opacity-100 transition-opacity cursor-pointer"
                        >
                            <span
                                class="text-[11.5px] font-semibold text-white/95 leading-snug line-clamp-2 break-words"
                            >
                                {upEv.title}
                            </span>
                            <span
                                class="text-[10px] text-white/55 ios-tabular-nums"
                            >
                                {formatShortIsoDate(upEv.date)} • {upEv.time}
                            </span>
                        </button>
                    {/each}
                </div>
            {/if}
        </div>
    </div>
</div>
