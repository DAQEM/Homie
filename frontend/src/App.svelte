<script lang="ts">
    import { DragDropProvider } from "@dnd-kit/svelte";
    import {
        BLOCK_COLS,
        BLOCK_ROWS,
        BLOCKS_X,
        BLOCKS_Y,
        dashboard,
    } from "./lib/state/dashboard.svelte";
    import Header from "./lib/components/Header.svelte";
    import GridCell from "./lib/components/GridCell.svelte";
    import SortableNode from "./lib/components/SortableNode.svelte";
    import ActionTile from "./lib/components/ActionTile.svelte";
    import ContainerTile from "./lib/components/ContainerTile.svelte";
    import Dock from "./lib/components/Dock.svelte";
    import FolderModal from "./lib/components/FolderModal.svelte";
    import NodeFormModal from "./lib/components/NodeFormModal.svelte";
    import WorkspaceModal from "./lib/components/WorkspaceModal.svelte";
    import type { DashboardNode } from "./lib/types";

    $effect(() => dashboard.init());

    interface BlockData {
        index: number;
        cells: { x: number; y: number; occupied: boolean }[];
        nodes: DashboardNode[];
    }

    let blocks = $derived.by(() => {
        const list: BlockData[] = [];
        for (let by = 0; by < BLOCKS_Y; by++) {
            for (let bx = 0; bx < BLOCKS_X; bx++) {
                const minX = bx * BLOCK_COLS + 1;
                const maxX = (bx + 1) * BLOCK_COLS;
                const minY = by * BLOCK_ROWS + 1;
                const maxY = (by + 1) * BLOCK_ROWS;

                const cells: { x: number; y: number; occupied: boolean }[] = [];
                for (let y = minY; y <= maxY; y++) {
                    for (let x = minX; x <= maxX; x++) {
                        cells.push({
                            x,
                            y,
                            occupied: dashboard.isCellOccupied(x, y),
                        });
                    }
                }

                const nodes = dashboard.rootNodes.filter(
                    (n) =>
                        n.grid_x >= minX &&
                        n.grid_x <= maxX &&
                        n.grid_y >= minY &&
                        n.grid_y <= maxY,
                );

                list.push({
                    index: by * BLOCKS_X + bx,
                    cells,
                    nodes,
                });
            }
        }
        return list;
    });
</script>

<main class="p-4 pb-28 space-y-6">
    <Header />

    <DragDropProvider onDragEnd={dashboard.handleDragEnd}>
        <div
            class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2 max-w-[300px] sm:max-w-[608px] xl:max-w-[1224px] mx-auto"
        >
            {#each blocks as block (block.index)}
                <section class="grid grid-cols-3 gap-2">
                    {#each block.cells as cell (`${cell.x}:${cell.y}`)}
                        <GridCell
                            x={cell.x}
                            y={cell.y}
                            occupied={cell.occupied}
                        />
                    {/each}

                    {#each block.nodes as node (node.id)}
                        <SortableNode {node}>
                            {#if node.node_type === "action"}
                                <ActionTile {node} />
                            {:else if node.node_type === "container"}
                                <ContainerTile {node} />
                            {/if}
                        </SortableNode>
                    {/each}
                </section>
            {/each}
        </div>

        <Dock />
    </DragDropProvider>

    <FolderModal />
    <NodeFormModal />
    <WorkspaceModal />
</main>
