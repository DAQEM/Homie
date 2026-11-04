<script lang="ts">
    import { Moon, Sun } from "@lucide/svelte";
    import { dashboard } from "../../state/dashboard.svelte";
    import type { DashboardNode, WorldClockCity } from "../../types";

    interface Props {
        node: DashboardNode;
    }

    let { node }: Props = $props();

    let timezone = $derived(node.settings?.timezone || "Europe/Amsterdam");
    let flag = $derived(node.settings?.flag || "");
    let sweepSeconds = $derived(node.settings?.sweepSeconds !== false);
    let isWide = $derived((node.width || 2) >= 4 && (node.height || 2) < 4);
    let isQuadGrid = $derived(
        (node.width || 2) >= 4 && (node.height || 2) >= 4,
    );

    // High-precision timestamp for continuous sweeping second hand
    let fineNowMs = $state(Date.now());

    $effect(() => {
        if (!sweepSeconds) return;
        let rafId: number;
        const loop = () => {
            fineNowMs = Date.now();
            rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(rafId);
    });

    function computeCityClock(tz: string, refDate: Date, subSecMs: number) {
        try {
            const parts = new Intl.DateTimeFormat("en-US", {
                timeZone: tz,
                hour: "numeric",
                minute: "numeric",
                second: "numeric",
                hour12: false,
            }).formatToParts(refDate);

            const getNum = (t: string) =>
                Number(parts.find((p) => p.type === t)?.value ?? 0);
            const h = getNum("hour") % 24;
            const m = getNum("minute");
            const s = getNum("second");
            const smoothS = sweepSeconds ? s + (subSecMs % 1000) / 1000 : s;

            const isDay = h >= 6 && h < 19;
            const timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
            const secStr = String(s).padStart(2, "0");

            const hourAngle = (h % 12) * 30 + m * 0.5;
            const minuteAngle = m * 6 + smoothS * 0.1;
            const secondAngle = smoothS * 6;

            const targetDateStr = refDate.toLocaleString("en-US", {
                timeZone: tz,
            });
            const localDateStr = refDate.toLocaleString("en-US");
            const diffHours = Math.round(
                (new Date(targetDateStr).getTime() -
                    new Date(localDateStr).getTime()) /
                    3600000,
            );
            const sign = diffHours >= 0 ? "+" : "";
            const offsetLabel = `Today, ${sign}${diffHours}HRS`;

            const dateLabel = new Intl.DateTimeFormat("en-US", {
                timeZone: tz,
                weekday: "short",
                month: "short",
                day: "numeric",
            }).format(refDate);

            return {
                h,
                m,
                s,
                isDay,
                timeStr,
                secStr,
                hourAngle,
                minuteAngle,
                secondAngle,
                offsetLabel,
                dateLabel,
            };
        } catch {
            const h = refDate.getUTCHours();
            const m = refDate.getUTCMinutes();
            const s = refDate.getUTCSeconds();
            return {
                h,
                m,
                s,
                isDay: h >= 6 && h < 19,
                timeStr: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
                secStr: String(s).padStart(2, "0"),
                hourAngle: (h % 12) * 30 + m * 0.5,
                minuteAngle: m * 6,
                secondAngle: s * 6,
                offsetLabel: "UTC",
                dateLabel: "",
            };
        }
    }

    let primaryClock = $derived(
        computeCityClock(
            timezone,
            sweepSeconds ? new Date(fineNowMs) : dashboard.now,
            fineNowMs,
        ),
    );

    let isPageVisible = $derived.by(() => {
        if (!node.workspace_id) return true;
        const pageIdx = dashboard.workspaces.findIndex(
            (w) => w.id === node.workspace_id,
        );
        if (pageIdx === -1) return true;
        return Math.abs(dashboard.pagePosition - pageIdx) <= 1.05;
    });

    $effect(() => {
        if (!sweepSeconds || !dashboard.isDocumentVisible || !isPageVisible) {
            return;
        }
        let rafId: number;
        const loop = () => {
            fineNowMs = Date.now();
            rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(rafId);
    });

    let quadCities = $derived.by<WorldClockCity[]>(() => {
        if (node.settings?.cities && node.settings.cities.length >= 4) {
            return node.settings.cities.slice(0, 4);
        }
        return [
            { name: node.title || "Amsterdam", timezone, flag: flag || "🇳🇱" },
            {
                name: "Cupertino",
                timezone: "America/Los_Angeles",
                flag: "🇺🇸",
            },
            { name: "New York", timezone: "America/New_York", flag: "🇺🇸" },
            { name: "Tokyo", timezone: "Asia/Tokyo", flag: "🇯🇵" },
        ];
    });

    let liveSignalText = $derived(
        typeof dashboard.signals["system:hello:greeting"] === "string"
            ? (dashboard.signals["system:hello:greeting"] as string)
            : null,
    );
</script>

{#snippet analogDial(
    sizeClass: string,
    isDay: boolean,
    hAngle: number,
    mAngle: number,
    sAngle: number,
)}
    <div class="relative {sizeClass} shrink-0 select-none">
        <svg viewBox="0 0 100 100" class="w-full h-full overflow-visible">
            <!-- Outer Clock Dial Surface -->
            <circle
                cx="50"
                cy="50"
                r="47"
                fill={isDay ? "#F5F5F7" : "#1C1C22"}
                stroke={isDay ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.12)"}
                stroke-width="1.5"
            />

            <!-- 12 Hour Tick Marks -->
            {#each Array(12) as _, i}
                {@const angle = i * 30}
                {@const isCardinal = i % 3 === 0}
                <line
                    x1="50"
                    y1={isCardinal ? "7.5" : "8.5"}
                    x2="50"
                    y2={isCardinal ? "13.5" : "12"}
                    stroke={isDay
                        ? isCardinal
                            ? "#111111"
                            : "rgba(0,0,0,0.35)"
                        : isCardinal
                          ? "#FFFFFF"
                          : "rgba(255,255,255,0.35)"}
                    stroke-width={isCardinal ? "2" : "1.2"}
                    stroke-linecap="round"
                    transform="rotate({angle} 50 50)"
                />
            {/each}

            <!-- Cardinal Numerals (12, 3, 6, 9) -->
            <text
                x="50"
                y="22.5"
                text-anchor="middle"
                fill={isDay ? "#111111" : "#F5F5F7"}
                font-size="9.5"
                font-weight="700"
            >
                12
            </text>
            <text
                x="80"
                y="53.2"
                text-anchor="middle"
                fill={isDay ? "#111111" : "#F5F5F7"}
                font-size="9.5"
                font-weight="700"
            >
                3
            </text>
            <text
                x="50"
                y="84"
                text-anchor="middle"
                fill={isDay ? "#111111" : "#F5F5F7"}
                font-size="9.5"
                font-weight="700"
            >
                6
            </text>
            <text
                x="20"
                y="53.2"
                text-anchor="middle"
                fill={isDay ? "#111111" : "#F5F5F7"}
                font-size="9.5"
                font-weight="700"
            >
                9
            </text>

            <!-- Hour Hand -->
            <g transform="rotate({hAngle} 50 50)">
                <line
                    x1="50"
                    y1="50"
                    x2="50"
                    y2="26"
                    stroke={isDay ? "#111111" : "#FFFFFF"}
                    stroke-width="3.2"
                    stroke-linecap="round"
                />
            </g>

            <!-- Minute Hand -->
            <g transform="rotate({mAngle} 50 50)">
                <line
                    x1="50"
                    y1="50"
                    x2="50"
                    y2="15"
                    stroke={isDay ? "#111111" : "#FFFFFF"}
                    stroke-width="2.3"
                    stroke-linecap="round"
                />
            </g>

            <!-- Iconic Apple International Orange Second Hand -->
            <g transform="rotate({sAngle} 50 50)">
                <line
                    x1="50"
                    y1="57"
                    x2="50"
                    y2="11"
                    stroke="#FF9500"
                    stroke-width="1.25"
                    stroke-linecap="round"
                />
                <circle cx="50" cy="50" r="2.6" fill="#FF9500" />
                <circle
                    cx="50"
                    cy="50"
                    r="1"
                    fill={isDay ? "#F5F5F7" : "#1C1C22"}
                />
            </g>
        </svg>
    </div>
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
{#if isQuadGrid}
    <!-- Large (4x4) iPadOS 4-City World Clock Grid -->
    <div
        onclick={(e) => dashboard.isEditMode && dashboard.inspectNode(node, e)}
        class="w-full h-full ios-widget-surface p-4 grid grid-cols-2 grid-rows-2 gap-3.5 overflow-hidden select-none text-white"
    >
        {#each quadCities as city (city.name + city.timezone)}
            {@const c = computeCityClock(
                city.timezone,
                sweepSeconds ? new Date(fineNowMs) : dashboard.now,
                fineNowMs,
            )}
            <div
                class="ios-nested-surface rounded-[18px] p-3 flex flex-col justify-between"
            >
                <div class="flex items-center justify-between gap-1.5">
                    <div class="flex items-center gap-1 min-w-0">
                        {#if c.isDay}
                            <Sun class="size-3 text-[#FF9500] shrink-0" />
                        {:else}
                            <Moon class="size-3 text-[#64D2FF] shrink-0" />
                        {/if}
                        <span class="text-xs font-bold tracking-tight truncate">
                            {city.name}
                        </span>
                    </div>
                    <span
                        class="text-xs font-semibold ios-tabular-nums text-white/75"
                    >
                        {c.timeStr}
                    </span>
                </div>

                <div class="my-auto flex items-center justify-center">
                    {@render analogDial(
                        "size-[104px]",
                        c.isDay,
                        c.hourAngle,
                        c.minuteAngle,
                        c.secondAngle,
                    )}
                </div>

                <div
                    class="flex items-center justify-between gap-1 text-[10px] text-white/50"
                >
                    <span class="font-medium ios-tabular-nums truncate">
                        {c.offsetLabel}
                    </span>
                    {#if city.flag}
                        <span class="text-xs leading-none">{city.flag}</span>
                    {/if}
                </div>
            </div>
        {/each}
    </div>
{:else}
    <div
        onclick={(e) => dashboard.isEditMode && dashboard.inspectNode(node, e)}
        style={primaryClock.isDay
            ? "background: linear-gradient(165deg, rgba(242, 243, 248, 0.9) 0%, rgba(218, 222, 234, 0.85) 100%);"
            : ""}
        class="w-full h-full ios-widget-surface p-3.5 flex {isWide
            ? 'items-center gap-4'
            : 'flex-col justify-between'} overflow-hidden select-none {primaryClock.isDay
            ? 'text-[#111114]'
            : 'text-white'}"
    >
        {#if isWide}
            <!-- Medium (4x2) Split World Clock View -->
            {@render analogDial(
                "size-[132px]",
                primaryClock.isDay,
                primaryClock.hourAngle,
                primaryClock.minuteAngle,
                primaryClock.secondAngle,
            )}

            <div
                class="flex-1 min-w-0 flex flex-col justify-between h-full py-1"
            >
                <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-1.5 min-w-0">
                        {#if primaryClock.isDay}
                            <Sun class="size-3.5 text-[#FF9500] shrink-0" />
                        {:else}
                            <Moon class="size-3.5 text-[#64D2FF] shrink-0" />
                        {/if}
                        <span class="text-xs font-bold tracking-tight truncate">
                            {node.title}
                        </span>
                        {#if flag}
                            <span class="text-sm leading-none shrink-0"
                                >{flag}</span
                            >
                        {/if}
                    </div>
                    <span
                        class="text-[11px] font-medium ios-tabular-nums {primaryClock.isDay
                            ? 'text-black/55'
                            : 'text-white/55'}"
                    >
                        {primaryClock.offsetLabel}
                    </span>
                </div>

                <div class="flex items-baseline gap-1.5 my-auto">
                    <span
                        class="text-4xl font-semibold ios-tight-tracking ios-tabular-nums leading-none"
                    >
                        {primaryClock.timeStr}
                    </span>
                    <span
                        class="text-sm font-semibold ios-tabular-nums text-[#FF9500]"
                    >
                        :{primaryClock.secStr}
                    </span>
                </div>

                <div
                    class="flex items-center justify-between gap-2 text-[11px]"
                >
                    <span
                        class="font-medium {primaryClock.isDay
                            ? 'text-black/65'
                            : 'text-white/65'}"
                    >
                        {primaryClock.dateLabel}
                    </span>
                    {#if liveSignalText}
                        <span
                            class="truncate text-[10px] px-2 py-0.5 rounded-full {primaryClock.isDay
                                ? 'bg-black/8 text-black/65'
                                : 'bg-white/10 text-white/65'}"
                        >
                            {liveSignalText}
                        </span>
                    {/if}
                </div>
            </div>
        {:else}
            <!-- Small (2x2) Apple World Clock View -->
            <div class="flex items-center justify-between gap-1.5 w-full">
                <div class="flex items-center gap-1 min-w-0">
                    {#if primaryClock.isDay}
                        <Sun class="size-3 text-[#FF9500] shrink-0" />
                    {:else}
                        <Moon class="size-3 text-[#64D2FF] shrink-0" />
                    {/if}
                    <span class="text-xs font-bold tracking-tight truncate">
                        {node.title}
                    </span>
                </div>
                <span
                    class="text-xs font-semibold ios-tabular-nums {primaryClock.isDay
                        ? 'text-black/65'
                        : 'text-white/70'}"
                >
                    {primaryClock.timeStr}
                </span>
            </div>

            <div class="my-auto flex items-center justify-center">
                {@render analogDial(
                    "size-[118px]",
                    primaryClock.isDay,
                    primaryClock.hourAngle,
                    primaryClock.minuteAngle,
                    primaryClock.secondAngle,
                )}
            </div>

            <div class="flex items-center justify-between gap-1 text-[10.5px]">
                <span
                    class="font-medium ios-tabular-nums truncate {primaryClock.isDay
                        ? 'text-black/55'
                        : 'text-white/55'}"
                >
                    {primaryClock.offsetLabel}
                </span>
                {#if flag}
                    <span class="text-xs leading-none shrink-0">{flag}</span>
                {/if}
            </div>
        {/if}
    </div>
{/if}
