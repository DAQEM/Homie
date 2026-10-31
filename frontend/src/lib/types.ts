export type NodeType = "action" | "container";

export interface Workspace {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface DashboardNode {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  sort_order: number;
  grid_x: number;
  grid_y: number;
  title: string;
  icon: string | null;
  node_type: NodeType;
  url: string | null;
  width: number;
  height: number;
  created_at: string;
  updated_at: string;
}

export interface BootstrapPayload {
  workspaces: Workspace[];
  nodes: DashboardNode[];
  signals: Record<string, unknown>;
}

export interface SignalDelta {
  key: string;
  value: unknown;
}

export interface NodeModalState {
  open: boolean;
  mode: "create" | "edit";
  id: string | null;
  parent_id: string | null;
  grid_x: number;
  grid_y: number;
  title: string;
  icon: string | null;
  node_type: NodeType;
  url: string;
  width: number;
  height: number;
}

export interface DragEndEventPayload {
  canceled?: boolean;
  operation?: {
    source?: { id?: string | number } | null;
    target?: { id?: string | number } | null;
  };
}

export function getNodeIconSrc(node: DashboardNode): string | null {
  if (node.node_type === "container") return null;
  if (node.icon && node.icon.trim() !== "") {
    return node.icon;
  }
  if (!node.url) return null;
  try {
    const parsed = new URL(node.url);
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=64`;
  } catch {
    return null;
  }
}
