export type NodeType = "action" | "container" | "clock" | "search" | "todo" | "calendar";

export type WallpaperPreset = "cupertino" | "aurora" | "solar" | "titanium";

export interface AppearancePreferences {
  wallpaper: WallpaperPreset;
  showIconLabels: boolean;
  reducedParallax: boolean;
}

export interface TodoItem {
  id: string;
  text: string;
  date?: string;
  priority?: boolean;
  done: boolean;
}

export interface CalendarFeed {
  id: string;
  name: string;
  url: string;
  color: string;
  enabled?: boolean;
}

export interface CalendarFeedSyncResult {
  id: string;
  name: string;
  ok: boolean;
  error?: string;
  count: number;
}

export interface CalendarSyncStatus {
  lastSyncedAt: string;
  totalEvents: number;
  feeds: CalendarFeedSyncResult[];
}

export interface CalendarEvent {
  id: string;
  title: string;
  time: string;
  date?: string; // ISO YYYY-MM-DD
  color?: string;
  location?: string;
  description?: string;
  url?: string;
  isAllDay?: boolean;
  source?: "local" | "ical";
  feedId?: string;
  feedName?: string;
  startIso?: string;
  endIso?: string;
}

export interface WorldClockCity {
  name: string;
  timezone: string;
  flag?: string;
}

export interface NodeSettings {
  // Clock & Calendar shared timezone setting
  timezone?: string;
  flag?: string;
  clockFace?: "analog" | "digital";
  sweepSeconds?: boolean;
  cities?: WorldClockCity[];
  // Search widget settings
  placeholder?: string;
  engineUrl?: string;
  // Todo widget settings
  todos?: TodoItem[];
  // Calendar widget settings
  events?: CalendarEvent[];
  icalUrl?: string;
  calendarFeeds?: CalendarFeed[];
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

export type AppLibraryCategoryId = "dev" | "productivity" | "media" | "social" | "utilities";

export interface AppLibraryCategory {
  id: AppLibraryCategoryId;
  title: string;
  nodes: DashboardNode[];
}

/**
 * Resolves the icon URL through the local Go RAM cache (`/api/v1/icons/{domain}`)
 * so icons load instantaneously with immutable caching and zero external tracking.
 */
export function getNodeIconSrc(node: DashboardNode): string | null {
  if (node.node_type !== "action") return null;
  if (node.icon && node.icon.trim() !== "") {
    return node.icon;
  }
  if (!node.url) return null;
  try {
    const parsed = new URL(node.url);
    return `/api/v1/icons/${encodeURIComponent(parsed.hostname)}`;
  } catch {
    return null;
  }
}

const APPLE_SQUIRCLE_PALETTES = [
  "linear-gradient(160deg, #1e293b 0%, #0f172a 100%)",
  "linear-gradient(160deg, #1d4ed8 0%, #1e1b4b 100%)",
  "linear-gradient(160deg, #0369a1 0%, #0c4a6e 100%)",
  "linear-gradient(160deg, #4338ca 0%, #1e1b4b 100%)",
  "linear-gradient(160deg, #6d28d9 0%, #2e1065 100%)",
  "linear-gradient(160deg, #047857 0%, #064e3b 100%)",
  "linear-gradient(160deg, #b45309 0%, #451a03 100%)",
  "linear-gradient(160deg, #be123c 0%, #4c0519 100%)",
  "linear-gradient(160deg, #334155 0%, #111827 100%)",
  "linear-gradient(160deg, #0f766e 0%, #134e4a 100%)",
];

export function getNodeBrandGradient(node: DashboardNode): string {
  const raw = (node.url || node.title || "").toLowerCase();
  if (raw.includes("github.com")) {
    return "linear-gradient(160deg, #2b3137 0%, #161b22 100%)";
  }
  if (raw.includes("youtube.com") || raw.includes("netflix.com")) {
    return "linear-gradient(160deg, #451219 0%, #1f090d 100%)";
  }
  if (raw.includes("reddit.com") || raw.includes("news.ycombinator.com")) {
    return "linear-gradient(160deg, #4a2010 0%, #220e07 100%)";
  }
  if (raw.includes("spotify.com") || raw.includes("whatsapp.com")) {
    return "linear-gradient(160deg, #0e3f26 0%, #071f13 100%)";
  }
  if (raw.includes("discord.com") || raw.includes("twitch.tv")) {
    return "linear-gradient(160deg, #2d2a6e 0%, #161438 100%)";
  }
  if (raw.includes("google.com") || raw.includes("gmail.com")) {
    return "linear-gradient(160deg, #28354a 0%, #151c28 100%)";
  }

  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) | 0;
  }
  return APPLE_SQUIRCLE_PALETTES[Math.abs(hash) % APPLE_SQUIRCLE_PALETTES.length];
}

export function categorizeActionNode(node: DashboardNode): AppLibraryCategoryId {
  const haystack = `${node.title} ${node.url ?? ""}`.toLowerCase();

  if (
    /github|gitlab|vercel|cloudflare|docker|kubernetes|aws|gcp|azure|localhost|127\.0\.0\.1|portainer|proxmox|grafana|prometheus|linear|sentry|npm|crates|go\.dev|stackoverflow/.test(
      haystack,
    )
  ) {
    return "dev";
  }

  if (
    /youtube|netflix|spotify|twitch|plex|jellyfin|music|video|podcast|soundcloud|primevideo|disney|letterboxd|imdb/.test(
      haystack,
    )
  ) {
    return "media";
  }

  if (
    /reddit|discord|x\.com|twitter|mastodon|bluesky|threads|whatsapp|telegram|signal|slack|linkedin|instagram|news\.ycombinator|hackernews/.test(
      haystack,
    )
  ) {
    return "social";
  }

  if (
    /gmail|mail|calendar|notion|figma|docs|drive|dropbox|icloud|obsidian|todo|linear|jira|confluence|openai|chatgpt|claude|anthropic|perplexity/.test(
      haystack,
    )
  ) {
    return "productivity";
  }

  return "utilities";
}
