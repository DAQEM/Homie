import type { DashboardNode } from "../types";
import type { SessionStore } from "./session.svelte";

export class SmartStackController {
  private session: SessionStore;
  activeStackIndices = $state<Record<string, number>>({});

  constructor(session: SessionStore) {
    this.session = session;
  }

  getStackItems(rootNode: DashboardNode): DashboardNode[] {
    if (
      rootNode.parent_id ||
      rootNode.node_type === "action" ||
      rootNode.node_type === "container"
    ) {
      return [rootNode];
    }
    const children = this.session.getChildren(rootNode.id);
    return [rootNode, ...children];
  }

  getActiveStackIndex(rootNodeId: string): number {
    return this.activeStackIndices[rootNodeId] ?? 0;
  }

  setSmartStackIndex(rootNodeId: string, index: number): void {
    const rootNode = this.session.nodes.find((n) => n.id === rootNodeId);
    if (!rootNode) return;
    const total = this.getStackItems(rootNode).length;
    this.activeStackIndices[rootNodeId] = ((index % total) + total) % total;
  }

  cycleSmartStack(rootNodeId: string, delta: number): void {
    const current = this.getActiveStackIndex(rootNodeId);
    this.setSmartStackIndex(rootNodeId, current + delta);
  }

  async unstackActiveWidget(rootNodeId: string): Promise<void> {
    const rootNode = this.session.nodes.find((n) => n.id === rootNodeId);
    if (!rootNode) return;

    const stackItems = this.getStackItems(rootNode);
    if (stackItems.length <= 1) return;

    const activeIdx = this.getActiveStackIndex(rootNodeId);
    const targetToExtract =
      activeIdx > 0 ? stackItems[activeIdx] : stackItems[stackItems.length - 1];

    const w = rootNode.width || 2;
    const h = rootNode.height || 2;
    const free = this.session.findFirstFreeCell(w, h) ?? { x: 1, y: 1 };

    targetToExtract.parent_id = null;
    targetToExtract.grid_x = free.x;
    targetToExtract.grid_y = free.y;
    targetToExtract.width = w;
    targetToExtract.height = h;
    targetToExtract.sort_order = free.y * 100 + free.x;
    this.activeStackIndices[rootNodeId] = 0;
    this.session.persistSnapshot();

    void fetch("/api/v1/nodes/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        {
          id: targetToExtract.id,
          sort_order: targetToExtract.sort_order,
          grid_x: free.x,
          grid_y: free.y,
          width: w,
          height: h,
          parent_id: null,
        },
      ]),
    });
  }
}
