import type { CalendarEvent, CalendarSyncStatus, DashboardNode } from "../types";
import type { SessionStore } from "./session.svelte";

export class CalendarController {
  private session: SessionStore;
  syncingCalendarNodes = $state<Record<string, boolean>>({});

  constructor(session: SessionStore) {
    this.session = session;
  }

  getCalendarEventsForNode(node: DashboardNode): CalendarEvent[] {
    if (node.id === "gallery-preview-node") {
      return node.settings?.events ?? [];
    }

    const rawSignal = this.session.signals[`calendar:events:${node.id}`];
    const syncedEvents: CalendarEvent[] = Array.isArray(rawSignal)
      ? (rawSignal as CalendarEvent[])
      : [];

    return [...syncedEvents].sort((a, b) => {
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

  async syncCalendarNodeNow(nodeId: string): Promise<void> {
    if (this.syncingCalendarNodes[nodeId]) return;
    this.syncingCalendarNodes[nodeId] = true;
    try {
      const res = await fetch(`/api/v1/nodes/${nodeId}/calendar-sync`, {
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
