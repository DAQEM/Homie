import type {
  DashboardNode,
  VikunjaAccount,
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

  accounts = $derived.by<VikunjaAccount[]>(() => {
    const raw = this.session.signals["vikunja:accounts"];
    if (Array.isArray(raw)) {
      return raw as VikunjaAccount[];
    }
    const legacyStatus = this.session.signals["vikunja:status"] as VikunjaStatus | undefined;
    if (legacyStatus?.connected && legacyStatus.integrationId) {
      return [
        {
          ...legacyStatus,
          projects: Array.isArray(this.session.signals["vikunja:projects"])
            ? (this.session.signals["vikunja:projects"] as VikunjaProject[])
            : [],
          labels: Array.isArray(this.session.signals["vikunja:labels"])
            ? (this.session.signals["vikunja:labels"] as VikunjaLabel[])
            : [],
          tasks: Array.isArray(this.session.signals["vikunja:tasks"])
            ? (this.session.signals["vikunja:tasks"] as VikunjaTask[])
            : [],
        },
      ];
    }
    return [];
  });

  status = $derived.by<VikunjaStatus>(() => {
    if (this.accounts.length === 0) {
      return { connected: false, taskCount: 0 };
    }
    const primary = this.accounts[0];
    const totalTasks = this.accounts.reduce((acc, a) => acc + (a.taskCount || 0), 0);
    return {
      connected: this.accounts.some((a) => a.connected),
      integrationId: primary.integrationId,
      label: primary.label,
      serverUrl: primary.serverUrl,
      frontendUrl: primary.frontendUrl,
      username: primary.username,
      userId: primary.userId,
      version: primary.version,
      lastSyncedAt: primary.lastSyncedAt,
      taskCount: totalTasks,
      error: this.accounts.find((a) => a.error)?.error,
    };
  });

  projects = $derived<VikunjaProject[]>(this.accounts[0]?.projects ?? []);

  writableProjects = $derived<VikunjaProject[]>(this.getWritableProjects());

  labels = $derived<VikunjaLabel[]>(this.accounts[0]?.labels ?? []);

  tasks = $derived<VikunjaTask[]>(this.accounts[0]?.tasks ?? []);

  allTasks = $derived.by<{ account: VikunjaAccount; task: VikunjaTask }[]>(() => {
    const list: { account: VikunjaAccount; task: VikunjaTask }[] = [];
    for (const account of this.accounts) {
      for (const task of account.tasks ?? []) {
        list.push({ account, task });
      }
    }
    return list;
  });

  constructor(session: SessionStore) {
    this.session = session;
  }

  getAccountById(integrationId?: string | null): VikunjaAccount | null {
    if (integrationId) {
      return this.accounts.find((a) => a.integrationId === integrationId) ?? null;
    }
    return this.accounts[0] ?? null;
  }

  getAccountForNode(node?: DashboardNode | null): VikunjaAccount | null {
    const requestedId = node?.settings?.vikunjaIntegrationId;
    if (requestedId) {
      return this.accounts.find((a) => a.integrationId === requestedId) ?? null;
    }
    return this.accounts[0] ?? null;
  }

  getProjects(integrationId?: string | null): VikunjaProject[] {
    return this.getAccountById(integrationId)?.projects ?? [];
  }

  getWritableProjects(integrationId?: string | null): VikunjaProject[] {
    return this.getProjects(integrationId).filter((p) => p.id > 0 && !p.is_archived);
  }

  getLabels(integrationId?: string | null): VikunjaLabel[] {
    return this.getAccountById(integrationId)?.labels ?? [];
  }

  getTasks(integrationId?: string | null): VikunjaTask[] {
    return this.getAccountById(integrationId)?.tasks ?? [];
  }

  findTask(taskId: number | null, integrationId?: string | null): VikunjaTask | null {
    if (taskId === null) return null;
    if (integrationId) {
      return this.getAccountById(integrationId)?.tasks.find((t) => t.id === taskId) ?? null;
    }
    for (const acct of this.accounts) {
      const found = acct.tasks.find((t) => t.id === taskId);
      if (found) return found;
    }
    return null;
  }

  getProjectById(id: number, integrationId?: string | null): VikunjaProject | undefined {
    return this.getProjects(integrationId).find((p) => p.id === id);
  }

  formatTaskIdentifier(task: VikunjaTask, integrationId?: string | null): string {
    if (task.identifier) return task.identifier;
    const proj = this.getProjectById(task.project_id, integrationId);
    if (proj?.identifier) return `${proj.identifier}-${task.index}`;
    return `#${task.index || task.id}`;
  }

  getDefaultProjectId(node?: DashboardNode): number {
    const acct = this.getAccountForNode(node);
    const integrationId = acct?.integrationId;
    const writable = this.getWritableProjects(integrationId);

    if (
      node?.settings?.vikunjaDefaultProjectId &&
      writable.some((p) => p.id === node.settings?.vikunjaDefaultProjectId)
    ) {
      return node.settings.vikunjaDefaultProjectId;
    }
    if (
      node?.settings?.vikunjaFilter === "project" &&
      node.settings.vikunjaProjectId &&
      writable.some((p) => p.id === node.settings?.vikunjaProjectId)
    ) {
      return node.settings.vikunjaProjectId;
    }
    return writable[0]?.id ?? 0;
  }

  getTasksForNode(node: DashboardNode): VikunjaTask[] {
    if (node.id === "gallery-preview-node") {
      return SAMPLE_PREVIEW_TASKS;
    }

    const acct = this.getAccountForNode(node);
    if (!acct) return [];

    const scope = node.settings?.vikunjaFilter ?? "all";
    const now = this.session.now;
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const inSevenDays = new Date(endOfToday.getTime() + 7 * 86400 * 1000);

    const filtered = (acct.tasks ?? []).filter((t) => {
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
    integrationId?: string | null,
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

    const projMatch = text.match(/(?:^|\s)[#+]([a-zA-Z0-9_-]+)/);
    if (projMatch) {
      const needle = projMatch[1].toLowerCase();
      const matched = this.getWritableProjects(integrationId).find(
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

  private resolveIntegrationId(integrationId?: string | null): string | undefined {
    return integrationId || this.accounts[0]?.integrationId;
  }

  private withIntegrationQuery(path: string, integrationId?: string | null): string {
    const targetId = this.resolveIntegrationId(integrationId);
    if (!targetId) return path;
    const sep = path.includes("?") ? "&" : "?";
    return `${path}${sep}integration_id=${encodeURIComponent(targetId)}`;
  }

  private setAccountTasks(
    integrationId: string,
    updater: (tasks: VikunjaTask[]) => VikunjaTask[],
  ): VikunjaAccount[] {
    const prev = this.accounts;
    const next = prev.map((acct) => {
      if (acct.integrationId !== integrationId) return acct;
      const nextTasks = updater(acct.tasks ?? []);
      return {
        ...acct,
        tasks: nextTasks,
        taskCount: nextTasks.filter((t) => !t.done).length,
      };
    });
    this.session.signals["vikunja:accounts"] = next;
    if (next[0]?.integrationId === integrationId) {
      this.session.signals["vikunja:tasks"] = next[0].tasks;
    }
    this.session.persistSnapshot();
    return prev;
  }

  private upsertAccountSignal(account: VikunjaAccount): void {
    const current = [...this.accounts];
    const idx = current.findIndex((a) => a.integrationId === account.integrationId);
    if (idx >= 0) {
      current[idx] = account;
    } else {
      current.push(account);
    }
    this.session.signals["vikunja:accounts"] = current;
    if (current[0]?.integrationId === account.integrationId) {
      this.session.signals["vikunja:status"] = account;
      this.session.signals["vikunja:projects"] = account.projects;
      this.session.signals["vikunja:labels"] = account.labels;
      this.session.signals["vikunja:tasks"] = account.tasks;
    }
    this.session.persistSnapshot();
  }

  async connect(payload: {
    integration_id?: string;
    label?: string;
    server_url: string;
    api_token?: string;
    username?: string;
    password?: string;
    totp_passcode?: string;
  }): Promise<{ error: string | null; account?: VikunjaAccount }> {
    this.isConnecting = true;
    try {
      const res = await fetch("/api/v1/integrations/vikunja/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials: payload }),
      });
      if (!res.ok) {
        const msg = await res.text();
        return { error: msg.trim() || `Connection failed (HTTP ${res.status})` };
      }
      const account = (await res.json()) as VikunjaAccount;
      this.upsertAccountSignal(account);
      return { error: null, account };
    } catch (e) {
      return {
        error: e instanceof Error ? e.message : "Network error connecting to Vikunja",
      };
    } finally {
      this.isConnecting = false;
    }
  }

  async disconnect(integrationId?: string | null): Promise<void> {
    const id = this.resolveIntegrationId(integrationId);
    if (!id) return;
    await fetch(`/api/v1/integrations/${id}`, { method: "DELETE" });

    const remaining = this.accounts.filter((a) => a.integrationId !== id);
    this.session.signals["vikunja:accounts"] = remaining;
    if (remaining.length === 0) {
      this.session.signals["vikunja:status"] = { connected: false, taskCount: 0 };
      this.session.signals["vikunja:tasks"] = [];
      this.session.signals["vikunja:projects"] = [];
      this.session.signals["vikunja:labels"] = [];
    } else {
      const primary = remaining[0];
      this.session.signals["vikunja:status"] = primary;
      this.session.signals["vikunja:projects"] = primary.projects;
      this.session.signals["vikunja:labels"] = primary.labels;
      this.session.signals["vikunja:tasks"] = primary.tasks;
    }
    this.session.persistSnapshot();
  }

  async syncNow(integrationId?: string | null): Promise<void> {
    if (this.isSyncing) return;
    this.isSyncing = true;
    try {
      const url = integrationId
        ? `/api/v1/vikunja/sync?integration_id=${encodeURIComponent(integrationId)}`
        : "/api/v1/vikunja/sync";
      const res = await fetch(url, { method: "POST" });
      if (res.ok) {
        const acct = (await res.json()) as VikunjaAccount;
        if (acct.integrationId) {
          this.upsertAccountSignal(acct);
        }
      }
    } finally {
      this.isSyncing = false;
    }
  }

  async createTask(
    input: {
      project_id: number;
      title: string;
      description?: string;
      priority?: number;
      due_date?: string;
      is_favorite?: boolean;
      label_ids?: number[];
    },
    integrationId?: string | null,
  ): Promise<VikunjaTask | null> {
    const targetId = this.resolveIntegrationId(integrationId);
    if (!targetId) return null;

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
      labels: this.getLabels(targetId).filter((l) => input.label_ids?.includes(l.id)),
      created: new Date().toISOString(),
    };

    const prev = this.setAccountTasks(targetId, (tasks) => [optimistic, ...tasks]);

    try {
      const res = await fetch("/api/v1/vikunja/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, integration_id: targetId }),
      });
      if (!res.ok) throw new Error("Failed creating task");
      const created = (await res.json()) as VikunjaTask;
      this.setAccountTasks(targetId, (tasks) => [
        created,
        ...tasks.filter((t) => t.id !== tempId && t.id !== created.id),
      ]);
      return created;
    } catch {
      this.session.signals["vikunja:accounts"] = prev;
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
    integrationId?: string | null,
  ): Promise<VikunjaTask | null> {
    const targetId = this.resolveIntegrationId(integrationId);
    if (!targetId) return null;

    const cleanDue = patch.due_date === VIKUNJA_ZERO_DATE ? "" : patch.due_date;
    const prev = this.setAccountTasks(targetId, (tasks) =>
      tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              ...patch,
              ...(patch.due_date !== undefined ? { due_date: cleanDue } : {}),
            }
          : t,
      ),
    );

    try {
      const res = await fetch(
        this.withIntegrationQuery(`/api/v1/vikunja/tasks/${taskIDOrThrow(taskId)}`, targetId),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      if (!res.ok) throw new Error("Failed updating task");
      const updated = (await res.json()) as VikunjaTask;
      this.setAccountTasks(targetId, (tasks) => tasks.map((t) => (t.id === taskId ? updated : t)));
      return updated;
    } catch {
      this.session.signals["vikunja:accounts"] = prev;
      this.session.persistSnapshot();
      return null;
    }
  }

  async deleteTask(taskId: number, integrationId?: string | null): Promise<boolean> {
    const targetId = this.resolveIntegrationId(integrationId);
    if (!targetId) return false;

    const prev = this.setAccountTasks(targetId, (tasks) => tasks.filter((t) => t.id !== taskId));

    try {
      const res = await fetch(
        this.withIntegrationQuery(`/api/v1/vikunja/tasks/${taskId}`, targetId),
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Failed deleting task");
      return true;
    } catch {
      this.session.signals["vikunja:accounts"] = prev;
      this.session.persistSnapshot();
      return false;
    }
  }

  async toggleTaskLabel(
    taskId: number,
    label: VikunjaLabel,
    attach: boolean,
    integrationId?: string | null,
  ): Promise<void> {
    const targetId = this.resolveIntegrationId(integrationId);
    if (!targetId) return;

    const prev = this.setAccountTasks(targetId, (tasks) =>
      tasks.map((t) => {
        if (t.id !== taskId) return t;
        const existing = t.labels ?? [];
        const nextLabels = attach
          ? [...existing.filter((l) => l.id !== label.id), label]
          : existing.filter((l) => l.id !== label.id);
        return { ...t, labels: nextLabels };
      }),
    );

    try {
      const base = attach
        ? `/api/v1/vikunja/tasks/${taskId}/labels`
        : `/api/v1/vikunja/tasks/${taskId}/labels/${label.id}`;
      const res = await fetch(this.withIntegrationQuery(base, targetId), {
        method: attach ? "POST" : "DELETE",
        headers: attach ? { "Content-Type": "application/json" } : undefined,
        body: attach ? JSON.stringify({ label_id: label.id }) : undefined,
      });
      if (!res.ok) throw new Error("Failed updating label");
      const updated = (await res.json()) as VikunjaTask;
      this.setAccountTasks(targetId, (tasks) => tasks.map((t) => (t.id === taskId ? updated : t)));
    } catch {
      this.session.signals["vikunja:accounts"] = prev;
    }
  }

  async fetchComments(taskId: number, integrationId?: string | null): Promise<VikunjaComment[]> {
    const res = await fetch(
      this.withIntegrationQuery(`/api/v1/vikunja/tasks/${taskId}/comments`, integrationId),
    );
    if (!res.ok) return [];
    return (await res.json()) as VikunjaComment[];
  }

  async postComment(
    taskId: number,
    plainText: string,
    integrationId?: string | null,
  ): Promise<VikunjaComment | null> {
    const html = plainTextToTipTapHTML(plainText);
    const res = await fetch(
      this.withIntegrationQuery(`/api/v1/vikunja/tasks/${taskId}/comments`, integrationId),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: html }),
      },
    );
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
