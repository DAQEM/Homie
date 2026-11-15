<script lang="ts">
    import {
        Cloud,
        CloudDrizzle,
        CloudFog,
        CloudLightning,
        CloudRain,
        CloudSnow,
        CloudSun,
        Droplets,
        MapPin,
        Moon,
        Sun,
        Wind,
    } from "@lucide/svelte";
    import { dashboard } from "../../state/dashboard.svelte";
    import type { DashboardNode } from "../../types";

    interface Props {
        node: DashboardNode;
    }

    let { node }: Props = $props();

    let weather = $derived(dashboard.getWeatherForNode(node));
    let isWide = $derived((node.width || 2) >= 4);
    let isLarge = $derived((node.width || 2) >= 4 && (node.height || 2) >= 4);

    let cityLabel = $derived(
        weather?.location || node.settings?.location || node.title || "Weather",
    );

    let skyGradient = $derived.by(() => {
        if (!weather) {
            return "linear-gradient(160deg, rgba(30, 58, 138, 0.72) 0%, rgba(15, 23, 42, 0.85) 100%)";
        }
        if (!weather.isDay) {
            return "linear-gradient(160deg, rgba(24, 34, 72, 0.82) 0%, rgba(10, 14, 30, 0.88) 100%)";
        }
        if (weather.code >= 51) {
            return "linear-gradient(160deg, rgba(51, 65, 85, 0.78) 0%, rgba(30, 41, 59, 0.86) 100%)";
        }
        return "linear-gradient(160deg, rgba(14, 116, 204, 0.72) 0%, rgba(29, 78, 216, 0.56) 100%)";
    });

    function getWeekdayShort(isoDate: string, idx: number): string {
        if (idx === 0) return "Today";
        const [y, m, d] = isoDate.split("-").map(Number);
        if (!y || !m || !d) return isoDate;
        return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(
            new Date(y, m - 1, d),
        );
    }

    let dailyBounds = $derived.by(() => {
        const list = weather?.daily ?? [];
        if (list.length === 0) return { min: 0, span: 1 };
        let min = Infinity;
        let max = -Infinity;
        for (const d of list) {
            if (d.tempMin < min) min = d.tempMin;
            if (d.tempMax > max) max = d.tempMax;
        }
        return { min, span: Math.max(1, max - min) };
    });
</script>

{#snippet weatherIcon(code: number, isDay: boolean, cls: string)}
    {#if code === 0 || code === 1}
        {#if isDay}
            <Sun class="{cls} text-[#FFD60A]" />
        {:else}
            <Moon class="{cls} text-[#E2E8F0]" />
        {/if}
    {:else if code === 2}
        <CloudSun class="{cls} text-[#FDE047]" />
    {:else if code === 3}
        <Cloud class="{cls} text-white/85" />
    {:else if code === 45 || code === 48}
        <CloudFog class="{cls} text-white/75" />
    {:else if code >= 51 && code <= 57}
        <CloudDrizzle class="{cls} text-[#64D2FF]" />
    {:else if (code >= 61 && code <= 67) || (code >= 80 && code <= 82)}
        <CloudRain class="{cls} text-[#64D2FF]" />
    {:else if (code >= 71 && code <= 77) || (code >= 85 && code <= 86)}
        <CloudSnow class="{cls} text-white" />
    {:else if code >= 95}
        <CloudLightning class="{cls} text-[#FFD60A]" />
    {:else}
        <CloudSun class="{cls} text-white/90" />
    {/if}
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    onclick={(e) => dashboard.isEditMode && dashboard.inspectNode(node, e)}
    style="background: {skyGradient};"
    class="w-full h-full ios-widget-surface p-3.5 flex flex-col justify-between gap-2 overflow-hidden select-none text-white"
>
    {#if !weather}
        <div class="flex items-center justify-between gap-1.5">
            <span class="text-xs font-bold truncate flex items-center gap-1">
                <MapPin class="size-3 text-white/75 shrink-0" />
                {cityLabel}
            </span>
        </div>
        <div
            class="my-auto text-center text-xs text-white/65 flex flex-col items-center gap-1"
        >
            <CloudSun class="size-7 text-white/60" />
            <span>Loading forecast…</span>
        </div>
        <div class="text-[10px] text-white/45 text-center">Open-Meteo</div>
    {:else if weather.error}
        <div class="flex items-center justify-between gap-1.5">
            <span class="text-xs font-bold truncate">{cityLabel}</span>
        </div>
        <div class="my-auto text-center text-xs text-white/70">
            {weather.error}
        </div>
        <div class="text-[10px] text-white/50 text-center">
            Flip widget to edit city
        </div>
    {:else if isLarge}
        <!-- Large (4x4): Full Apple Weather Summary + Hourly + 5-Day Bar Forecast -->
        <div class="flex items-start justify-between gap-3 shrink-0">
            <div>
                <div class="flex items-center gap-1 text-sm font-semibold">
                    <span>{weather.location}</span>
                    <MapPin class="size-3 text-white/75" />
                </div>
                <div
                    class="text-5xl font-extralight ios-tabular-nums tracking-tight leading-none mt-1"
                >
                    {Math.round(weather.temperature)}°
                </div>
            </div>

            <div class="text-right space-y-0.5">
                <div class="flex justify-end">
                    {@render weatherIcon(
                        weather.code,
                        weather.isDay,
                        "size-7 drop-shadow",
                    )}
                </div>
                <div class="text-xs font-semibold text-white/95">
                    {weather.condition}
                </div>
                <div class="text-[11px] text-white/75 ios-tabular-nums">
                    H:{Math.round(weather.tempHigh)}° L:{Math.round(
                        weather.tempLow,
                    )}°
                </div>
            </div>
        </div>

        <!-- Hourly Strip -->
        <div
            class="grid grid-cols-6 gap-1.5 py-2 border-y border-white/15 shrink-0"
        >
            {#each weather.hourly.slice(0, 6) as hr (hr.time)}
                <div class="flex flex-col items-center gap-1 text-center">
                    <span class="text-[10px] text-white/70 ios-tabular-nums">
                        {hr.time}
                    </span>
                    {@render weatherIcon(hr.code, hr.isDay, "size-4")}
                    <span class="text-xs font-semibold ios-tabular-nums">
                        {Math.round(hr.temperature)}°
                    </span>
                </div>
            {/each}
        </div>

        <!-- 5-Day Range Bars -->
        <div class="flex-1 min-h-0 flex flex-col justify-between gap-1">
            {#each weather.daily.slice(0, 5) as day, idx (day.date)}
                {@const leftPct =
                    ((day.tempMin - dailyBounds.min) / dailyBounds.span) * 100}
                {@const widthPct = Math.max(
                    12,
                    ((day.tempMax - day.tempMin) / dailyBounds.span) * 100,
                )}
                <div class="flex items-center gap-2 text-xs">
                    <span class="w-11 font-medium text-white/90 shrink-0">
                        {getWeekdayShort(day.date, idx)}
                    </span>
                    {@render weatherIcon(day.code, true, "size-4 shrink-0")}
                    <span
                        class="w-7 text-right text-white/60 ios-tabular-nums shrink-0"
                    >
                        {Math.round(day.tempMin)}°
                    </span>
                    <div
                        class="flex-1 h-1.5 rounded-full bg-black/25 overflow-hidden relative"
                    >
                        <div
                            style="left: {leftPct}%; width: {widthPct}%;"
                            class="absolute inset-y-0 rounded-full bg-gradient-to-r from-[#64D2FF] via-[#30D158] to-[#FF9F0A]"
                        ></div>
                    </div>
                    <span
                        class="w-7 text-right font-semibold ios-tabular-nums shrink-0"
                    >
                        {Math.round(day.tempMax)}°
                    </span>
                </div>
            {/each}
        </div>
    {:else if isWide}
        <!-- Medium (4x2): Current Conditions + 6-Hour Strip -->
        <div class="flex items-start justify-between gap-2 shrink-0">
            <div class="flex items-center gap-3">
                <div
                    class="text-4xl font-light ios-tabular-nums tracking-tight leading-none"
                >
                    {Math.round(weather.temperature)}°
                </div>
                <div>
                    <div class="text-xs font-semibold flex items-center gap-1">
                        <span>{weather.location}</span>
                    </div>
                    <div class="text-[11px] text-white/80">
                        {weather.condition} • H:{Math.round(weather.tempHigh)}°
                        L:{Math.round(weather.tempLow)}°
                    </div>
                </div>
            </div>

            <div class="flex items-center gap-3 text-[10.5px] text-white/75">
                <span class="inline-flex items-center gap-1 ios-tabular-nums">
                    <Droplets class="size-3" />
                    {weather.humidity}%
                </span>
                <span class="inline-flex items-center gap-1 ios-tabular-nums">
                    <Wind class="size-3" />
                    {Math.round(weather.windSpeed)}
                    {weather.unit === "F" ? "mph" : "km/h"}
                </span>
            </div>
        </div>

        <div class="grid grid-cols-6 gap-1.5 pt-2 border-t border-white/15">
            {#each weather.hourly.slice(0, 6) as hr (hr.time)}
                <div class="flex flex-col items-center gap-1 text-center">
                    <span class="text-[10px] text-white/70 ios-tabular-nums">
                        {hr.time}
                    </span>
                    {@render weatherIcon(hr.code, hr.isDay, "size-4")}
                    <span class="text-xs font-semibold ios-tabular-nums">
                        {Math.round(hr.temperature)}°
                    </span>
                </div>
            {/each}
        </div>
    {:else}
        <!-- Small (2x2) -->
        <div class="flex items-start justify-between gap-1">
            <div class="min-w-0">
                <div class="text-xs font-semibold truncate">
                    {weather.location}
                </div>
                <div
                    class="text-4xl font-light ios-tabular-nums tracking-tight leading-none mt-1"
                >
                    {Math.round(weather.temperature)}°
                </div>
            </div>
            {@render weatherIcon(
                weather.code,
                weather.isDay,
                "size-6 shrink-0 drop-shadow",
            )}
        </div>

        <div class="space-y-0.5">
            <div class="text-xs font-semibold truncate">
                {weather.condition}
            </div>
            <div class="text-[10.5px] text-white/80 ios-tabular-nums">
                H:{Math.round(weather.tempHigh)}° L:{Math.round(
                    weather.tempLow,
                )}°
            </div>
        </div>
    {/if}
</div>
