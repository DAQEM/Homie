import type { CalendarEvent, CalendarSyncStatus, DashboardNode } from "../types";
import { apiFetch, type SessionStore } from "./session.svelte";

export class CalendarController {
  private session: SessionStore;
  syncingCalendarNodes = $state<Record<string, boolean>>({});
  loadingRangeKeys = $state<Record<string, boolean>>({});
  private rangeEventsByNode = $state<Record<string, Record<string, CalendarEvent>>>({});
  private loadedRanges = new Set<string>();

  constructor(session: SessionStore) {
    this.session = session;
  }

  reset(): void {
    this.syncingCalendarNodes = {};
    this.loadingRangeKeys = {};
    this.rangeEventsByNode = {};
    this.loadedRanges.clear();
  }

  getCalendarEventsForNode(node: DashboardNode): CalendarEvent[] {
    if (node.id === "gallery-preview-node") {
      return node.settings?.events ?? [];
    }

    const rawSignal = this.session.signals[`calendar:events:${node.id}`];
    const syncedEvents: CalendarEvent[] = Array.isArray(rawSignal)
      ? (rawSignal as CalendarEvent[])
      : [];

    const extraMap = this.rangeEventsByNode[node.id];
    const combinedMap = new Map<string, CalendarEvent>();

    if (extraMap) {
      for (const [id, ev] of Object.entries(extraMap)) {
        combinedMap.set(id, ev);
      }
    }
    for (const ev of syncedEvents) {
      combinedMap.set(ev.id, ev);
    }

    return Array.from(combinedMap.values()).sort((a, b) => {
      const aDate = a.date ?? "";
      const bDate = b.date ?? "";
      if (aDate !== bDate) return aDate.localeCompare(bDate);

      const aAllDay = Boolean(a.isAllDay || a.time.toLowerCase() === "all day");
      const bAllDay = Boolean(b.isAllDay || b.time.toLowerCase() === "all day");
      if (aAllDay !== bAllDay) return aAllDay ? -1 : 1;

      return a.time.localeCompare(b.time) || a.title.localeCompare(b.title);
    });
  }

  getCalendarStatusForNode(nodeId: string): CalendarSyncStatus | null {
    const raw = this.session.signals[`calendar:status:${nodeId}`];
    if (raw && typeof raw === "object" && "feeds" in raw) {
      return raw as CalendarSyncStatus;
    }
    return null;
  }

  async ensureMonthRangeLoaded(nodeId: string, year: number, monthIndex: number): Promise<void> {
    if (!nodeId || nodeId === "gallery-preview-node") return;

    const targetStart = new Date(year, monthIndex, -7);
    const targetEnd = new Date(year, monthIndex + 1, 7);

    const now = this.session.now;
    const sseMin = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 25);
    const sseMax = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 115);

    if (targetStart >= sseMin && targetEnd <= sseMax) {
      return;
    }

    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const startIso = fmt(targetStart);
    const endIso = fmt(targetEnd);
    const cacheKey = `${nodeId}:${year}-${String(monthIndex + 1).padStart(2, "0")}`;

    if (this.loadedRanges.has(cacheKey) || this.loadingRangeKeys[cacheKey]) {
      return;
    }

    this.loadingRangeKeys[cacheKey] = true;
    try {
      const res = await apiFetch(
        `/api/v1/nodes/${nodeId}/calendar-events?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`,
      );
      if (res.ok) {
        const events = (await res.json()) as CalendarEvent[];
        const bucket = this.rangeEventsByNode[nodeId] ?? {};
        for (const ev of events) {
          bucket[ev.id] = ev;
        }
        this.rangeEventsByNode[nodeId] = bucket;
        this.loadedRanges.add(cacheKey);
      }
    } catch {
      // Ignore transient errors
    } finally {
      delete this.loadingRangeKeys[cacheKey];
    }
  }

  async syncCalendarNodeNow(nodeId: string): Promise<void> {
    if (this.syncingCalendarNodes[nodeId]) return;
    this.syncingCalendarNodes[nodeId] = true;
    try {
      for (const key of Array.from(this.loadedRanges)) {
        if (key.startsWith(`${nodeId}:`)) {
          this.loadedRanges.delete(key);
        }
      }
      delete this.rangeEventsByNode[nodeId];

      const res = await apiFetch(`/api/v1/nodes/${nodeId}/calendar-sync`, {
        method: "POST",
      });
      if (res.ok) {
        const status = (await res.json()) as CalendarSyncStatus;
        this.session.signals[`calendar:status:${nodeId}`] = status;
        this.session.persistSnapshot();
      }
    } catch {
      // Ignore transient network errors
    } finally {
      this.syncingCalendarNodes[nodeId] = false;
    }
  }
}
