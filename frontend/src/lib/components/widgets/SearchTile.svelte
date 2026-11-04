<script lang="ts">
    import { Search } from "@lucide/svelte";
    import { dashboard } from "../../state/dashboard.svelte";
    import type { DashboardNode } from "../../types";

    interface Props {
        node: DashboardNode;
    }

    let { node }: Props = $props();
    let query = $state("");

    let placeholder = $derived(
        node.settings?.placeholder || "Search Web or Spotlight (⌘K)...",
    );
    let engineUrl = $derived(
        node.settings?.engineUrl || "https://www.google.com/search?q=",
    );

    function handleSubmit(e: SubmitEvent) {
        e.preventDefault();
        if (dashboard.isEditMode) return;
        const trimmed = query.trim();
        if (!trimmed) {
            dashboard.openSpotlight();
            return;
        }

        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            window.open(trimmed, "_blank", "noopener,noreferrer");
        } else {
            window.open(
                `${engineUrl}${encodeURIComponent(trimmed)}`,
                "_blank",
                "noopener,noreferrer",
            );
        }
        query = "";
    }
</script>

<form
    onsubmit={handleSubmit}
    class="w-full h-full ios-widget-surface focus-within:ring-2 focus-within:ring-primary/65 px-4 flex items-center gap-3 overflow-hidden"
>
    <Search class="size-4.5 text-white/60 shrink-0" />
    <input
        type="text"
        bind:value={query}
        {placeholder}
        disabled={dashboard.isEditMode}
        class="w-full h-full text-sm font-medium text-white placeholder:text-white/40 focus:outline-none bg-transparent"
    />
    <button
        type="button"
        onclick={() => dashboard.openSpotlight(query)}
        title="Open iPadOS Spotlight (⌘K)"
        class="hidden sm:inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-white/10 hover:bg-white/20 text-[10px] font-semibold text-white/65 hover:text-white transition-colors shrink-0 select-none cursor-pointer"
    >
        ⌘K
    </button>
</form>
