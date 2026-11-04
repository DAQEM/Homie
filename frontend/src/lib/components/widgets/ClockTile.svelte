<script lang="ts">
    import { Moon, Sun } from "@lucide/svelte";
    import { dashboard } from "../../state/dashboard.svelte";
    import type { DashboardNode } from "../../types";

    interface Props {
        node: DashboardNode;
    }

    let { node }: Props = $props();

    let timezone = $derived(node.settings?.timezone || "Europe/Amsterdam");
    let flag = $derived(node.settings?.flag || "");
    let isWide = $derived((node.width || 2) >= 4);

    // Driven by the single shared `dashboard.now` ticker (0 extra timers per widget)
    let timeParts = $derived.by(() => {
        const now = dashboard.now;
        try {
            const parts = new Intl.DateTimeFormat("en-US", {
                timeZone: timezone,
                hour: "numeric",
                minute: "numeric",
                second: "numeric",
                hour12: false,
            }).formatToParts(now);

            const getNum = (t: string) =>
                Number(parts.find((p) => p.type === t)?.value ?? 0);
            const h = getNum("hour") % 24;
            const m = getNum("minute");
            const s = getNum("second");
            return { h, m, s };
        } catch {
            return {
                h: now.getUTCHours(),
                m: now.getUTCMinutes(),
                s: now.getUTCSeconds(),
            };
        }
    });

    let isDaytime = $derived(timeParts.h >= 6 && timeParts.h < 19);

    let timeString = $derived(
        `${String(timeParts.h).padStart(2, "0")}:${String(timeParts.m).padStart(2, "0")}`,
    );

    let secondsString = $derived(String(timeParts.s).padStart(2, "0"));

    let hourAngle = $derived((timeParts.h % 12) * 30 + timeParts.m * 0.5);
    let minuteAngle = $derived(timeParts.m * 6 + timeParts.s * 0.1);
    let secondAngle = $derived(timeParts.s * 6);

    let relativeOffsetLabel = $derived.by(() => {
        const now = dashboard.now;
        try {
            const targetDateStr = now.toLocaleString("en-US", {
                timeZone: timezone,
            });
            const localDateStr = now.toLocaleString("en-US");
            const diffMinutes = Math.round(
                (new Date(targetDateStr).getTime() -
                    new Date(localDateStr).getTime()) /
                    60000,
            );
            const diffHours = Math.round(diffMinutes / 60);
            const sign = diffHours >= 0 ? "+" : "";
            return `Today, ${sign}${diffHours}HRS`;
        } catch {
            return timezone;
        }
    });

    let dateLabel = $derived.by(() => {
        try {
            return new Intl.DateTimeFormat("en-US", {
                timeZone: timezone,
                weekday: "short",
                month: "short",
                day: "numeric",
            }).format(dashboard.now);
        } catch {
            return "";
        }
    });

    let liveSignalText = $derived(
        typeof dashboard.signals["system:hello:greeting"] === "string"
            ? (dashboard.signals["system:hello:greeting"] as string)
            : null,
    );
</script>

{#snippet analogDial(sizeClass: string)}
    <div class="relative {sizeClass} shrink-0 select-none">
        <svg viewBox="0 0 100 100" class="w-full h-full overflow-visible">
            <!-- Outer Clock Dial Surface -->
            <circle
                cx="50"
                cy="50"
                r="47"
                fill={isDaytime ? "#F5F5F7" : "#1C1C22"}
                stroke={isDaytime
                    ? "rgba(0,0,0,0.08)"
                    : "rgba(255,255,255,0.12)"}
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
                    stroke={isDaytime
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
                fill={isDaytime ? "#111111" : "#F5F5F7"}
                font-size="9.5"
                font-weight="700"
            >
                12
            </text>
            <text
                x="80"
                y="53.2"
                text-anchor="middle"
                fill={isDaytime ? "#111111" : "#F5F5F7"}
                font-size="9.5"
                font-weight="700"
            >
                3
            </text>
            <text
                x="50"
                y="84"
                text-anchor="middle"
                fill={isDaytime ? "#111111" : "#F5F5F7"}
                font-size="9.5"
                font-weight="700"
            >
                6
            </text>
            <text
                x="20"
                y="53.2"
                text-anchor="middle"
                fill={isDaytime ? "#111111" : "#F5F5F7"}
                font-size="9.5"
                font-weight="700"
            >
                9
            </text>

            <!-- Hour Hand -->
            <g transform="rotate({hourAngle} 50 50)">
                <line
                    x1="50"
                    y1="50"
                    x2="50"
                    y2="26"
                    stroke={isDaytime ? "#111111" : "#FFFFFF"}
                    stroke-width="3.2"
                    stroke-linecap="round"
                />
            </g>

            <!-- Minute Hand -->
            <g transform="rotate({minuteAngle} 50 50)">
                <line
                    x1="50"
                    y1="50"
                    x2="50"
                    y2="15"
                    stroke={isDaytime ? "#111111" : "#FFFFFF"}
                    stroke-width="2.3"
                    stroke-linecap="round"
                />
            </g>

            <!-- Iconic Apple International Orange Second Hand -->
            <g transform="rotate({secondAngle} 50 50)">
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
                    fill={isDaytime ? "#F5F5F7" : "#1C1C22"}
                />
            </g>
        </svg>
    </div>
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    onclick={(e) => dashboard.isEditMode && dashboard.inspectNode(node, e)}
    style={isDaytime
        ? "background: linear-gradient(165deg, rgba(242, 243, 248, 0.9) 0%, rgba(218, 222, 234, 0.85) 100%);"
        : ""}
    class="w-full h-full ios-widget-surface p-3.5 flex {isWide
        ? 'items-center gap-4'
        : 'flex-col justify-between'} overflow-hidden select-none {isDaytime
        ? 'text-[#111114]'
        : 'text-white'}"
>
    {#if isWide}
        <!-- Medium (4x2) Split World Clock View -->
        {@render analogDial("size-[132px]")}

        <div class="flex-1 min-w-0 flex flex-col justify-between h-full py-1">
            <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-1.5 min-w-0">
                    {#if isDaytime}
                        <Sun class="size-3.5 text-[#FF9500] shrink-0" />
                    {:else}
                        <Moon class="size-3.5 text-[#64D2FF] shrink-0" />
                    {/if}
                    <span class="text-xs font-bold tracking-tight truncate">
                        {node.title}
                    </span>
                    {#if flag}
                        <span class="text-sm leading-none shrink-0">{flag}</span
                        >
                    {/if}
                </div>
                <span
                    class="text-[11px] font-medium ios-tabular-nums {isDaytime
                        ? 'text-black/55'
                        : 'text-white/55'}"
                >
                    {relativeOffsetLabel}
                </span>
            </div>

            <div class="flex items-baseline gap-1.5 my-auto">
                <span
                    class="text-4xl font-semibold ios-tight-tracking ios-tabular-nums leading-none"
                >
                    {timeString}
                </span>
                <span
                    class="text-sm font-semibold ios-tabular-nums text-[#FF9500]"
                >
                    :{secondsString}
                </span>
            </div>

            <div class="flex items-center justify-between gap-2 text-[11px]">
                <span
                    class="font-medium {isDaytime
                        ? 'text-black/65'
                        : 'text-white/65'}"
                >
                    {dateLabel}
                </span>
                {#if liveSignalText}
                    <span
                        class="truncate text-[10px] px-2 py-0.5 rounded-full {isDaytime
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
                {#if isDaytime}
                    <Sun class="size-3 text-[#FF9500] shrink-0" />
                {:else}
                    <Moon class="size-3 text-[#64D2FF] shrink-0" />
                {/if}
                <span class="text-xs font-bold tracking-tight truncate">
                    {node.title}
                </span>
            </div>
            <span
                class="text-xs font-semibold ios-tabular-nums {isDaytime
                    ? 'text-black/65'
                    : 'text-white/70'}"
            >
                {timeString}
            </span>
        </div>

        <div class="my-auto flex items-center justify-center">
            {@render analogDial("size-[118px]")}
        </div>

        <div class="flex items-center justify-between gap-1 text-[10.5px]">
            <span
                class="font-medium ios-tabular-nums truncate {isDaytime
                    ? 'text-black/55'
                    : 'text-white/55'}"
            >
                {relativeOffsetLabel}
            </span>
            {#if flag}
                <span class="text-xs leading-none shrink-0">{flag}</span>
            {/if}
        </div>
    {/if}
</div>
