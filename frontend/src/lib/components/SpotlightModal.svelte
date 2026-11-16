<script lang="ts">
    import {
        ArrowUpRight,
        Calendar,
        CheckCircle2,
        Folder,
        Globe,
        History,
        Layers,
        Search,
        Sparkles,
    } from "@lucide/svelte";
    import { dashboard } from "../state/dashboard.svelte";
    import {
        getNodeBrandGradient,
        getNodeIconSrc,
        type DashboardNode,
    } from "../types";

    interface FirefoxHistoryItem {
        url: string;
        title: string;
        lastVisitTime?: number;
        visitCount?: number;
    }

    interface SpotlightResult {
        id: string;
        kind:
            | "action"
            | "folder"
            | "todo"
            | "calendar"
            | "workspace"
            | "history"
            | "command"
            | "web";
        title: string;
        subtitle: string;
        node?: DashboardNode;
        workspaceId?: string;
        execute: () => void | Promise<void>;
    }

    let query = $state("");
    let selectedIndex = $state(0);
    let inputEl: HTMLInputElement | undefined = $state();

    let historyBridgeReady = $state(false);
    let historyItems = $state<FirefoxHistoryItem[]>([]);
    let latestHistoryReqId = 0;
    let historyDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    function requestFirefoxHistory(searchText: string) {
        if (typeof window === "undefined") return;
        const reqId = ++latestHistoryReqId;
        window.postMessage(
            {
                type: "HOMIE_HISTORY_QUERY",
                requestId: reqId,
                query: searchText,
                maxResults: 6,
            },
            window.location.origin,
        );
    }

    $effect(() => {
        if (typeof window === "undefined") return;

        const onMessage = (event: MessageEvent) => {
            if (
                event.source !== window ||
                event.origin !== window.location.origin
            ) {
                return;
            }
            const msg = event.data;
            if (!msg || typeof msg !== "object") return;

            if (
                msg.type === "HOMIE_HISTORY_READY" ||
                msg.type === "HOMIE_HISTORY_PONG"
            ) {
                historyBridgeReady = true;
                if (dashboard.isSpotlightOpen && query.trim().length > 0) {
                    requestFirefoxHistory(query.trim());
                }
                return;
            }

            if (
                msg.type === "HOMIE_HISTORY_RESULTS" &&
                msg.requestId === latestHistoryReqId
            ) {
                historyBridgeReady = true;
                historyItems = Array.isArray(msg.items)
                    ? (msg.items as FirefoxHistoryItem[])
                    : [];
            }
        };

        window.addEventListener("message", onMessage);
        window.postMessage(
            { type: "HOMIE_HISTORY_PING" },
            window.location.origin,
        );

        return () => {
            window.removeEventListener("message", onMessage);
            if (historyDebounceTimer) {
                clearTimeout(historyDebounceTimer);
                historyDebounceTimer = null;
            }
        };
    });

    $effect(() => {
        if (dashboard.isSpotlightOpen) {
            query = dashboard.spotlightInitialQuery;
            selectedIndex = 0;
            historyItems = [];
            if (typeof window !== "undefined") {
                window.postMessage(
                    { type: "HOMIE_HISTORY_PING" },
                    window.location.origin,
                );
            }
            queueMicrotask(() => inputEl?.focus());
        } else {
            historyItems = [];
            if (historyDebounceTimer) {
                clearTimeout(historyDebounceTimer);
                historyDebounceTimer = null;
            }
        }
    });

    $effect(() => {
        if (!dashboard.isSpotlightOpen) return;
        const trimmed = query.trim();

        if (historyDebounceTimer) {
            clearTimeout(historyDebounceTimer);
            historyDebounceTimer = null;
        }

        if (!trimmed) {
            historyItems = [];
            return;
        }

        historyDebounceTimer = setTimeout(() => {
            historyDebounceTimer = null;
            requestFirefoxHistory(trimmed);
        }, 80);
    });

    function getWorkspaceName(wsId: string): string {
        return dashboard.workspaces.find((w) => w.id === wsId)?.name ?? "Home";
    }

    function formatRelativeVisit(ts?: number): string {
        if (!ts) return "";
        const diffMs = Math.max(0, Date.now() - ts);
        const mins = Math.floor(diffMs / 60000);
        if (mins < 1) return "just now";
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        if (days < 7) return `${days}d ago`;
        return new Date(ts).toLocaleDateString();
    }

    function formatHistoryDisplayUrl(rawUrl: string): string {
        try {
            const u = new URL(rawUrl);
            const path = u.pathname === "/" ? "" : u.pathname;
            return `${u.hostname}${path}`;
        } catch {
            return rawUrl;
        }
    }

    let activeTodoNode = $derived(
        dashboard.nodes.find(
            (n) =>
                n.workspace_id === dashboard.activeWorkspace?.id &&
                n.node_type === "todo",
        ) ?? dashboard.nodes.find((n) => n.node_type === "todo"),
    );

    let activeTodoAccount = $derived(
        dashboard.vikunja.getAccountForNode(activeTodoNode),
    );

    let results = $derived.by<SpotlightResult[]>(() => {
        const q = query.trim();
        const lower = q.toLowerCase();
        const list: SpotlightResult[] = [];
        const existingActionUrls = new Set<string>();

        // 1. Check Quick Commands (`todo: ...`, `remind: ...`, `v: ...`)
        if (
            lower.startsWith("todo:") ||
            lower.startsWith("remind:") ||
            lower.startsWith("v:")
        ) {
            const taskText = q.replace(/^(todo|remind|v):\s*/i, "").trim();
            if (taskText) {
                const targetAcctLabel = activeTodoAccount
                    ? activeTodoAccount.label ||
                      `@${activeTodoAccount.username}`
                    : "";
                list.push({
                    id: "cmd:todo",
                    kind: "command",
                    title: `Create Vikunja Task: "${taskText}"`,
                    subtitle: activeTodoAccount?.connected
                        ? `${targetAcctLabel ? `${targetAcctLabel} • ` : ""}Supports #project, !priority, today / tomorrow`
                        : "Connect Vikunja in a Tasks widget first",
                    execute: async () => {
                        await dashboard.quickAddReminder(taskText);
                        dashboard.closeSpotlight();
                    },
                });
            }
        }

        // 2. Filter App Shortcuts (`action`) across all Workspaces & Folders
        for (const n of dashboard.nodes) {
            if (n.node_type !== "action") continue;
            if (
                !lower ||
                n.title.toLowerCase().includes(lower) ||
                (n.url && n.url.toLowerCase().includes(lower))
            ) {
                if (n.url) {
                    existingActionUrls.add(n.url.replace(/\/+$/, ""));
                }
                const wsName = getWorkspaceName(n.workspace_id);
                const parentFolder = n.parent_id
                    ? dashboard.nodes.find((p) => p.id === n.parent_id)
                    : null;
                const loc = parentFolder
                    ? `${wsName} • ${parentFolder.title}`
                    : wsName;

                list.push({
                    id: `action:${n.id}`,
                    kind: "action",
                    title: n.title,
                    subtitle: n.url ? `${loc} — ${n.url}` : loc,
                    node: n,
                    execute: () => {
                        dashboard.recordAppLaunch(n.id);
                        dashboard.closeSpotlight();
                        if (n.url) {
                            window.open(n.url, "_blank", "noopener,noreferrer");
                        }
                    },
                });
            }
        }

        // 3. Filter Folders (`container`)
        for (const n of dashboard.nodes) {
            if (n.node_type !== "container") continue;
            if (!lower || n.title.toLowerCase().includes(lower)) {
                const wsName = getWorkspaceName(n.workspace_id);
                const count = dashboard.getChildren(n.id).length;
                list.push({
                    id: `folder:${n.id}`,
                    kind: "folder",
                    title: n.title,
                    subtitle: `${wsName} • ${count} item${count === 1 ? "" : "s"}`,
                    node: n,
                    execute: () => {
                        dashboard.closeSpotlight();
                        dashboard.selectWorkspace(n.workspace_id);
                        dashboard.openFolderWithOrigin(n.id);
                    },
                });
            }
        }

        // 4. Filter Live Vikunja Tasks (across all accounts) & Synced .ics Calendar Events
        if (lower.length > 0) {
            const hasMultipleAccounts = dashboard.vikunja.accounts.length > 1;
            for (const { account, task: vt } of dashboard.vikunja.allTasks) {
                const ident = dashboard.vikunja.formatTaskIdentifier(
                    vt,
                    account.integrationId,
                );
                const proj = dashboard.vikunja.getProjectById(
                    vt.project_id,
                    account.integrationId,
                );
                const labelText = (vt.labels ?? [])
                    .map((l) => l.title)
                    .join(" ");
                if (
                    vt.title.toLowerCase().includes(lower) ||
                    ident.toLowerCase().includes(lower) ||
                    (proj?.title.toLowerCase().includes(lower) ?? false) ||
                    labelText.toLowerCase().includes(lower)
                ) {
                    const acctPrefix = hasMultipleAccounts
                        ? `${account.label || `@${account.username}`} • `
                        : "";
                    list.push({
                        id: `vikunja:${account.integrationId}:${vt.id}`,
                        kind: "todo",
                        title: vt.title,
                        subtitle: `${acctPrefix}${ident}${proj ? ` • ${proj.title}` : ""}${vt.done ? " (Done)" : ""}`,
                        execute: () => {
                            dashboard.closeSpotlight();
                            dashboard.openVikunjaModal(
                                vt.id,
                                account.integrationId,
                            );
                        },
                    });
                }
            }

            for (const n of dashboard.nodes) {
                if (n.node_type === "calendar") {
                    const calEvents = dashboard.getCalendarEventsForNode(n);
                    for (const ev of calEvents) {
                        if (
                            ev.title.toLowerCase().includes(lower) ||
                            ev.time.toLowerCase().includes(lower) ||
                            (ev.location &&
                                ev.location.toLowerCase().includes(lower))
                        ) {
                            const datePart = ev.date ? `${ev.date} • ` : "";
                            const feedPart = ev.feedName
                                ? ` (${ev.feedName})`
                                : "";
                            list.push({
                                id: `cal:${ev.id}`,
                                kind: "calendar",
                                title: ev.title,
                                subtitle: `${datePart}${ev.time}${feedPart} • ${getWorkspaceName(n.workspace_id)}`,
                                node: n,
                                execute: () => {
                                    dashboard.closeSpotlight();
                                    dashboard.selectWorkspace(n.workspace_id);
                                    dashboard.openCalendarModal(n.id, ev.date);
                                },
                            });
                        }
                    }
                }
            }

            // 5. Filter Workspaces / Pages
            for (const ws of dashboard.workspaces) {
                if (ws.name.toLowerCase().includes(lower)) {
                    list.push({
                        id: `ws:${ws.id}`,
                        kind: "workspace",
                        title: `Go to Page: ${ws.name}`,
                        subtitle: "Home Screen Page",
                        workspaceId: ws.id,
                        execute: () => {
                            dashboard.selectWorkspace(ws.id);
                            dashboard.closeSpotlight();
                        },
                    });
                }
            }

            // 6. Firefox Browsing History (from Homie History Bridge extension)
            for (const item of historyItems) {
                if (existingActionUrls.has(item.url.replace(/\/+$/, ""))) {
                    continue;
                }
                const shortUrl = formatHistoryDisplayUrl(item.url);
                const when = formatRelativeVisit(item.lastVisitTime);
                list.push({
                    id: `history:${item.url}`,
                    kind: "history",
                    title: item.title || shortUrl,
                    subtitle: `Firefox History • ${shortUrl}${when ? ` • ${when}` : ""}`,
                    execute: () => {
                        dashboard.closeSpotlight();
                        window.open(item.url, "_blank", "noopener,noreferrer");
                    },
                });
            }

            // 7. Web Search Fallback Row
            list.push({
                id: "web:search",
                kind: "web",
                title:
                    q.startsWith("http://") || q.startsWith("https://")
                        ? `Open URL "${q}"`
                        : `Search Web for "${q}"`,
                subtitle: "Launch in new tab (Shift + ↵)",
                execute: () => {
                    dashboard.closeSpotlight();
                    if (q.startsWith("http://") || q.startsWith("https://")) {
                        window.open(q, "_blank", "noopener,noreferrer");
                    } else {
                        window.open(
                            `${dashboard.defaultSearchEngineUrl}${encodeURIComponent(q)}`,
                            "_blank",
                            "noopener,noreferrer",
                        );
                    }
                },
            });
        }

        return list.slice(0, 14);
    });

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            e.preventDefault();
            dashboard.closeSpotlight();
            return;
        }

        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (results.length > 0) {
                selectedIndex = (selectedIndex + 1) % results.length;
            }
            return;
        }

        if (e.key === "ArrowUp") {
            e.preventDefault();
            if (results.length > 0) {
                selectedIndex =
                    (selectedIndex - 1 + results.length) % results.length;
            }
            return;
        }

        if (e.key === "Enter") {
            e.preventDefault();
            const q = query.trim();
            if (e.shiftKey && q) {
                dashboard.closeSpotlight();
                window.open(
                    `${dashboard.defaultSearchEngineUrl}${encodeURIComponent(q)}`,
                    "_blank",
                    "noopener,noreferrer",
                );
                return;
            }

            const chosen = results[selectedIndex] ?? results[0];
            if (chosen) {
                void chosen.execute();
            }
        }
    }
</script>

{#if dashboard.isSpotlightOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        onclick={(e) =>
            e.target === e.currentTarget && dashboard.closeSpotlight()}
        class="fixed inset-0 z-50 bg-black/40 backdrop-blur-md flex items-start justify-center pt-[13vh] p-4 select-none"
    >
        <div
            class="w-full max-w-[580px] ios-modal-surface rounded-[26px] overflow-hidden shadow-2xl ios-context-menu"
        >
            <!-- Top iPadOS Spotlight Search Input Bar -->
            <div
                class="px-4 py-3.5 flex items-center gap-3 border-b border-white/10"
            >
                <Search class="size-5 text-white/60 shrink-0" />
                <input
                    bind:this={inputEl}
                    type="text"
                    bind:value={query}
                    oninput={() => (selectedIndex = 0)}
                    onkeydown={handleKeydown}
                    placeholder="Spotlight Search — apps, history, Vikunja tasks, 'todo: task', or web..."
                    class="w-full bg-transparent text-base font-medium text-white placeholder:text-white/38 focus:outline-none"
                />
                <kbd
                    class="px-2 py-0.5 rounded-md bg-white/10 text-[10px] font-semibold text-white/55 shrink-0"
                >
                    ESC
                </kbd>
            </div>

            <!-- Instant Filtered Results List -->
            {#if results.length > 0}
                <div class="p-2 max-h-[380px] overflow-y-auto space-y-0.5">
                    {#each results as item, idx (item.id)}
                        {@const isSelected = idx === selectedIndex}
                        <button
                            type="button"
                            onmouseenter={() => (selectedIndex = idx)}
                            onclick={() => item.execute()}
                            class="w-full px-3 py-2 rounded-[16px] flex items-center justify-between gap-3 text-left transition-colors cursor-pointer {isSelected
                                ? 'bg-primary text-white shadow-sm'
                                : 'text-white/90 hover:bg-white/8'}"
                        >
                            <div class="flex items-center gap-3 min-w-0">
                                {#if item.kind === "action" && item.node}
                                    {@const iconSrc = getNodeIconSrc(item.node)}
                                    {@const grad = getNodeBrandGradient(
                                        item.node,
                                    )}
                                    <div
                                        style="background: {grad};"
                                        class="size-8 rounded-[9px] flex items-center justify-center shrink-0 shadow-xs overflow-hidden"
                                    >
                                        {#if iconSrc}
                                            <img
                                                src={iconSrc}
                                                alt={item.title}
                                                class="size-5 object-contain"
                                            />
                                        {:else}
                                            <span
                                                class="text-[11px] font-bold text-white uppercase"
                                            >
                                                {item.title.slice(0, 2)}
                                            </span>
                                        {/if}
                                    </div>
                                {:else if item.kind === "folder"}
                                    <div
                                        class="size-8 rounded-[9px] bg-[#5E5CE6] text-white flex items-center justify-center shrink-0"
                                    >
                                        <Folder class="size-4" />
                                    </div>
                                {:else if item.kind === "todo"}
                                    <div
                                        class="size-8 rounded-[9px] bg-[#0A84FF] text-white flex items-center justify-center shrink-0"
                                    >
                                        <CheckCircle2 class="size-4" />
                                    </div>
                                {:else if item.kind === "calendar"}
                                    <div
                                        class="size-8 rounded-[9px] bg-[#FF453A] text-white flex items-center justify-center shrink-0"
                                    >
                                        <Calendar class="size-4" />
                                    </div>
                                {:else if item.kind === "workspace"}
                                    <div
                                        class="size-8 rounded-[9px] bg-white/15 text-white flex items-center justify-center shrink-0"
                                    >
                                        <Layers class="size-4" />
                                    </div>
                                {:else if item.kind === "history"}
                                    <div
                                        class="size-8 rounded-[9px] bg-[#FF9500] text-white flex items-center justify-center shrink-0"
                                    >
                                        <History class="size-4" />
                                    </div>
                                {:else if item.kind === "command"}
                                    <div
                                        class="size-8 rounded-[9px] bg-[#FF9F0A] text-white flex items-center justify-center shrink-0"
                                    >
                                        <Sparkles class="size-4" />
                                    </div>
                                {:else}
                                    <div
                                        class="size-8 rounded-[9px] bg-[#30D158] text-white flex items-center justify-center shrink-0"
                                    >
                                        <Globe class="size-4" />
                                    </div>
                                {/if}

                                <div class="min-w-0">
                                    <div class="text-xs font-semibold truncate">
                                        {item.title}
                                    </div>
                                    <div
                                        class="text-[10.5px] truncate {isSelected
                                            ? 'text-white/80'
                                            : 'text-white/45'}"
                                    >
                                        {item.subtitle}
                                    </div>
                                </div>
                            </div>

                            <ArrowUpRight
                                class="size-4 shrink-0 {isSelected
                                    ? 'text-white'
                                    : 'text-white/35'}"
                            />
                        </button>
                    {/each}
                </div>
            {:else}
                <div class="py-8 text-center text-xs text-white/40">
                    Type to search apps, {historyBridgeReady
                        ? "Firefox history, "
                        : ""}folders, Vikunja tasks, calendar events, or the
                    web.
                </div>
            {/if}

            <!-- Bottom Keyboard Hints Footer -->
            <div
                class="px-4 py-2 bg-black/25 border-t border-white/8 flex items-center justify-between text-[10.5px] text-white/45"
            >
                <div class="flex items-center gap-3">
                    <span
                        ><strong class="text-white/70">↑↓</strong> Navigate</span
                    >
                    <span><strong class="text-white/70">↵</strong> Open</span>
                    <span
                        ><strong class="text-white/70">todo:</strong> Quick Vikunja
                        Task</span
                    >
                </div>
                <span
                    >{historyBridgeReady ? "History Linked • " : ""}<strong
                        class="text-white/70">⇧↵</strong
                    > Web Search</span
                >
            </div>
        </div>
    </div>
{/if}
