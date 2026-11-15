import type {
  DashboardNode,
  VikunjaComment,
  VikunjaLabel,
  VikunjaProject,
  VikunjaStatus,
  VikunjaTask,
} from "../types";
import type { SessionStore } from "./session.svelte";

export const VIKUNJA_ZERO_DATE = "0001-01-01T00:00:00Z";

export class VikunjaController {
  private session: SessionStore;
  isSyncing = $state(false);
  isConnecting = $state(false);

  status = $derived.by<VikunjaStatus>(() => {
    const raw = this.session.signals["vikunja:status"];
    if (raw && typeof raw === "object" && "connected" in raw) {
      return raw as VikunjaStatus;
    }
    return { connected: false, taskCount: 0 };
  });

  projects = $derived.by<VikunjaProject[]>(() => {
    const raw = this.session.signals["vikunja:projects"];
    return Array.isArray(raw) ? (raw as VikunjaProject[]) : [];
  });

  writableProjects = $derived<VikunjaProject[]>(
    this.projects.filter((p) => p.id > 0 && !p.is_archived),
  );

  labels = $derived.by<VikunjaLabel[]>(() => {
    const raw = this.session.signals["vikunja:labels"];
    return Array.isArray(raw) ? (raw as VikunjaLabel[]) : [];
  });

  tasks = $derived.by<VikunjaTask[]>(() => {
    const raw = this.session.signals["vikunja:tasks"];
    return Array.isArray(raw) ? (raw as VikunjaTask[]) : [];
  });

  constructor(session: SessionStore) {
    this.session = session;
  }

  getProjectById(id: number): VikunjaProject | undefined {
    return this.projects.find((p) => p.id === id);
  }

  formatTaskIdentifier(task: VikunjaTask): string {
    if (task.identifier) return task.identifier;
    const proj = this.getProjectById(task.project_id);
    if (proj?.identifier) return `${proj.identifier}-${task.index}`;
    return `#${task.index || task.id}`;
  }

  getDefaultProjectId(node?: DashboardNode): number {
    if (node?.settings?.vikunjaDefaultProjectId && node.settings.vikunjaDefaultProjectId > 0) {
      return node.settings.vikunjaDefaultProjectId;
    }
    if (
      node?.settings?.vikunjaFilter === "project" &&
      node.settings.vikunjaProjectId &&
      node.settings.vikunjaProjectId > 0
    ) {
      return node.settings.vikunjaProjectId;
    }
    return this.writableProjects[0]?.id ?? 0;
  }

  getTasksForNode(node: DashboardNode): VikunjaTask[] {
    if (node.id === "gallery-preview-node") {
      return SAMPLE_PREVIEW_TASKS;
    }

    const scope = node.settings?.vikunjaFilter ?? "all";
    const now = this.session.now;
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const inSevenDays = new Date(endOfToday.getTime() + 7 * 86400 * 1000);

    const filtered = this.tasks.filter((t) => {
      switch (scope) {
        case "today": {
          if (!t.due_date) return false;
          const due = new Date(t.due_date);
          return !Number.isNaN(due.getTime()) && due <= endOfToday;
        }
        case "upcoming": {
          if (!t.due_date) return false;
          const due = new Date(t.due_date);
          return !Number.isNaN(due.getTime()) && due <= inSevenDays;
        }
        case "favorites":
          return t.is_favorite;
        case "high_priority":
          return (t.priority ?? 0) >= 3;
        case "project":
          return node.settings?.vikunjaProjectId
            ? t.project_id === node.settings.vikunjaProjectId
            : true;
        case "label":
          return node.settings?.vikunjaLabelId
            ? Boolean(t.labels?.some((l) => l.id === node.settings?.vikunjaLabelId))
            : true;
        case "all":
        default:
          return true;
      }
    });

    return [...filtered].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if ((a.priority || 0) !== (b.priority || 0)) return (b.priority || 0) - (a.priority || 0);
      const aDue = a.due_date ? new Date(a.due_date).getTime() : Number.MAX_SAFE_INTEGER;
      const bDue = b.due_date ? new Date(b.due_date).getTime() : Number.MAX_SAFE_INTEGER;
      if (aDue !== bDue) return aDue - bDue;
      return b.id - a.id;
    });
  }

  /**
   * Parses natural inline syntax: `!`, `!!`, `!!!`, `#project`, `today`, `tomorrow`.
   */
  parseQuickInput(
    rawInput: string,
    fallbackProjectId: number,
  ): {
    title: string;
    priority: number;
    projectId: number;
    dueDate: string;
  } {
    let text = rawInput.trim();
    let priority = 0;
    let projectId = fallbackProjectId;
    let dueDate = "";

    // Priority bangs (!=2 medium, !!=3 high, !!!=4 urgent)
    if (/(^|\s)!!!(\s|$)/.test(text)) {
      priority = 4;
      text = text.replace(/(^|\s)!!!(?=\s|$)/g, " ");
    } else if (/(^|\s)!!(\s|$)/.test(text)) {
      priority = 3;
      text = text.replace(/(^|\s)!!(?=\s|$)/g, " ");
    } else if (/(^|\s)!(\s|$)/.test(text) || text.endsWith("!")) {
      priority = 2;
      text = text.replace(/(^|\s)!(?=\s|$)|!$/g, " ");
    }

    // Due date shortcuts
    const now = this.session.now;
    if (/\b(today|@today)\b/i.test(text)) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0);
      dueDate = d.toISOString();
      text = text.replace(/\b(today|@today)\b/gi, " ");
    } else if (/\b(tomorrow|@tomorrow)\b/i.test(text)) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 18, 0, 0);
      dueDate = d.toISOString();
      text = text.replace(/\b(tomorrow|@tomorrow)\b/gi, " ");
    }

    // #project or +project matching
    const projMatch = text.match(/(?:^|\s)[#+]([a-zA-Z0-9_-]+)/);
    if (projMatch) {
      const needle = projMatch[1].toLowerCase();
      const matched = this.writableProjects.find(
        (p) =>
          p.title.toLowerCase() === needle ||
          p.title.toLowerCase().startsWith(needle) ||
          (p.identifier && p.identifier.toLowerCase() === needle),
      );
      if (matched) {
        projectId = matched.id;
        text = text.replace(projMatch[0], " ");
      }
    }

    return {
      title: text.replace(/\s+/g, " ").trim(),
      priority,
      projectId,
      dueDate,
    };
  }

  async connect(payload: {
    server_url: string;
    api_token?: string;
    username?: string;
    password?: string;
    totp_passcode?: string;
  }): Promise<string | null> {
    this.isConnecting = true;
    try {
      const res = await fetch("/api/v1/integrations/vikunja/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials: payload }),
      });
      if (!res.ok) {
        const msg = await res.text();
        return msg.trim() || `Connection failed (HTTP ${res.status})`;
      }
      const status = (await res.json()) as VikunjaStatus;
      this.session.signals["vikunja:status"] = status;
      this.session.persistSnapshot();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Network error connecting to Vikunja";
    } finally {
      this.isConnecting = false;
    }
  }

  async disconnect(): Promise<void> {
    const id = this.status.integrationId;
    if (!id) return;
    await fetch(`/api/v1/integrations/${id}`, { method: "DELETE" });
    this.session.signals["vikunja:status"] = { connected: false, taskCount: 0 };
    this.session.signals["vikunja:tasks"] = [];
    this.session.signals["vikunja:projects"] = [];
    this.session.signals["vikunja:labels"] = [];
    this.session.persistSnapshot();
  }

  async syncNow(): Promise<void> {
    if (this.isSyncing) return;
    this.isSyncing = true;
    try {
      const res = await fetch("/api/v1/vikunja/sync", { method: "POST" });
      if (res.ok) {
        const status = (await res.json()) as VikunjaStatus;
        this.session.signals["vikunja:status"] = status;
        this.session.persistSnapshot();
      }
    } finally {
      this.isSyncing = false;
    }
  }

  async createTask(input: {
    project_id: number;
    title: string;
    description?: string;
    priority?: number;
    due_date?: string;
    is_favorite?: boolean;
    label_ids?: number[];
  }): Promise<VikunjaTask | null> {
    const tempId = -Date.now();
    const optimistic: VikunjaTask = {
      id: tempId,
      index: 0,
      project_id: input.project_id,
      title: input.title,
      description: input.description ?? "",
      done: false,
      priority: input.priority ?? 0,
      due_date: input.due_date ?? "",
      is_favorite: Boolean(input.is_favorite),
      percent_done: 0,
      labels: this.labels.filter((l) => input.label_ids?.includes(l.id)),
      created: new Date().toISOString(),
    };

    const prev = [...this.tasks];
    this.session.signals["vikunja:tasks"] = [optimistic, ...prev];
    this.session.persistSnapshot();

    try {
      const res = await fetch("/api/v1/vikunja/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error("Failed creating task");
      const created = (await res.json()) as VikunjaTask;
      this.session.signals["vikunja:tasks"] = [
        created,
        ...this.tasks.filter((t) => t.id !== tempId && t.id !== created.id),
      ];
      this.session.persistSnapshot();
      return created;
    } catch {
      this.session.signals["vikunja:tasks"] = prev;
      this.session.persistSnapshot();
      return null;
    }
  }

  async updateTask(
    taskId: number,
    patch: Partial<{
      title: string;
      description: string;
      done: boolean;
      priority: number;
      due_date: string;
      is_favorite: boolean;
      percent_done: number;
      project_id: number;
    }>,
  ): Promise<VikunjaTask | null> {
    const prev = [...this.tasks];
    const cleanDue = patch.due_date === VIKUNJA_ZERO_DATE ? "" : patch.due_date;

    this.session.signals["vikunja:tasks"] = prev.map((t) =>
      t.id === taskId
        ? {
            ...t,
            ...patch,
            ...(patch.due_date !== undefined ? { due_date: cleanDue } : {}),
          }
        : t,
    );
    this.session.persistSnapshot();

    try {
      const res = await fetch(`/api/v1/vikunja/tasks/${taskIDOrThrow(taskId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("Failed updating task");
      const updated = (await res.json()) as VikunjaTask;
      this.session.signals["vikunja:tasks"] = this.tasks.map((t) =>
        t.id === taskId ? updated : t,
      );
      this.session.persistSnapshot();
      return updated;
    } catch {
      this.session.signals["vikunja:tasks"] = prev;
      this.session.persistSnapshot();
      return null;
    }
  }

  async deleteTask(taskId: number): Promise<boolean> {
    const prev = [...this.tasks];
    this.session.signals["vikunja:tasks"] = prev.filter((t) => t.id !== taskId);
    this.session.persistSnapshot();

    try {
      const res = await fetch(`/api/v1/vikunja/tasks/${taskId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed deleting task");
      return true;
    } catch {
      this.session.signals["vikunja:tasks"] = prev;
      this.session.persistSnapshot();
      return false;
    }
  }

  async toggleTaskLabel(taskId: number, label: VikunjaLabel, attach: boolean): Promise<void> {
    const prev = [...this.tasks];
    this.session.signals["vikunja:tasks"] = prev.map((t) => {
      if (t.id !== taskId) return t;
      const existing = t.labels ?? [];
      const nextLabels = attach
        ? [...existing.filter((l) => l.id !== label.id), label]
        : existing.filter((l) => l.id !== label.id);
      return { ...t, labels: nextLabels };
    });

    try {
      const url = attach
        ? `/api/v1/vikunja/tasks/${taskId}/labels`
        : `/api/v1/vikunja/tasks/${taskId}/labels/${label.id}`;
      const res = await fetch(url, {
        method: attach ? "POST" : "DELETE",
        headers: attach ? { "Content-Type": "application/json" } : undefined,
        body: attach ? JSON.stringify({ label_id: label.id }) : undefined,
      });
      if (!res.ok) throw new Error("Failed updating label");
      const updated = (await res.json()) as VikunjaTask;
      this.session.signals["vikunja:tasks"] = this.tasks.map((t) =>
        t.id === taskId ? updated : t,
      );
      this.session.persistSnapshot();
    } catch {
      this.session.signals["vikunja:tasks"] = prev;
    }
  }

  async fetchComments(taskId: number): Promise<VikunjaComment[]> {
    const res = await fetch(`/api/v1/vikunja/tasks/${taskId}/comments`);
    if (!res.ok) return [];
    return (await res.json()) as VikunjaComment[];
  }

  async postComment(taskId: number, plainText: string): Promise<VikunjaComment | null> {
    const html = plainTextToTipTapHTML(plainText);
    const res = await fetch(`/api/v1/vikunja/tasks/${taskId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment: html }),
    });
    if (!res.ok) return null;
    return (await res.json()) as VikunjaComment;
  }
}

function taskIDOrThrow(id: number): number {
  if (id <= 0) throw new Error("Invalid Vikunja task id");
  return id;
}

export function htmlToPlainText(html?: string): string {
  if (!html) return "";
  if (typeof DOMParser === "undefined") return html.replace(/<[^>]+>/g, " ").trim();
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

export function plainTextToTipTapHTML(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = escaped.split(/\r?\n/);
  return lines.map((line) => (line.trim() === "" ? "<p></p>" : `<p>${line}</p>`)).join("");
}

const SAMPLE_PREVIEW_TASKS: VikunjaTask[] = [
  {
    id: 101,
    index: 12,
    identifier: "HOME-12",
    project_id: 1,
    title: "Deploy Homie + Vikunja sync",
    done: false,
    priority: 4,
    is_favorite: true,
    percent_done: 0.5,
    labels: [{ id: 1, title: "infra", hex_color: "#0A84FF" }],
  },
  {
    id: 102,
    index: 14,
    identifier: "HOME-14",
    project_id: 1,
    title: "Review macOS widget density",
    done: false,
    priority: 2,
    is_favorite: false,
    percent_done: 0,
  },
];
