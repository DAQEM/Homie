<script lang="ts">
    import { Clock } from "@lucide/svelte";
    import { dashboard } from "../../state/dashboard.svelte";
    import type { DashboardNode } from "../../types";

    interface Props {
        node: DashboardNode;
    }

    let { node }: Props = $props();

    let now = $state(new Date());

    $effect(() => {
        const timer = setInterval(() => {
            now = new Date();
        }, 1000);
        return () => clearInterval(timer);
    });

    let timezone = $derived(node.settings?.timezone || "UTC");
    let flag = $derived(node.settings?.flag || "");

    let timeString = $derived.by(() => {
        try {
            return new Intl.DateTimeFormat("en-GB", {
                timeZone: timezone,
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
            }).format(now);
        } catch {
            return "--:--";
        }
    });

    let offsetString = $derived.by(() => {
        try {
            const parts = new Intl.DateTimeFormat("en-GB", {
                timeZone: timezone,
                timeZoneName: "longOffset",
            }).formatToParts(now);
            const tzPart = parts.find((p) => p.type === "timeZoneName")?.value;
            return tzPart === "GMT" ? "GMT+00:00" : (tzPart ?? timezone);
        } catch {
            return timezone;
        }
    });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    onclick={(e) =>
        dashboard.isEditMode && dashboard.openEditNodeModal(node, e)}
    class="w-full h-full bg-card text-card-foreground border-[1.2px] border-card-border hover:border-primary/60 shadow-md rounded-xl p-4 flex flex-col justify-between overflow-hidden select-none transition-colors"
>
    <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-1.5 min-w-0">
            <Clock class="size-3.5 text-primary shrink-0" />
            <span class="text-xs font-medium text-foreground/80 truncate">
                {node.title}
            </span>
        </div>
        {#if flag}
            <span class="text-base leading-none shrink-0">{flag}</span>
        {/if}
    </div>

    <div
        class="text-3xl sm:text-4xl font-bold tracking-tight text-foreground truncate my-auto"
    >
        {timeString}
    </div>

    <div class="text-[11px] text-foreground/50 font-medium truncate">
        {offsetString}
    </div>
</div>
