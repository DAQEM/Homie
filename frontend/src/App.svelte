<script lang="ts">
    import { DragDropProvider } from "@dnd-kit/svelte";
    import {
        GRID_COLS,
        GRID_ROWS,
        dashboard,
    } from "./lib/state/dashboard.svelte";
    import Header from "./lib/components/Header.svelte";
    import GridCell from "./lib/components/GridCell.svelte";
    import SortableNode from "./lib/components/SortableNode.svelte";
    import NodeRenderer from "./lib/components/NodeRenderer.svelte";
    import Dock from "./lib/components/Dock.svelte";
    import FolderModal from "./lib/components/FolderModal.svelte";
    import NodeFormModal from "./lib/components/NodeFormModal.svelte";
    import WorkspaceModal from "./lib/components/WorkspaceModal.svelte";

    $effect(() => dashboard.init());

    let cells = $derived.by(() => {
        const list: { x: number; y: number; occupied: boolean }[] = [];
        for (let y = 1; y <= GRID_ROWS; y++) {
            for (let x = 1; x <= GRID_COLS; x++) {
                list.push({
                    x,
                    y,
                    occupied: dashboard.isCellOccupied(x, y),
                });
            }
        }
        return list;
    });
</script>

<main class="p-4 pb-28 space-y-6">
    <section
        class="max-w-[368px] md:max-w-[752px] xl:max-w-[1136px] 2xl:max-w-[1520px] mx-auto"
    >
        <Header />
    </section>

    <DragDropProvider onDragEnd={dashboard.handleDragEnd}>
        <!-- width = amount of blocks * (80 + gap in pixels) - gap in pixels -->
        <section
            class="grid grid-cols-4 md:grid-cols-8 xl:grid-cols-12 2xl:grid-cols-16 auto-rows-[80px] gap-4 max-w-[368px] md:max-w-[752px] xl:max-w-[1136px] 2xl:max-w-[1520px] mx-auto"
        >
            {#each cells as cell (`${cell.x}:${cell.y}`)}
                <GridCell x={cell.x} y={cell.y} occupied={cell.occupied} />
            {/each}

            {#each dashboard.rootNodes as node (node.id)}
                <SortableNode {node}>
                    <NodeRenderer {node} />
                </SortableNode>
            {/each}
        </section>

        <Dock />
    </DragDropProvider>

    <FolderModal />
    <NodeFormModal />
    <WorkspaceModal />
</main>
