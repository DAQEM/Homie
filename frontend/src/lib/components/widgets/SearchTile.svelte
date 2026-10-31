<script lang="ts">
    import { dashboard } from "../../state/dashboard.svelte";
    import type { DashboardNode } from "../../types";

    interface Props {
        node: DashboardNode;
    }

    let { node }: Props = $props();
    let query = $state("");

    let placeholder = $derived(
        node.settings?.placeholder || "Search the Web...",
    );
    let engineUrl = $derived(
        node.settings?.engineUrl || "https://www.google.com/search?q=",
    );

    function handleSubmit(e: SubmitEvent) {
        e.preventDefault();
        if (dashboard.isEditMode) return;
        const trimmed = query.trim();
        if (!trimmed) return;

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
    class="w-full h-full border px-3 flex items-center gap-2 overflow-hidden"
>
    <span class="text-xs opacity-60 shrink-0">⌕</span>
    <input
        type="text"
        bind:value={query}
        {placeholder}
        disabled={dashboard.isEditMode}
        class="w-full h-full text-sm focus:outline-none bg-transparent"
    />
    <button
        type="submit"
        disabled={dashboard.isEditMode}
        class="border px-2 py-0.5 text-xs shrink-0"
    >
        Go
    </button>
</form>
