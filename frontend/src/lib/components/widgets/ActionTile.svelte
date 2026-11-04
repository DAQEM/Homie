<script lang="ts">
    import { dashboard } from "../../state/dashboard.svelte";
    import {
        getNodeBrandGradient,
        getNodeIconSrc,
        type DashboardNode,
    } from "../../types";

    interface Props {
        node: DashboardNode;
        inDock?: boolean;
    }

    let { node, inDock = false }: Props = $props();

    let iconSrc = $derived(getNodeIconSrc(node));
    let hasCustomUpload = $derived(
        Boolean(node.icon && node.icon.startsWith("data:")),
    );
    let brandGradient = $derived(getNodeBrandGradient(node));
    let isMergeTarget = $derived(dashboard.folderMergeTargetId === node.id);

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
    class="group relative w-full h-full flex flex-col items-center {inDock
        ? 'justify-center'
        : 'justify-center gap-1.5'} text-center select-none"
>
    {#if inDock}
        <span
            class="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 z-50 px-2.5 py-1 rounded-full ios-glass-pill text-[11px] font-medium text-white whitespace-nowrap opacity-0 group-hover:opacity-100 -translate-y-0.5 group-hover:translate-y-0 transition-all duration-150"
        >
            {node.title}
        </span>
    {/if}

    <!-- Folder-creation dwell feedback ring (appears when holding another app over this app) -->
    {#if isMergeTarget}
        <div
            class="pointer-events-none absolute inset-0 -m-1.5 rounded-[22px] bg-white/18 backdrop-blur-md ring-2 ring-white/75 scale-105 transition-all duration-200 z-0"
        ></div>
    {/if}

    <!-- Authentic iPadOS 62x62 App Squircle (56x56 in Dock) -->
    <div
        style={!hasCustomUpload ? `background: ${brandGradient};` : ""}
        class="relative z-10 {inDock
            ? 'size-14 rounded-[15px]'
            : 'size-[62px] rounded-[16px]'} shrink-0 ios-icon-surface flex items-center justify-center overflow-hidden {isMergeTarget
            ? 'scale-90 ring-2 ring-primary'
            : ''}"
    >
        <!-- Subtle top specular gloss sheen -->
        <div
            aria-hidden="true"
            class="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/18 to-transparent"
        ></div>

        {#if hasCustomUpload && iconSrc}
            <img
                src={iconSrc}
                alt={node.title}
                class="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
            />
        {:else if iconSrc}
            <img
                src={iconSrc}
                alt={node.title}
                class="relative z-10 {inDock
                    ? 'w-8 h-8'
                    : 'w-9 h-9'} object-contain shrink-0 drop-shadow-[0_3px_8px_rgba(0,0,0,0.45)] transition-transform duration-200 group-hover:scale-105"
            />
        {:else}
            <span
                class="relative z-10 text-lg font-bold text-white tracking-tight uppercase drop-shadow-sm"
            >
                {node.title.slice(0, 2)}
            </span>
        {/if}
    </div>

    {#if !inDock}
        <span
            class="relative z-10 text-[11.5px] font-medium text-white/92 group-hover:text-white transition-colors truncate max-w-[84px] shrink-0 leading-tight ios-label-shadow"
        >
            {node.title}
        </span>
    {/if}
</a>
