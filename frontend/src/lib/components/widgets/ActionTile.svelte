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
    class="aspect-square w-full h-full bg-card text-card-foreground border-[1.2px] border-card-border hover:border-primary shadow-md rounded-xl p-2 flex flex-col items-center justify-center gap-1 text-center overflow-hidden"
>
    {#if iconSrc}
        <img
            src={iconSrc}
            alt={node.title}
            class="w-8 h-8 object-contain shrink-0"
        />
    {/if}
    <span class="text-xs truncate w-full">{node.title}</span>
</a>
