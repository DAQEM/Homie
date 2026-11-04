<script lang="ts">
    import { Search } from "@lucide/svelte";
    import { dashboard } from "../../state/dashboard.svelte";
    import type { DashboardNode } from "../../types";
    import Button from "../ui/Button.svelte";

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
    class="w-full h-full bg-card text-card-foreground border-[1.2px] border-card-border focus-within:border-primary shadow-md rounded-xl px-4 flex items-center gap-3 overflow-hidden transition-colors"
>
    <Search class="size-4 text-primary shrink-0" />
    <input
        type="text"
        bind:value={query}
        {placeholder}
        disabled={dashboard.isEditMode}
        class="w-full h-full text-sm text-foreground placeholder:text-foreground/40 focus:outline-none bg-transparent"
    />
    <Button
        type="submit"
        size="sm"
        disabled={dashboard.isEditMode}
        class="shrink-0"
    >
        Go
    </Button>
</form>
