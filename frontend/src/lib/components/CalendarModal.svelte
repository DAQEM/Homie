<script lang="ts">
    import {
        Calendar as CalendarIcon,
        ChevronLeft,
        ChevronRight,
        Clock,
        ExternalLink,
        Link2,
        ListFilter,
        MapPin,
        RefreshCw,
        Search,
        SlidersHorizontal,
        X,
    } from "@lucide/svelte";
    import { dashboard } from "../state/dashboard.svelte";
    import type { CalendarEvent } from "../types";

    type CalendarViewMode = "month" | "week" | "agenda";

    interface PositionedWeekEvent {
        event: CalendarEvent;
        startMin: number;
        endMin: number;
        topPx: number;
        heightPx: number;
        colIndex: number;
        totalCols: number;
    }

    const HOUR_HEIGHT = 56; // 56px per hour = 1344px for 24 hours
    const HOURS = Array.from({ length: 24 }, (_, i) => i);

    const MONTH_NAMES = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ];

    let node = $derived(dashboard.openCalendarNode);
    let now = $derived(dashboard.now);

    let viewMode = $state<CalendarViewMode>("month");
    let viewedYear = $state(new Date().getFullYear());
    let viewedMonth = $state(new Date().getMonth());
    let selectedDateIso = $state("");
    let selectedEventId = $state<string | null>(null);
    let searchQuery = $state("");
    let hiddenFeedIds = $state<Record<string, boolean>>({});
    let weekScrollEl: HTMLDivElement | undefined = $state();

    function toIsoDate(y: number, m: number, d: number): string {
        return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }

    function parseIsoDate(iso: string): Date {
        const [y, m, d] = iso.split("-").map(Number);
        return new Date(y || 2026, (m || 1) - 1, d || 1);
    }

    function getISOWeekNumber(date: Date): number {
        const target = new Date(
            Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
        );
        const dayNr = (target.getUTCDay() + 6) % 7;
        target.setUTCDate(target.getUTCDate() - dayNr + 3);
        const firstThursday = target.valueOf();
        target.setUTCMonth(0, 1);
        if (target.getUTCDay() !== 4) {
            target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
        }
        return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
    }

    function isEventAllDay(ev: CalendarEvent): boolean {
        return Boolean(
            ev.isAllDay || ev.time.trim().toLowerCase() === "all day",
        );
    }

    function parseTimedEventMinutes(ev: CalendarEvent): {
        startMin: number;
        endMin: number;
    } {
        const match = ev.time.match(
            /(\d{1,2}):(\d{2})(?:\s*-\s*(\d{1,2}):(\d{2}))?/,
        );
        if (!match) {
            return { startMin: 9 * 60, endMin: 10 * 60 };
        }
        const h1 = Math.min(23, Math.max(0, Number(match[1])));
        const m1 = Math.min(59, Math.max(0, Number(match[2])));
        const startMin = h1 * 60 + m1;

        let endMin = startMin + 60;
        if (match[3] !== undefined && match[4] !== undefined) {
            const h2 = Math.min(24, Math.max(0, Number(match[3])));
            const m2 = Math.min(59, Math.max(0, Number(match[4])));
            const parsedEnd = h2 * 60 + m2;
            endMin = parsedEnd > startMin ? parsedEnd : 24 * 60;
        }

        return {
            startMin,
            endMin: Math.min(24 * 60, Math.max(endMin, startMin + 25)),
        };
    }

    /**
     * Packs overlapping timed events on a single day into non-overlapping columns
     * and computes exact vertical pixel coordinates on the 24-hour timeline.
     */
    function layoutDayTimedEvents(
        events: CalendarEvent[],
    ): PositionedWeekEvent[] {
        if (events.length === 0) return [];

        const items = events
            .map((event) => {
                const { startMin, endMin } = parseTimedEventMinutes(event);
                return { event, startMin, endMin };
            })
            .sort(
                (a, b) =>
                    a.startMin - b.startMin ||
                    b.endMin - b.startMin - (a.endMin - a.startMin),
            );

        const results: PositionedWeekEvent[] = [];
        let cluster: typeof items = [];
        let clusterMaxEnd = -1;

        const flushCluster = (group: typeof items) => {
            if (group.length === 0) return;
            const colEnds: number[] = [];
            const placed: {
                item: (typeof items)[0];
                colIndex: number;
            }[] = [];

            for (const item of group) {
                let assignedCol = -1;
                for (let c = 0; c < colEnds.length; c++) {
                    if (colEnds[c] <= item.startMin) {
                        assignedCol = c;
                        colEnds[c] = item.endMin;
                        break;
                    }
                }
                if (assignedCol === -1) {
                    assignedCol = colEnds.length;
                    colEnds.push(item.endMin);
                }
                placed.push({ item, colIndex: assignedCol });
            }

            const totalCols = colEnds.length;
            for (const p of placed) {
                const topPx = (p.item.startMin / 60) * HOUR_HEIGHT;
                const heightPx = Math.max(
                    22,
                    ((p.item.endMin - p.item.startMin) / 60) * HOUR_HEIGHT - 2,
                );
                results.push({
                    event: p.item.event,
                    startMin: p.item.startMin,
                    endMin: p.item.endMin,
                    topPx,
                    heightPx,
                    colIndex: p.colIndex,
                    totalCols,
                });
            }
        };

        for (const item of items) {
            if (cluster.length > 0 && item.startMin >= clusterMaxEnd) {
                flushCluster(cluster);
                cluster = [];
                clusterMaxEnd = -1;
            }
            cluster.push(item);
            if (item.endMin > clusterMaxEnd) {
                clusterMaxEnd = item.endMin;
            }
        }
        flushCluster(cluster);

        return results;
    }

    let todayIso = $derived(
        toIsoDate(now.getFullYear(), now.getMonth(), now.getDate()),
    );

    let nowMinutes = $derived(now.getHours() * 60 + now.getMinutes());
    let nowTopPx = $derived((nowMinutes / 60) * HOUR_HEIGHT);

    // Initialize viewed month and selected date when the modal opens
    $effect(() => {
        if (node) {
            const initIso = dashboard.openCalendarInitialDate || todayIso;
            selectedDateIso = initIso;
            const parsed = parseIsoDate(initIso);
            viewedYear = parsed.getFullYear();
            viewedMonth = parsed.getMonth();
            selectedEventId = null;
            searchQuery = "";
        }
    });

    // Auto-scroll the 24-hour Week View to 07:30 when entering Week View
    $effect(() => {
        if (viewMode === "week" && weekScrollEl) {
            queueMicrotask(() => {
                if (weekScrollEl) {
                    weekScrollEl.scrollTop = Math.round(7.5 * HOUR_HEIGHT);
                }
            });
        }
    });

    let morphStyle = $derived.by(() => {
        const origin = dashboard.openCalendarOrigin;
        if (!origin || typeof window === "undefined") {
            return "--folder-dx: 0px; --folder-dy: 40px; --folder-sx: 0.25; --folder-sy: 0.25;";
        }
        const dx = Math.round(origin.cx - window.innerWidth / 2);
        const dy = Math.round(origin.cy - window.innerHeight / 2);
        return `--folder-dx: ${dx}px; --folder-dy: ${dy}px; --folder-sx: 0.24; --folder-sy: 0.24;`;
    });

    let rawEvents = $derived<CalendarEvent[]>(
        node ? dashboard.getCalendarEventsForNode(node) : [],
    );

    let syncStatus = $derived(
        node ? dashboard.getCalendarStatusForNode(node.id) : null,
    );
    let isSyncing = $derived(
        Boolean(node && dashboard.syncingCalendarNodes[node.id]),
    );

    // Distinct .ics feed sources for the filter bar
    let availableFeeds = $derived.by(() => {
        const feeds: { id: string; name: string; color: string }[] = [];
        const seen = new Set<string>();

        for (const f of node?.settings?.calendarFeeds ?? []) {
            if (!seen.has(f.id)) {
                seen.add(f.id);
                feeds.push({
                    id: f.id,
                    name: f.name || "Subscribed",
                    color: f.color || "#0A84FF",
                });
            }
        }
        return feeds;
    });

    let filteredEvents = $derived.by<CalendarEvent[]>(() => {
        const q = searchQuery.trim().toLowerCase();
        return rawEvents.filter((ev) => {
            const feedKey = ev.feedId ?? "ical";
            if (hiddenFeedIds[feedKey]) return false;

            if (!q) return true;
            return (
                ev.title.toLowerCase().includes(q) ||
                ev.time.toLowerCase().includes(q) ||
                Boolean(ev.location && ev.location.toLowerCase().includes(q)) ||
                Boolean(
                    ev.description && ev.description.toLowerCase().includes(q),
                ) ||
                Boolean(ev.feedName && ev.feedName.toLowerCase().includes(q))
            );
        });
    });

    // Map YYYY-MM-DD -> CalendarEvent[]
    let eventsByDate = $derived.by(() => {
        const map = new Map<string, CalendarEvent[]>();
        for (const ev of filteredEvents) {
            const dKey = ev.date || todayIso;
            const list = map.get(dKey) ?? [];
            list.push(ev);
            map.set(dKey, list);
        }
        return map;
    });

    // Build 6-week (42-cell) full month grid with leading/trailing days and ISO week numbers
    let monthWeeks = $derived.by(() => {
        const firstOfMonth = new Date(viewedYear, viewedMonth, 1);
        const leadingDays = (firstOfMonth.getDay() + 6) % 7; // Monday = 0
        const gridStart = new Date(viewedYear, viewedMonth, 1 - leadingDays);

        const weeks: {
            weekNum: number;
            days: {
                iso: string;
                dayNum: number;
                isCurrentMonth: boolean;
                isToday: boolean;
                isWeekend: boolean;
                events: CalendarEvent[];
            }[];
        }[] = [];

        for (let w = 0; w < 6; w++) {
            const rowStart = new Date(
                gridStart.getFullYear(),
                gridStart.getMonth(),
                gridStart.getDate() + w * 7,
            );
            const weekNum = getISOWeekNumber(rowStart);
            const days = [];

            for (let d = 0; d < 7; d++) {
                const cellDate = new Date(
                    rowStart.getFullYear(),
                    rowStart.getMonth(),
                    rowStart.getDate() + d,
                );
                const iso = toIsoDate(
                    cellDate.getFullYear(),
                    cellDate.getMonth(),
                    cellDate.getDate(),
                );
                days.push({
                    iso,
                    dayNum: cellDate.getDate(),
                    isCurrentMonth: cellDate.getMonth() === viewedMonth,
                    isToday: iso === todayIso,
                    isWeekend: d >= 5,
                    events: eventsByDate.get(iso) ?? [],
                });
            }
            weeks.push({ weekNum, days });
        }
        return weeks;
    });

    // Build 7-day week columns with separate All-Day and positioned Timed events
    let weekColumns = $derived.by(() => {
        const sel = parseIsoDate(selectedDateIso || todayIso);
        const offsetToMonday = (sel.getDay() + 6) % 7;
        const monday = new Date(
            sel.getFullYear(),
            sel.getMonth(),
            sel.getDate() - offsetToMonday,
        );

        const cols = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(
                monday.getFullYear(),
                monday.getMonth(),
                monday.getDate() + i,
            );
            const iso = toIsoDate(d.getFullYear(), d.getMonth(), d.getDate());
            const dayEvs = eventsByDate.get(iso) ?? [];
            const allDayEvents = dayEvs.filter((ev) => isEventAllDay(ev));
            const timedEvents = dayEvs.filter((ev) => !isEventAllDay(ev));

            cols.push({
                iso,
                weekdayShort: new Intl.DateTimeFormat("en-US", {
                    weekday: "short",
                }).format(d),
                dayNum: d.getDate(),
                monthShort: new Intl.DateTimeFormat("en-US", {
                    month: "short",
                }).format(d),
                isToday: iso === todayIso,
                isWeekend: i >= 5,
                allDayEvents,
                positionedTimedEvents: layoutDayTimedEvents(timedEvents),
            });
        }
        return cols;
    });

    let weekNumberLabel = $derived(
        `CW ${getISOWeekNumber(parseIsoDate(selectedDateIso || todayIso))}`,
    );

    // Grouped chronological Agenda items
    let agendaGroups = $derived.by(() => {
        const groups: {
            iso: string;
            label: string;
            isToday: boolean;
            events: CalendarEvent[];
        }[] = [];

        const sortedDates = Array.from(eventsByDate.keys()).sort();
        const floorIso = searchQuery.trim()
            ? "0000-00-00"
            : toIsoDate(viewedYear, viewedMonth, 1);

        for (const iso of sortedDates) {
            if (iso < floorIso) continue;
            const evs = eventsByDate.get(iso) ?? [];
            if (evs.length === 0) continue;
            const dObj = parseIsoDate(iso);
            const label = new Intl.DateTimeFormat("en-US", {
                weekday: "long",
                month: "short",
                day: "numeric",
                year: "numeric",
            }).format(dObj);
            groups.push({
                iso,
                label,
                isToday: iso === todayIso,
                events: evs,
            });
        }
        return groups.slice(0, 60);
    });

    let selectedDayEvents = $derived(
        eventsByDate.get(selectedDateIso || todayIso) ?? [],
    );

    let activeInspectedEvent = $derived(
        selectedDayEvents.find((e) => e.id === selectedEventId) ??
            filteredEvents.find((e) => e.id === selectedEventId) ??
            null,
    );

    let selectedDateFormatted = $derived.by(() => {
        const d = parseIsoDate(selectedDateIso || todayIso);
        return new Intl.DateTimeFormat("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
        }).format(d);
    });

    function stepPeriod(delta: number) {
        if (viewMode === "week") {
            const cur = parseIsoDate(selectedDateIso || todayIso);
            const next = new Date(
                cur.getFullYear(),
                cur.getMonth(),
                cur.getDate() + delta * 7,
            );
            viewedYear = next.getFullYear();
            viewedMonth = next.getMonth();
            selectedDateIso = toIsoDate(
                next.getFullYear(),
                next.getMonth(),
                next.getDate(),
            );
            return;
        }
        const nextMonthDate = new Date(viewedYear, viewedMonth + delta, 1);
        viewedYear = nextMonthDate.getFullYear();
        viewedMonth = nextMonthDate.getMonth();
        selectedDateIso = toIsoDate(viewedYear, viewedMonth, 1);
    }

    function jumpToToday() {
        const t = dashboard.now;
        viewedYear = t.getFullYear();
        viewedMonth = t.getMonth();
        selectedDateIso = todayIso;
        selectedEventId = null;
        if (viewMode === "week" && weekScrollEl) {
            weekScrollEl.scrollTo({
                top: Math.max(0, nowTopPx - 180),
                behavior: "smooth",
            });
        }
    }

    function selectDayCell(iso: string) {
        selectedDateIso = iso;
        const parsed = parseIsoDate(iso);
        if (
            parsed.getMonth() !== viewedMonth ||
            parsed.getFullYear() !== viewedYear
        ) {
            viewedMonth = parsed.getMonth();
            viewedYear = parsed.getFullYear();
        }
        selectedEventId = null;
    }

    function toggleFeedFilter(feedId: string) {
        hiddenFeedIds[feedId] = !hiddenFeedIds[feedId];
    }

    function handleConfigureFeeds(e: MouseEvent) {
        if (!node) return;
        const targetNode = node;
        dashboard.closeCalendarModal();
        dashboard.inspectNode(targetNode, e);
    }
</script>

{#if node}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
        role="dialog"
        aria-modal="true"
        aria-label="{node.title} Calendar"
        tabindex="-1"
        onclick={(e) =>
            e.target === e.currentTarget && dashboard.closeCalendarModal()}
        class="fixed inset-0 z-50 bg-black/50 backdrop-blur-2xl flex items-center justify-center p-3 sm:p-6 select-none"
    >
        <div
            style={morphStyle}
            class="w-full max-w-[1260px] h-[86vh] max-h-[860px] ios-modal-surface rounded-[32px] flex flex-col overflow-hidden shadow-2xl text-white ios-folder-morph"
        >
            <!-- Top iPadOS Calendar Toolbar -->
            <header
                class="px-5 py-3.5 border-b border-white/10 flex flex-wrap items-center justify-between gap-3 shrink-0 bg-black/15"
            >
                <!-- Left: Month & Year Selector + Navigation Steppers -->
                <div class="flex items-center gap-3">
                    <div class="flex items-center gap-1.5">
                        <select
                            aria-label="Month"
                            value={viewedMonth}
                            onchange={(e) => {
                                viewedMonth = Number(
                                    (e.currentTarget as HTMLSelectElement)
                                        .value,
                                );
                                selectedDateIso = toIsoDate(
                                    viewedYear,
                                    viewedMonth,
                                    1,
                                );
                            }}
                            class="bg-transparent text-xl font-bold text-white ios-tight-tracking focus:outline-none cursor-pointer pr-1"
                        >
                            {#each MONTH_NAMES as mName, mIdx (mName)}
                                <option
                                    value={mIdx}
                                    class="bg-[#181920] text-white"
                                >
                                    {mName}
                                </option>
                            {/each}
                        </select>

                        <select
                            aria-label="Year"
                            value={viewedYear}
                            onchange={(e) => {
                                viewedYear = Number(
                                    (e.currentTarget as HTMLSelectElement)
                                        .value,
                                );
                                selectedDateIso = toIsoDate(
                                    viewedYear,
                                    viewedMonth,
                                    1,
                                );
                            }}
                            class="bg-transparent text-xl font-light text-white/75 ios-tabular-nums focus:outline-none cursor-pointer"
                        >
                            {#each Array.from({ length: 11 }, (_, i) => now.getFullYear() - 5 + i) as yr (yr)}
                                <option
                                    value={yr}
                                    class="bg-[#181920] text-white"
                                >
                                    {yr}
                                </option>
                            {/each}
                        </select>
                    </div>

                    <div
                        class="flex items-center gap-1 bg-white/8 rounded-full p-0.5 border border-white/8"
                    >
                        <button
                            type="button"
                            onclick={() => stepPeriod(-1)}
                            title="Previous"
                            class="size-7 rounded-full hover:bg-white/15 flex items-center justify-center text-white/80 hover:text-white transition-colors cursor-pointer"
                        >
                            <ChevronLeft class="size-4" />
                        </button>
                        <button
                            type="button"
                            onclick={jumpToToday}
                            class="px-2.5 py-0.5 rounded-full text-xs font-semibold text-white/90 hover:bg-white/15 transition-colors cursor-pointer"
                        >
                            Today
                        </button>
                        <button
                            type="button"
                            onclick={() => stepPeriod(1)}
                            title="Next"
                            class="size-7 rounded-full hover:bg-white/15 flex items-center justify-center text-white/80 hover:text-white transition-colors cursor-pointer"
                        >
                            <ChevronRight class="size-4" />
                        </button>
                    </div>
                </div>

                <!-- Center: iPadOS Segmented View Switcher (Month | Week | Agenda) -->
                <div
                    class="flex items-center gap-1 p-1 rounded-full bg-black/35 border border-white/10"
                >
                    {#each [{ id: "month", label: "Month" }, { id: "week", label: "Week" }, { id: "agenda", label: "Agenda" }] as tab (tab.id)}
                        <button
                            type="button"
                            onclick={() =>
                                (viewMode = tab.id as CalendarViewMode)}
                            class="px-3.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer {viewMode ===
                            tab.id
                                ? 'bg-[#FF453A] text-white shadow-xs'
                                : 'text-white/65 hover:text-white'}"
                        >
                            {tab.label}
                        </button>
                    {/each}
                </div>

                <!-- Right: Search, Sync, Feed Config & Close -->
                <div class="flex items-center gap-2">
                    <div
                        class="ios-input px-3 py-1.5 rounded-full flex items-center gap-1.5 w-44 sm:w-52"
                    >
                        <Search class="size-3.5 text-white/45 shrink-0" />
                        <input
                            type="text"
                            bind:value={searchQuery}
                            placeholder="Filter events..."
                            class="w-full bg-transparent text-xs text-white placeholder:text-white/40 focus:outline-none"
                        />
                        {#if searchQuery}
                            <button
                                type="button"
                                onclick={() => (searchQuery = "")}
                                class="text-white/50 hover:text-white cursor-pointer"
                            >
                                <X class="size-3" />
                            </button>
                        {/if}
                    </div>

                    <button
                        type="button"
                        onclick={() => dashboard.syncCalendarNodeNow(node.id)}
                        title="Sync .ics Feeds Now"
                        class="size-8 rounded-full bg-white/10 hover:bg-white/18 flex items-center justify-center text-white/85 cursor-pointer"
                    >
                        <RefreshCw
                            class="size-3.5 {isSyncing
                                ? 'animate-spin text-primary'
                                : ''}"
                        />
                    </button>

                    <button
                        type="button"
                        onclick={handleConfigureFeeds}
                        title="Configure .ics Feeds"
                        class="px-3 py-1.5 rounded-full bg-white/10 hover:bg-primary text-xs font-semibold text-white/90 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                        <SlidersHorizontal class="size-3.5" />
                        <span class="hidden md:inline">Feeds</span>
                    </button>

                    <button
                        type="button"
                        onclick={() => dashboard.closeCalendarModal()}
                        title="Close Calendar (Esc)"
                        class="size-8 rounded-full bg-white/12 hover:bg-white/22 flex items-center justify-center text-white cursor-pointer"
                    >
                        <X class="size-4" />
                    </button>
                </div>
            </header>

            <!-- Sub-Header: Calendar Feed Filter Pills & Sync Telemetry -->
            {#if availableFeeds.length > 0}
                <div
                    class="px-5 py-2 border-b border-white/8 bg-black/10 flex items-center justify-between gap-2 overflow-x-auto shrink-0"
                >
                    <div class="flex items-center gap-1.5">
                        <span
                            class="text-[10px] font-semibold uppercase tracking-wider text-white/45 flex items-center gap-1 mr-1"
                        >
                            <ListFilter class="size-3" />
                            Calendars:
                        </span>
                        {#each availableFeeds as feed (feed.id)}
                            {@const isHidden = Boolean(hiddenFeedIds[feed.id])}
                            <button
                                type="button"
                                onclick={() => toggleFeedFilter(feed.id)}
                                class="px-2.5 py-0.5 rounded-full text-[11px] font-medium flex items-center gap-1.5 transition-all cursor-pointer {isHidden
                                    ? 'bg-white/5 text-white/35 line-through'
                                    : 'bg-white/12 text-white hover:bg-white/18'}"
                            >
                                <span
                                    style="background: {feed.color};"
                                    class="size-2 rounded-full shrink-0 {isHidden
                                        ? 'opacity-35'
                                        : ''}"
                                ></span>
                                <span>{feed.name}</span>
                            </button>
                        {/each}
                    </div>

                    {#if syncStatus}
                        <span
                            class="text-[10.5px] text-white/45 ios-tabular-nums shrink-0"
                        >
                            {syncStatus.totalEvents} synced events
                        </span>
                    {/if}
                </div>
            {/if}

            <!-- Main Content Split: Left Calendar Stage + Right Day & Event Inspector -->
            <div
                class="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden"
            >
                <!-- Left Stage: Month / Week / Agenda View -->
                <div class="flex-1 min-w-0 flex flex-col overflow-hidden p-4">
                    {#if viewMode === "month"}
                        <!-- Weekday Column Headers (with CW column) -->
                        <div
                            class="grid grid-cols-[28px_repeat(7,minmax(0,1fr))] pb-2 text-center text-[11px] font-semibold uppercase tracking-wider text-white/45 shrink-0"
                        >
                            <span class="text-[9px] text-white/25">CW</span>
                            {#each ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as wd, idx}
                                <span class={idx >= 5 ? "text-white/30" : ""}>
                                    {wd}
                                </span>
                            {/each}
                        </div>

                        <!-- 6-Row Month Grid -->
                        <div class="flex-1 min-h-0 grid grid-rows-6 gap-1.5">
                            {#each monthWeeks as week (week.weekNum + ":" + week.days[0].iso)}
                                <div
                                    class="grid grid-cols-[28px_repeat(7,minmax(0,1fr))] gap-1.5 min-h-0"
                                >
                                    <!-- ISO Week Number -->
                                    <div
                                        class="flex items-center justify-center text-[10px] font-mono text-white/25 select-none"
                                    >
                                        {week.weekNum}
                                    </div>

                                    {#each week.days as day (day.iso)}
                                        {@const isSelected =
                                            day.iso === selectedDateIso}
                                        <button
                                            type="button"
                                            onclick={() =>
                                                selectDayCell(day.iso)}
                                            class="group/cell relative rounded-[14px] p-1.5 flex flex-col items-stretch text-left transition-all overflow-hidden cursor-pointer border {isSelected
                                                ? 'bg-white/14 border-[#FF453A]/80 shadow-[inset_0_0_0_1px_rgba(255,69,58,0.5)]'
                                                : day.isCurrentMonth
                                                  ? day.isWeekend
                                                      ? 'bg-white/[0.025] hover:bg-white/[0.07] border-white/[0.05]'
                                                      : 'bg-white/[0.045] hover:bg-white/[0.09] border-white/[0.07]'
                                                  : 'bg-black/20 hover:bg-white/[0.04] border-transparent opacity-40'}"
                                        >
                                            <div
                                                class="flex items-center justify-between mb-1 shrink-0"
                                            >
                                                <span
                                                    class="size-6 rounded-full text-xs font-semibold ios-tabular-nums flex items-center justify-center {day.isToday
                                                        ? 'bg-[#FF453A] text-white font-bold shadow-xs'
                                                        : isSelected
                                                          ? 'text-white font-bold'
                                                          : 'text-white/80'}"
                                                >
                                                    {day.dayNum}
                                                </span>

                                                {#if day.events.length > 0}
                                                    <span
                                                        class="text-[9.5px] font-semibold text-white/35 ios-tabular-nums"
                                                    >
                                                        {day.events.length}
                                                    </span>
                                                {/if}
                                            </div>

                                            <!-- Up to 3 Event Pills inside each Month Cell -->
                                            <div
                                                class="space-y-0.5 overflow-hidden flex-1"
                                            >
                                                {#each day.events.slice(0, 3) as ev (ev.id)}
                                                    <div
                                                        onclick={(e) => {
                                                            e.stopPropagation();
                                                            selectDayCell(
                                                                day.iso,
                                                            );
                                                            selectedEventId =
                                                                ev.id;
                                                        }}
                                                        title="{ev.title} ({ev.time})"
                                                        style="background: {(ev.color ||
                                                            '#0A84FF') +
                                                            '28'}; border-left: 2.5px solid {ev.color ||
                                                            '#0A84FF'};"
                                                        class="px-1.5 py-0.5 rounded-[5px] text-[10px] font-medium text-white/95 flex items-center justify-between gap-1 hover:brightness-125 transition-all"
                                                    >
                                                        <span
                                                            class="truncate font-semibold"
                                                            >{ev.title}</span
                                                        >
                                                        {#if !ev.isAllDay && ev.time !== "All day"}
                                                            <span
                                                                class="text-[9px] text-white/55 ios-tabular-nums shrink-0"
                                                            >
                                                                {ev.time.split(
                                                                    " ",
                                                                )[0]}
                                                            </span>
                                                        {/if}
                                                    </div>
                                                {/each}

                                                {#if day.events.length > 3}
                                                    <div
                                                        class="text-[9.5px] font-semibold text-white/50 pl-1"
                                                    >
                                                        +{day.events.length - 3} more
                                                    </div>
                                                {/if}
                                            </div>
                                        </button>
                                    {/each}
                                </div>
                            {/each}
                        </div>
                    {:else if viewMode === "week"}
                        <!-- iPadOS 24-Hour Time-Grid Week View with Pinned All-Day Header -->
                        <div
                            class="flex-1 min-h-0 flex flex-col rounded-[20px] border border-white/10 bg-black/20 overflow-hidden"
                        >
                            <!-- Sticky Top Header: 7 Day Columns -->
                            <div
                                class="grid grid-cols-[54px_repeat(7,minmax(0,1fr))] border-b border-white/10 bg-white/[0.03] shrink-0"
                            >
                                <!-- Top-Left Corner: ISO Week Number -->
                                <div
                                    class="py-2 px-1 flex flex-col items-center justify-center border-r border-white/8 text-[9.5px] font-mono text-white/35"
                                >
                                    {weekNumberLabel}
                                </div>

                                {#each weekColumns as col (col.iso)}
                                    {@const isSelected =
                                        col.iso === selectedDateIso}
                                    <button
                                        type="button"
                                        onclick={() => selectDayCell(col.iso)}
                                        class="py-2 px-1 flex flex-col items-center justify-center border-r last:border-r-0 border-white/8 transition-colors cursor-pointer {isSelected
                                            ? 'bg-white/10'
                                            : 'hover:bg-white/[0.05]'}"
                                    >
                                        <span
                                            class="text-[10px] font-bold uppercase tracking-wider {col.isToday
                                                ? 'text-[#FF453A]'
                                                : 'text-white/50'}"
                                        >
                                            {col.weekdayShort}
                                        </span>
                                        <span
                                            class="mt-0.5 size-7 rounded-full flex items-center justify-center text-sm font-semibold ios-tabular-nums {col.isToday
                                                ? 'bg-[#FF453A] text-white font-bold shadow-xs'
                                                : isSelected
                                                  ? 'bg-white text-black font-bold'
                                                  : 'text-white/90'}"
                                        >
                                            {col.dayNum}
                                        </span>
                                    </button>
                                {/each}
                            </div>

                            <!-- Sticky Pinned All-Day Row at the Top -->
                            <div
                                class="grid grid-cols-[54px_repeat(7,minmax(0,1fr))] border-b border-white/12 bg-black/25 shrink-0 min-h-[34px]"
                            >
                                <div
                                    class="px-1.5 py-1.5 flex items-center justify-end border-r border-white/8 text-[9.5px] font-semibold uppercase tracking-wider text-white/40"
                                >
                                    all-day
                                </div>

                                {#each weekColumns as col (col.iso)}
                                    <div
                                        onclick={() => selectDayCell(col.iso)}
                                        class="p-1 border-r last:border-r-0 border-white/8 space-y-1 max-h-[84px] overflow-y-auto cursor-pointer {col.iso ===
                                        selectedDateIso
                                            ? 'bg-white/[0.05]'
                                            : ''}"
                                    >
                                        {#each col.allDayEvents as ev (ev.id)}
                                            <button
                                                type="button"
                                                onclick={(e) => {
                                                    e.stopPropagation();
                                                    selectDayCell(col.iso);
                                                    selectedEventId = ev.id;
                                                }}
                                                title="{ev.title} (All day)"
                                                style="background: {(ev.color ||
                                                    '#0A84FF') +
                                                    '38'}; border-left: 3px solid {ev.color ||
                                                    '#0A84FF'};"
                                                class="w-full text-left px-1.5 py-0.5 rounded-[6px] text-[10px] font-semibold text-white truncate hover:brightness-125 transition-all cursor-pointer {selectedEventId ===
                                                ev.id
                                                    ? 'ring-1 ring-white'
                                                    : ''}"
                                            >
                                                {ev.title}
                                            </button>
                                        {/each}
                                    </div>
                                {/each}
                            </div>

                            <!-- Scrollable 24-Hour Time Grid -->
                            <div
                                bind:this={weekScrollEl}
                                class="flex-1 min-h-0 overflow-y-auto relative"
                            >
                                <div
                                    style="height: {24 * HOUR_HEIGHT}px;"
                                    class="relative grid grid-cols-[54px_repeat(7,minmax(0,1fr))]"
                                >
                                    <!-- Left Hour Labels Gutter (00:00 .. 23:00) -->
                                    <div
                                        class="relative border-r border-white/10 bg-black/20 select-none"
                                    >
                                        {#each HOURS as hr (hr)}
                                            <div
                                                style="top: {hr *
                                                    HOUR_HEIGHT}px; height: {HOUR_HEIGHT}px;"
                                                class="absolute inset-x-0 pr-2 flex items-start justify-end"
                                            >
                                                <span
                                                    class="-translate-y-2 text-[10px] font-medium text-white/40 ios-tabular-nums"
                                                >
                                                    {hr === 0
                                                        ? ""
                                                        : `${String(hr).padStart(2, "0")}:00`}
                                                </span>
                                            </div>
                                        {/each}
                                    </div>

                                    <!-- 7 Day Timeline Columns -->
                                    {#each weekColumns as col (col.iso)}
                                        {@const isSelected =
                                            col.iso === selectedDateIso}
                                        <div
                                            onclick={() =>
                                                selectDayCell(col.iso)}
                                            class="relative border-r last:border-r-0 border-white/8 transition-colors {isSelected
                                                ? 'bg-white/[0.035]'
                                                : col.isWeekend
                                                  ? 'bg-black/15'
                                                  : ''}"
                                        >
                                            <!-- Horizontal Hour & Half-Hour Grid Lines -->
                                            {#each HOURS as hr (hr)}
                                                <div
                                                    style="top: {hr *
                                                        HOUR_HEIGHT}px; height: {HOUR_HEIGHT}px;"
                                                    class="pointer-events-none absolute inset-x-0 border-t border-white/[0.07]"
                                                >
                                                    <div
                                                        class="mt-[28px] border-t border-dashed border-white/[0.03]"
                                                    ></div>
                                                </div>
                                            {/each}

                                            <!-- Live Current Time Red Indicator Line on Today -->
                                            {#if col.isToday}
                                                <div
                                                    style="top: {nowTopPx}px;"
                                                    class="pointer-events-none absolute inset-x-0 z-20 flex items-center"
                                                >
                                                    <span
                                                        class="-ml-1.5 size-2.5 rounded-full bg-[#FF453A] shadow-[0_0_8px_#FF453A]"
                                                    ></span>
                                                    <div
                                                        class="h-[1.5px] w-full bg-[#FF453A] shadow-[0_0_6px_#FF453A]"
                                                    ></div>
                                                </div>
                                            {/if}

                                            <!-- Positioned Timed Events -->
                                            {#each col.positionedTimedEvents as item (item.event.id)}
                                                {@const ev = item.event}
                                                {@const evColor =
                                                    ev.color || "#0A84FF"}
                                                {@const widthPct =
                                                    100 / item.totalCols}
                                                {@const leftPct =
                                                    item.colIndex * widthPct}
                                                <button
                                                    type="button"
                                                    onclick={(e) => {
                                                        e.stopPropagation();
                                                        selectDayCell(col.iso);
                                                        selectedEventId = ev.id;
                                                    }}
                                                    title="{ev.title} ({ev.time}){ev.location
                                                        ? ` • ${ev.location}`
                                                        : ''}"
                                                    style="top: {item.topPx}px; height: {item.heightPx}px; left: calc({leftPct}% + 2px); width: calc({widthPct}% - 4px); background: linear-gradient(165deg, {evColor}38 0%, {evColor}22 100%); border-left: 3px solid {evColor};"
                                                    class="absolute z-10 rounded-[8px] px-1.5 py-1 text-left overflow-hidden backdrop-blur-md shadow-sm hover:brightness-125 hover:z-30 transition-all cursor-pointer flex flex-col justify-start {selectedEventId ===
                                                    ev.id
                                                        ? 'ring-1.5 ring-white z-30'
                                                        : 'border border-white/10'}"
                                                >
                                                    <div
                                                        class="text-[10.5px] font-semibold text-white leading-tight {item.heightPx <
                                                        36
                                                            ? 'truncate'
                                                            : 'line-clamp-2'} break-words"
                                                    >
                                                        {ev.title}
                                                    </div>

                                                    {#if item.heightPx >= 34}
                                                        <div
                                                            class="text-[9.5px] text-white/70 ios-tabular-nums truncate mt-0.5"
                                                        >
                                                            {ev.time}
                                                        </div>
                                                    {/if}

                                                    {#if item.heightPx >= 54 && ev.location}
                                                        <div
                                                            class="text-[9px] text-white/55 truncate flex items-center gap-0.5 mt-0.5"
                                                        >
                                                            <MapPin
                                                                class="size-2.5 shrink-0"
                                                            />
                                                            <span
                                                                class="truncate"
                                                                >{ev.location}</span
                                                            >
                                                        </div>
                                                    {/if}
                                                </button>
                                            {/each}
                                        </div>
                                    {/each}
                                </div>
                            </div>
                        </div>
                    {:else}
                        <!-- Chronological Multi-Month Agenda View -->
                        <div
                            class="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1"
                        >
                            {#each agendaGroups as group (group.iso)}
                                <div class="space-y-1.5">
                                    <div
                                        class="sticky top-0 z-10 backdrop-blur-md bg-[#181922]/85 px-3 py-1.5 rounded-xl flex items-center justify-between border border-white/8"
                                    >
                                        <span
                                            class="text-xs font-bold {group.isToday
                                                ? 'text-[#FF453A]'
                                                : 'text-white/85'}"
                                        >
                                            {group.isToday
                                                ? `Today — ${group.label}`
                                                : group.label}
                                        </span>
                                        <span
                                            class="text-[10px] text-white/45 ios-tabular-nums"
                                        >
                                            {group.events.length} event{group
                                                .events.length === 1
                                                ? ""
                                                : "s"}
                                        </span>
                                    </div>

                                    <div
                                        class="grid grid-cols-1 md:grid-cols-2 gap-2 pl-2"
                                    >
                                        {#each group.events as ev (ev.id)}
                                            <button
                                                type="button"
                                                onclick={() => {
                                                    selectDayCell(group.iso);
                                                    selectedEventId = ev.id;
                                                }}
                                                style="border-left: 3.5px solid {ev.color ||
                                                    '#0A84FF'};"
                                                class="ios-nested-surface p-3 rounded-xl text-left flex items-start justify-between gap-3 hover:bg-white/12 transition-colors cursor-pointer"
                                            >
                                                <div
                                                    class="min-w-0 space-y-0.5"
                                                >
                                                    <div
                                                        class="text-xs font-semibold text-white truncate"
                                                    >
                                                        {ev.title}
                                                    </div>
                                                    <div
                                                        class="text-[11px] text-white/60 ios-tabular-nums flex items-center gap-2"
                                                    >
                                                        <span>{ev.time}</span>
                                                        {#if ev.feedName}
                                                            <span
                                                                class="px-1.5 py-0.2 rounded-full bg-white/10 text-[9.5px] text-white/70"
                                                            >
                                                                {ev.feedName}
                                                            </span>
                                                        {/if}
                                                    </div>
                                                    {#if ev.location}
                                                        <div
                                                            class="text-[10.5px] text-white/45 truncate flex items-center gap-1 pt-0.5"
                                                        >
                                                            <MapPin
                                                                class="size-3 shrink-0"
                                                            />
                                                            <span
                                                                class="truncate"
                                                                >{ev.location}</span
                                                            >
                                                        </div>
                                                    {/if}
                                                </div>
                                            </button>
                                        {/each}
                                    </div>
                                </div>
                            {:else}
                                <div
                                    class="h-64 flex flex-col items-center justify-center gap-2 text-white/45 text-sm"
                                >
                                    <CalendarIcon class="size-8 stroke-[1.5]" />
                                    <p>
                                        No synced events found in this period.
                                    </p>
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>

                <!-- Right Sidebar: Read-Only Selected Day Schedule & Event Details Inspector -->
                <aside
                    class="w-full lg:w-[350px] shrink-0 border-t lg:border-t-0 lg:border-l border-white/10 bg-black/25 p-4 flex flex-col justify-between gap-3 overflow-y-auto"
                >
                    <div class="space-y-3 min-h-0 flex-1 flex flex-col">
                        <!-- Selected Date Header -->
                        <div
                            class="flex items-start justify-between gap-2 border-b border-white/10 pb-3 shrink-0"
                        >
                            <div>
                                <div
                                    class="text-[10px] font-bold uppercase tracking-wider text-[#FF453A]"
                                >
                                    {selectedDateIso === todayIso
                                        ? "Today"
                                        : "Selected Date"}
                                </div>
                                <h3
                                    class="text-sm font-semibold text-white leading-snug mt-0.5"
                                >
                                    {selectedDateFormatted}
                                </h3>
                            </div>

                            <span
                                class="px-2.5 py-0.5 rounded-full bg-white/10 text-[11px] font-semibold text-white/70 ios-tabular-nums shrink-0"
                            >
                                {selectedDayEvents.length}
                                {selectedDayEvents.length === 1
                                    ? "event"
                                    : "events"}
                            </span>
                        </div>

                        <!-- Selected Day Event List -->
                        <div
                            class="flex-1 min-h-0 overflow-y-auto space-y-2 pr-0.5"
                        >
                            {#each selectedDayEvents as ev (ev.id)}
                                {@const isSelectedEv =
                                    selectedEventId === ev.id}
                                <div
                                    onclick={() =>
                                        (selectedEventId = isSelectedEv
                                            ? null
                                            : ev.id)}
                                    style="border-left: 3.5px solid {ev.color ||
                                        '#0A84FF'};"
                                    class="ios-nested-surface p-3 rounded-2xl space-y-1.5 transition-all cursor-pointer {isSelectedEv
                                        ? 'bg-white/14 ring-1 ring-white/25'
                                        : 'hover:bg-white/10'}"
                                >
                                    <div
                                        class="text-xs font-semibold text-white leading-snug break-words"
                                    >
                                        {ev.title}
                                    </div>

                                    <div
                                        class="flex flex-wrap items-center gap-2 text-[11px] text-white/65 ios-tabular-nums"
                                    >
                                        <span
                                            class="inline-flex items-center gap-1"
                                        >
                                            <Clock
                                                class="size-3 text-white/45"
                                            />
                                            {ev.time}
                                        </span>
                                        {#if ev.feedName}
                                            <span
                                                style="background: {(ev.color ||
                                                    '#0A84FF') +
                                                    '25'}; color: {ev.color ||
                                                    '#64D2FF'};"
                                                class="px-2 py-0.2 rounded-full text-[9.5px] font-semibold"
                                            >
                                                {ev.feedName}
                                            </span>
                                        {/if}
                                    </div>

                                    {#if ev.location}
                                        <a
                                            href={ev.location.startsWith(
                                                "http://",
                                            ) ||
                                            ev.location.startsWith("https://")
                                                ? ev.location
                                                : `https://maps.google.com/?q=${encodeURIComponent(ev.location)}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onclick={(e) => e.stopPropagation()}
                                            class="inline-flex items-center gap-1 text-[11px] text-primary hover:underline truncate max-w-full pt-0.5"
                                        >
                                            <MapPin class="size-3 shrink-0" />
                                            <span class="truncate"
                                                >{ev.location}</span
                                            >
                                            <ExternalLink
                                                class="size-2.5 shrink-0 opacity-70"
                                            />
                                        </a>
                                    {/if}

                                    {#if (isSelectedEv || selectedDayEvents.length <= 2) && ev.description}
                                        <p
                                            class="text-[11px] text-white/60 whitespace-pre-line leading-relaxed pt-1 border-t border-white/8"
                                        >
                                            {ev.description}
                                        </p>
                                    {/if}

                                    {#if ev.url}
                                        <a
                                            href={ev.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onclick={(e) => e.stopPropagation()}
                                            class="inline-flex items-center gap-1 text-[11px] text-primary hover:underline pt-0.5"
                                        >
                                            <Link2 class="size-3" />
                                            <span>Open Event Link</span>
                                        </a>
                                    {/if}
                                </div>
                            {:else}
                                <div
                                    class="h-44 flex flex-col items-center justify-center text-center gap-2 text-white/40 text-xs"
                                >
                                    <p>No events scheduled on this day.</p>
                                    {#if availableFeeds.length === 0}
                                        <button
                                            type="button"
                                            onclick={handleConfigureFeeds}
                                            class="text-primary font-semibold hover:underline cursor-pointer"
                                        >
                                            Configure .ics Feeds
                                        </button>
                                    {/if}
                                </div>
                            {/each}
                        </div>
                    </div>

                    <!-- Footer Hint -->
                    <div
                        class="pt-2.5 border-t border-white/8 flex items-center justify-between text-[10.5px] text-white/40 shrink-0"
                    >
                        <span>Click any event to inspect details</span>
                        {#if activeInspectedEvent}
                            <span class="text-white/65 truncate max-w-[130px]">
                                {activeInspectedEvent.title}
                            </span>
                        {/if}
                    </div>
                </aside>
            </div>
        </div>
    </div>
{/if}
