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
            return;
        }
        dashboard.recordAppLaunch(node.id);
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

    <!-- Folder-creation dwell feedback ring -->
    {#if isMergeTarget}
        <div
            class="pointer-events-none absolute inset-0 -m-1.5 rounded-[22px] bg-white/18 backdrop-blur-md ring-2 ring-white/75 scale-105 transition-all duration-200 z-0"
        ></div>
    {/if}

    <!-- G2 Continuous-Curvature Squircle Shadow Carrier + Clipped Surface -->
    <div
        class="relative z-10 {inDock
            ? 'size-14'
            : 'size-[62px]'} shrink-0 ios-squircle-shadow {isMergeTarget
            ? 'scale-90'
            : ''}"
    >
        <div
            style={!hasCustomUpload ? `background: ${brandGradient};` : ""}
            class="relative w-full h-full ios-icon-surface flex items-center justify-center overflow-hidden"
        >
            <!-- Top Specular Gloss Sheen -->
            <div
                aria-hidden="true"
                class="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/20 to-transparent"
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

            <!-- G2 Continuous Specular Rim Highlight -->
            <svg
                aria-hidden="true"
                viewBox="0 0 100 100"
                class="pointer-events-none absolute inset-0 w-full h-full z-20"
            >
                <path
                    d="M 50,1 C 81.5,1 88.5,1 93.8,6.2 C 99,11.5 99,18.5 99,50 C 99,81.5 99,88.5 93.8,93.8 C 88.5,99 81.5,99 50,99 C 18.5,99 11.5,99 6.2,93.8 C 1,88.5 1,81.5 1,50 C 1,18.5 1,11.5 6.2,6.2 C 11.5,1 18.5,1 50,1 Z"
                    fill="none"
                    stroke="url(#ios-g2-rim)"
                    stroke-width="2"
                />
            </svg>
        </div>
    </div>

    {#if !inDock && dashboard.showIconLabels}
        <span
            class="relative z-10 text-[11.5px] font-medium ios-vibrant-label group-hover:text-white transition-colors truncate max-w-[84px] shrink-0 leading-tight"
        >
            {node.title}
        </span>
    {/if}
</a>
