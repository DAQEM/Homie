<script lang="ts">
    import { dashboard } from "../../state/dashboard.svelte";
    import { getNodeIconSrc, type DashboardNode } from "../../types";

    interface Props {
        node: DashboardNode;
    }

    let { node }: Props = $props();

    let iconSrc = $derived(getNodeIconSrc(node));

    function handleClick(e: MouseEvent) {
        if (dashboard.isEditMode) {
            e.preventDefault();
            dashboard.openEditNodeModal(node, e);
        }
    }
</script>

<a
    href={dashboard.isEditMode ? undefined : (node.url ?? "#")}
    target={dashboard.isEditMode ? undefined : "_blank"}
    rel="noopener noreferrer"
    onclick={handleClick}
    class="group w-full h-full flex flex-col items-center gap-1.5 text-center overflow-hidden select-none"
>
    <div
        class="w-full flex-1 min-h-0 bg-card text-card-foreground border-[1.2px] border-card-border group-hover:border-primary shadow-md rounded-xl p-2 flex items-center justify-center transition-colors overflow-hidden"
    >
        {#if iconSrc}
            <img
                src={iconSrc}
                alt={node.title}
                class="w-8 h-8 object-contain shrink-0 transition-transform duration-200 group-hover:scale-105"
            />
        {:else}
            <span class="text-base font-bold text-primary uppercase">
                {node.title.slice(0, 2)}
            </span>
        {/if}
    </div>
    <span
        class="text-xs text-foreground/80 group-hover:text-foreground transition-colors truncate w-full shrink-0 leading-tight"
    >
        {node.title}
    </span>
</a>
