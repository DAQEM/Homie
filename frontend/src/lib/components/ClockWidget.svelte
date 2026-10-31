<script lang="ts">
    import { dashboard } from "../state/dashboard.svelte";
    import type { DashboardNode } from "../types";

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

    let timezone = $derived(node.settings?.timezone || "Europe/Amsterdam");
    let flag = $derived(node.settings?.flag || "🌍");

    let formattedTime = $derived.by(() => {
        try {
            return new Intl.DateTimeFormat("en-GB", {
                timeZone: timezone,
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
            }).format(now);
        } catch {
            return "00:00";
        }
    });

    let gmtOffset = $derived.by(() => {
        try {
            const parts = new Intl.DateTimeFormat("en-US", {
                timeZone: timezone,
                timeZoneName: "longOffset",
            }).formatToParts(now);
            const tzPart = parts.find((p) => p.type === "timeZoneName")?.value;
            return tzPart && tzPart !== "GMT" ? tzPart : "GMT+00:00";
        } catch {
            return "UTC";
        }
    });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    onclick={(e) =>
        dashboard.isEditMode && dashboard.openEditNodeModal(node, e)}
    class="w-full h-full rounded-2xl bg-[#3c222e]/85 backdrop-blur-md border border-white/10 p-4 flex flex-col justify-between shadow-lg select-none"
>
    <div class="flex items-center justify-between gap-2">
        <span class="text-sm font-medium text-white/90 truncate"
            >{node.title}</span
        >
        <span class="text-base leading-none shrink-0">{flag}</span>
    </div>

    <div class="my-auto py-1">
        <div class="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            {formattedTime}
        </div>
    </div>

    <div class="text-xs text-white/50 font-medium">
        {gmtOffset}
    </div>
</div>
