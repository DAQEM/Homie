import {
  categorizeActionNode,
  type AppLibraryCategory,
  type AppLibraryCategoryId,
  type DashboardNode,
} from "../types";
import { APP_USAGE_STORAGE_KEY, CATEGORY_LABELS } from "./constants";
import { session } from "./session.svelte";

export class AppLibraryController {
  appUsageMap = $state<Record<string, number>>({});
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  recentDockNodes = $derived.by<DashboardNode[]>(() => {
    const dockedIds = new Set(session.dockNodes.map((n) => n.id));
    const candidates = session.nodes.filter(
      (n) => n.node_type === "action" && !dockedIds.has(n.id),
    );

    return candidates
      .sort((a, b) => {
        const usageA = this.appUsageMap[a.id] ?? 0;
        const usageB = this.appUsageMap[b.id] ?? 0;
        if (usageA !== usageB) return usageB - usageA;
        return b.created_at.localeCompare(a.created_at);
      })
      .slice(0, 2);
  });

  appLibraryCategories = $derived.by<AppLibraryCategory[]>(() => {
    const buckets: Record<AppLibraryCategoryId, DashboardNode[]> = {
      productivity: [],
      dev: [],
      media: [],
      social: [],
      utilities: [],
    };

    const allActions = session.nodes
      .filter((n) => n.node_type === "action")
      .sort((a, b) => {
        const usageA = this.appUsageMap[a.id] ?? 0;
        const usageB = this.appUsageMap[b.id] ?? 0;
        if (usageA !== usageB) return usageB - usageA;
        return a.title.localeCompare(b.title);
      });

    for (const node of allActions) {
      const cat = categorizeActionNode(node);
      buckets[cat].push(node);
    }

    const order: AppLibraryCategoryId[] = ["productivity", "dev", "media", "social", "utilities"];

    return order
      .map((id) => ({
        id,
        title: CATEGORY_LABELS[id],
        nodes: buckets[id],
      }))
      .filter((cat) => cat.nodes.length > 0);
  });

  defaultSearchEngineUrl = $derived<string>(
    session.nodes.find((n) => n.node_type === "search" && n.settings?.engineUrl)?.settings
      ?.engineUrl ?? "https://www.google.com/search?q=",
  );

  constructor() {
    const usageRaw = localStorage.getItem(APP_USAGE_STORAGE_KEY);
    if (usageRaw) {
      try {
        this.appUsageMap = JSON.parse(usageRaw) as Record<string, number>;
      } catch {
        // Ignore invalid usage cache
      }
    }
  }

  hydrateFromServer(raw: unknown): void {
    if (!raw || typeof raw !== "object") return;
    const serverMap = raw as Record<string, number>;
    const merged: Record<string, number> = { ...serverMap };
    for (const [k, v] of Object.entries(this.appUsageMap)) {
      if (typeof v === "number" && v > (merged[k] ?? 0)) {
        merged[k] = v;
      }
    }
    this.appUsageMap = merged;
    try {
      localStorage.setItem(APP_USAGE_STORAGE_KEY, JSON.stringify(this.appUsageMap));
    } catch {
      // Ignore storage quota errors
    }
  }

  recordAppLaunch(nodeId: string): void {
    this.appUsageMap[nodeId] = Date.now();
    try {
      localStorage.setItem(APP_USAGE_STORAGE_KEY, JSON.stringify(this.appUsageMap));
    } catch {
      // Ignore storage quota errors
    }

    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      void fetch("/api/v1/preferences/app_usage", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.appUsageMap),
      });
    }, 600);
  }
}
