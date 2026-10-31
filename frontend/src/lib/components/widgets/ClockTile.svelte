<script lang="ts">
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

<div
    class="w-full h-full border p-3 flex flex-col justify-between overflow-hidden"
>
    <div class="flex items-center justify-between gap-2">
        <span class="text-xs truncate">{node.title}</span>
        {#if flag}
            <span class="text-xs shrink-0">{flag}</span>
        {/if}
    </div>

    <div class="text-2xl font-bold leading-none truncate">
        {timeString}
    </div>

    <div class="text-[10px] opacity-60 truncate">
        {offsetString}
    </div>
</div>
