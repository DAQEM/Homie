export type NodeType = "action" | "container" | "clock" | "search" | "todo" | "calendar";

export interface TodoItem {
  id: string;
  text: string;
  date?: string;
  priority?: boolean;
  done: boolean;
}

export interface CalendarEvent {
  id: string;
  title: string;
  time: string;
}

export interface NodeSettings {
  // Clock widget settings
  timezone?: string;
  flag?: string;
  // Search widget settings
  placeholder?: string;
  engineUrl?: string;
  // Todo widget settings
  todos?: TodoItem[];
  // Calendar widget settings
  events?: CalendarEvent[];
}

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
  settings?: NodeSettings;
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
  settings: NodeSettings;
}

export interface DragEndEventPayload {
  canceled?: boolean;
  operation?: {
    source?: { id?: string | number } | null;
    target?: { id?: string | number } | null;
  };
}

export function getNodeIconSrc(node: DashboardNode): string | null {
  if (node.node_type !== "action") return null;
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
