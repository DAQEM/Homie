<script lang="ts">
    import {
        AlertCircle,
        Calendar as CalendarIcon,
        Check,
        Eye,
        EyeOff,
        Link2,
        ListTodo,
        Plus,
        RefreshCw,
        Star,
        Trash2,
    } from "@lucide/svelte";
    import { dashboard } from "../../state/dashboard.svelte";
    import type { DashboardNode, VikunjaScope, VikunjaTask } from "../../types";

    interface Props {
        node: DashboardNode;
    }

    let { node }: Props = $props();

    let isComposerOpen = $state(false);
    let showCompleted = $state(Boolean(node.settings?.vikunjaShowCompleted));
    let newText = $state("");
    let quickPriority = $state(0);
    let quickDue = $state<"none" | "today" | "tomorrow">("none");
    let composerInputEl: HTMLInputElement | undefined = $state();

    // 650ms Apple Reminders completion grace window before committing to Vikunja
    let graceTimers = new Map<number, ReturnType<typeof setTimeout>>();
    let pendingGraceIds = $state<Record<number, boolean>>({});

    let isPreview = $derived(node.id === "gallery-preview-node");
    let vStatus = $derived(dashboard.vikunja.status);
    let isConnected = $derived(isPreview || vStatus.connected);
    let isSyncing = $derived(dashboard.vikunja.isSyncing);

    let scope = $derived<VikunjaScope>(node.settings?.vikunjaFilter ?? "all");
    let scopedTasks = $derived<VikunjaTask[]>(
        dashboard.vikunja.getTasksForNode(node),
    );
    let activeTasks = $derived(scopedTasks.filter((t) => !t.done));
    let completedTasks = $derived(scopedTasks.filter((t) => t.done));
    let visibleTasks = $derived(
        showCompleted ? [...activeTasks, ...completedTasks] : activeTasks,
    );
    let pendingCount = $derived(
        activeTasks.filter((t) => !pendingGraceIds[t.id]).length,
    );

    let isCompact = $derived((node.width || 2) <= 2 && (node.height || 2) <= 2);
    let isLarge = $derived((node.width || 2) >= 4 && (node.height || 2) >= 4);

    let scopeColor = $derived.by(() => {
        if (scope === "project" && node.settings?.vikunjaProjectId) {
            const p = dashboard.vikunja.getProjectById(
                node.settings.vikunjaProjectId,
            );
            if (p?.hex_color) return p.hex_color;
        }
        switch (scope) {
            case "today":
                return "#FF453A";
            case "upcoming":
                return "#FF9F0A";
            case "favorites":
                return "#FFD60A";
            case "high_priority":
                return "#BF5AF2";
            default:
                return "#0A84FF";
        }
    });

    let scopeSubtitle = $derived.by(() => {
        if (scope === "project" && node.settings?.vikunjaProjectId) {
            return (
                dashboard.vikunja.getProjectById(node.settings.vikunjaProjectId)
                    ?.title ?? "Project"
            );
        }
        if (scope === "label" && node.settings?.vikunjaLabelId) {
            return (
                dashboard.vikunja.labels.find(
                    (l) => l.id === node.settings?.vikunjaLabelId,
                )?.title ?? "Label"
            );
        }
        const map: Record<VikunjaScope, string> = {
            all: "Vikunja",
            today: "Today",
            upcoming: "Next 7 Days",
            favorites: "Starred",
            high_priority: "Priority",
            project: "Project",
            label: "Label",
        };
        return map[scope];
    });

    function priorityRingStyle(priority: number, done: boolean): string {
        if (done) {
            if (priority >= 4)
                return "bg-[#FF453A] border-[#FF453A] shadow-[0_0_8px_rgba(255,69,58,0.45)]";
            if (priority === 3)
                return "bg-[#FF9F0A] border-[#FF9F0A] shadow-[0_0_8px_rgba(255,159,10,0.45)]";
            return "bg-primary border-primary shadow-[0_0_8px_rgba(10,132,255,0.45)]";
        }
        if (priority >= 4) return "border-[#FF453A] hover:bg-[#FF453A]/15";
        if (priority === 3) return "border-[#FF9F0A] hover:bg-[#FF9F0A]/15";
        if (priority === 2) return "border-[#0A84FF] hover:bg-[#0A84FF]/15";
        return "border-white/35 hover:border-primary";
    }

    function formatShortDue(
        iso?: string,
    ): { text: string; overdue: boolean } | null {
        if (!iso) return null;
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return null;
        const now = dashboard.now;
        const overdue = d.getTime() < now.getTime();
        const sameDay =
            d.getFullYear() === now.getFullYear() &&
            d.getMonth() === now.getMonth() &&
            d.getDate() === now.getDate();

        if (sameDay) return { text: "Today", overdue };
        const tmrw = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() + 1,
        );
        if (
            d.getFullYear() === tmrw.getFullYear() &&
            d.getMonth() === tmrw.getMonth() &&
            d.getDate() === tmrw.getDate()
        ) {
            return { text: "Tomorrow", overdue: false };
        }
        return {
            text: new Intl.DateTimeFormat("en-US", {
                month: "short",
                day: "numeric",
            }).format(d),
            overdue,
        };
    }

    function openComposer(e?: MouseEvent) {
        e?.stopPropagation();
        if (dashboard.isEditMode || isPreview || !isConnected) return;
        isComposerOpen = true;
        queueMicrotask(() => composerInputEl?.focus());
    }

    function handleRingClick(task: VikunjaTask, e: MouseEvent) {
        e.stopPropagation();
        if (dashboard.isEditMode || isPreview) return;

        if (task.done) {
            void dashboard.vikunja.updateTask(task.id, { done: false });
            return;
        }

        const existingTimer = graceTimers.get(task.id);
        if (existingTimer) {
            clearTimeout(existingTimer);
            graceTimers.delete(task.id);
            delete pendingGraceIds[task.id];
            return;
        }

        pendingGraceIds[task.id] = true;
        const timer = setTimeout(() => {
            graceTimers.delete(task.id);
            delete pendingGraceIds[task.id];
            void dashboard.vikunja.updateTask(task.id, { done: true });
        }, 650);
        graceTimers.set(task.id, timer);
    }

    async function handleAddTask(e: SubmitEvent) {
        e.preventDefault();
        const raw = newText.trim();
        if (!raw) {
            isComposerOpen = false;
            return;
        }

        const defaultProj = dashboard.vikunja.getDefaultProjectId(node);
        if (defaultProj <= 0) return;

        const parsed = dashboard.vikunja.parseQuickInput(raw, defaultProj);
        const title = parsed.title || raw;
        const priority =
            parsed.priority ||
            quickPriority ||
            (scope === "high_priority" ? 3 : 0);

        let dueDate = parsed.dueDate;
        if (
            !dueDate &&
            (quickDue === "today" || (quickDue === "none" && scope === "today"))
        ) {
            const now = dashboard.now;
            dueDate = new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate(),
                18,
                0,
                0,
            ).toISOString();
        } else if (!dueDate && quickDue === "tomorrow") {
            const now = dashboard.now;
            dueDate = new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate() + 1,
                18,
                0,
                0,
            ).toISOString();
        }

        const labelIds =
            scope === "label" && node.settings?.vikunjaLabelId
                ? [node.settings.vikunjaLabelId]
                : undefined;

        newText = "";
        quickPriority = 0;
        quickDue = "none";

        await dashboard.vikunja.createTask({
            project_id: parsed.projectId,
            title,
            priority,
            due_date: dueDate || undefined,
            is_favorite: scope === "favorites",
            label_ids: labelIds,
        });

        queueMicrotask(() => composerInputEl?.focus());
    }

    function handleComposerKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            e.stopPropagation();
            newText = "";
            isComposerOpen = false;
        }
    }

    function openConnectFlip(e: MouseEvent) {
        e.stopPropagation();
        dashboard.inspectNode(node, e);
    }

    function openTaskDetail(task: VikunjaTask, e: MouseEvent) {
        e.stopPropagation();
        if (dashboard.isEditMode || isPreview || task.id <= 0) return;
        dashboard.openVikunjaModal(task.id);
    }
</script>

<div
    class="w-full h-full ios-widget-surface p-3.5 flex flex-col gap-2 overflow-hidden select-none"
>
    <!-- Header -->
    <div class="flex items-center justify-between gap-2 shrink-0">
        <div class="flex items-center gap-2 min-w-0">
            <div
                style="background: {scopeColor};"
                class="size-6 rounded-full flex items-center justify-center shadow-sm shrink-0"
            >
                <ListTodo class="size-3.5 text-white stroke-[2.5]" />
            </div>
            <div class="min-w-0">
                <div
                    class="text-[13px] font-bold text-white ios-tight-tracking truncate leading-tight"
                >
                    {node.title}
                </div>
                {#if !isCompact && isConnected}
                    <div
                        class="text-[10px] font-medium ios-vibrant-secondary truncate leading-tight"
                    >
                        {scopeSubtitle}
                    </div>
                {/if}
            </div>
        </div>

        <div class="flex items-center gap-1.5 shrink-0">
            {#if isConnected}
                {#if vStatus.error}
                    <button
                        type="button"
                        onclick={openConnectFlip}
                        title={vStatus.error}
                        class="size-5.5 rounded-full bg-[#FF453A]/20 text-[#FF453A] flex items-center justify-center cursor-pointer"
                    >
                        <AlertCircle class="size-3" />
                    </button>
                {/if}

                {#if completedTasks.length > 0 && !isCompact}
                    <button
                        type="button"
                        onclick={(e) => {
                            e.stopPropagation();
                            showCompleted = !showCompleted;
                        }}
                        title={showCompleted
                            ? "Hide completed"
                            : `Show ${completedTasks.length} completed`}
                        class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/8 hover:bg-white/15 text-white/60 hover:text-white flex items-center gap-1 transition-colors cursor-pointer"
                    >
                        {#if showCompleted}
                            <EyeOff class="size-2.5" />
                        {:else}
                            <Eye class="size-2.5" />
                        {/if}
                        <span>{completedTasks.length}</span>
                    </button>
                {/if}

                {#if !isPreview && !dashboard.isEditMode && !isCompact}
                    <button
                        type="button"
                        onclick={(e) => {
                            e.stopPropagation();
                            void dashboard.vikunja.syncNow();
                        }}
                        title="Sync Vikunja"
                        class="size-6 rounded-full bg-white/8 hover:bg-white/16 text-white/65 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                    >
                        <RefreshCw
                            class="size-3 {isSyncing
                                ? 'animate-spin text-primary'
                                : ''}"
                        />
                    </button>
                {/if}

                <span
                    class="text-2xl font-bold text-white ios-tabular-nums ios-tight-tracking leading-none px-0.5"
                >
                    {pendingCount}
                </span>

                {#if !dashboard.isEditMode && !isPreview}
                    <button
                        type="button"
                        onclick={openComposer}
                        title="New Vikunja Task"
                        aria-label="New Vikunja Task"
                        class="size-6 rounded-full bg-white/10 hover:bg-primary text-white/80 hover:text-white flex items-center justify-center transition-all active:scale-90 cursor-pointer"
                    >
                        <Plus class="size-3.5 stroke-[2.5]" />
                    </button>
                {/if}
            {/if}
        </div>
    </div>

    {#if !isConnected}
        <!-- Unconfigured Vikunja Onboarding State -->
        <div
            class="flex-1 flex flex-col items-center justify-center text-center gap-2 px-2"
        >
            <div
                class="size-9 rounded-2xl bg-primary/15 text-primary flex items-center justify-center"
            >
                <Link2 class="size-4.5" />
            </div>
            <div class="space-y-0.5">
                <p class="text-xs font-semibold text-white/90">
                    Connect Vikunja
                </p>
                {#if !isCompact}
                    <p class="text-[10.5px] text-white/50 max-w-[220px]">
                        Sync projects, priorities, labels, and tasks in real
                        time.
                    </p>
                {/if}
            </div>
            {#if !dashboard.isEditMode}
                <button
                    type="button"
                    onclick={openConnectFlip}
                    class="mt-0.5 px-3 py-1 rounded-full bg-primary text-white text-[11px] font-semibold shadow-sm hover:brightness-110 transition-all cursor-pointer"
                >
                    Setup Vikunja
                </button>
            {/if}
        </div>
    {:else}
        <!-- Inline Mac Quick-Add Composer -->
        {#if isComposerOpen && !dashboard.isEditMode}
            <form
                onsubmit={handleAddTask}
                class="ios-nested-surface px-2.5 py-1.5 flex items-center gap-1.5 shrink-0 ring-1 ring-primary/50"
            >
                <span
                    class="size-4 rounded-full border-[1.75px] shrink-0 {priorityRingStyle(
                        quickPriority,
                        false,
                    )}"
                ></span>
                <input
                    bind:this={composerInputEl}
                    type="text"
                    bind:value={newText}
                    onkeydown={handleComposerKeydown}
                    onblur={(e) => {
                        const next = e.relatedTarget as HTMLElement | null;
                        if (
                            !newText.trim() &&
                            !next?.closest("[data-composer-ctrl]")
                        ) {
                            isComposerOpen = false;
                        }
                    }}
                    placeholder={isCompact
                        ? "New task..."
                        : "Task title (#project, !, today)..."}
                    class="flex-1 min-w-0 bg-transparent text-xs font-medium text-white placeholder:text-white/40 focus:outline-none"
                />

                {#if !isCompact}
                    <button
                        type="button"
                        data-composer-ctrl
                        onpointerdown={(e) => e.preventDefault()}
                        onclick={() =>
                            (quickDue =
                                quickDue === "none"
                                    ? "today"
                                    : quickDue === "today"
                                      ? "tomorrow"
                                      : "none")}
                        title="Due date"
                        class="px-1.5 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-0.5 transition-colors cursor-pointer {quickDue !==
                        'none'
                            ? 'bg-primary/25 text-primary'
                            : 'text-white/45 hover:text-white'}"
                    >
                        <CalendarIcon class="size-2.5" />
                        {#if quickDue !== "none"}
                            <span class="capitalize">{quickDue}</span>
                        {/if}
                    </button>
                {/if}

                <button
                    type="button"
                    data-composer-ctrl
                    onpointerdown={(e) => e.preventDefault()}
                    onclick={() =>
                        (quickPriority =
                            quickPriority === 0
                                ? 2
                                : quickPriority === 2
                                  ? 3
                                  : quickPriority === 3
                                    ? 4
                                    : 0)}
                    title="Cycle priority"
                    class="px-1.5 py-0.5 rounded-full text-[10px] font-bold transition-colors cursor-pointer {quickPriority >=
                    4
                        ? 'bg-[#FF453A]/25 text-[#FF453A]'
                        : quickPriority === 3
                          ? 'bg-[#FF9F0A]/25 text-[#FF9F0A]'
                          : quickPriority === 2
                            ? 'bg-primary/25 text-primary'
                            : 'text-white/40 hover:text-white'}"
                >
                    {quickPriority >= 4
                        ? "!!!"
                        : quickPriority === 3
                          ? "!!"
                          : "!"}
                </button>
            </form>
        {/if}

        <!-- Live Vikunja Task List -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            onclick={(e) => {
                if (e.target === e.currentTarget && !isComposerOpen) {
                    openComposer();
                }
            }}
            class="flex-1 min-h-0 overflow-y-auto divide-y divide-white/[0.07] pr-0.5"
        >
            {#each visibleTasks as task (task.id)}
                {@const isDoneOrGraced =
                    task.done || Boolean(pendingGraceIds[task.id])}
                {@const due = formatShortDue(task.due_date)}
                {@const proj =
                    scope !== "project"
                        ? dashboard.vikunja.getProjectById(task.project_id)
                        : undefined}
                <div
                    onclick={(e) => openTaskDetail(task, e)}
                    class="py-1.5 flex items-center justify-between gap-2 group rounded-lg px-1 -mx-1 hover:bg-white/[0.04] transition-colors cursor-pointer"
                >
                    <div class="flex items-center gap-2.5 min-w-0 flex-1">
                        <!-- Circular Priority-Colored Completion Ring -->
                        <button
                            type="button"
                            onclick={(e) => handleRingClick(task, e)}
                            aria-label="Toggle {task.title}"
                            class="size-4.5 rounded-full border-[1.75px] flex items-center justify-center shrink-0 transition-all duration-200 cursor-pointer {priorityRingStyle(
                                task.priority,
                                isDoneOrGraced,
                            )} {isDoneOrGraced ? 'scale-95' : ''}"
                        >
                            {#if isDoneOrGraced}
                                <Check class="size-2.5 text-white stroke-[3]" />
                            {/if}
                        </button>

                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-1.5 min-w-0">
                                {#if !isCompact}
                                    <span
                                        class="text-[10px] font-mono text-white/35 shrink-0 ios-tabular-nums"
                                    >
                                        {dashboard.vikunja.formatTaskIdentifier(
                                            task,
                                        )}
                                    </span>
                                {/if}
                                <span
                                    class="text-xs font-medium truncate transition-all duration-200 {isDoneOrGraced
                                        ? 'line-through text-white/40'
                                        : 'text-white/92'}"
                                >
                                    {task.title}
                                </span>
                            </div>

                            {#if !isCompact && (proj || (task.labels && task.labels.length > 0) || isLarge)}
                                <div
                                    class="flex items-center gap-1.5 mt-0.5 flex-wrap"
                                >
                                    {#if proj}
                                        <span
                                            class="inline-flex items-center gap-1 text-[9.5px] text-white/50 truncate max-w-[110px]"
                                        >
                                            <span
                                                style="background: {proj.hex_color ||
                                                    '#64D2FF'};"
                                                class="size-1.5 rounded-full shrink-0"
                                            ></span>
                                            <span class="truncate"
                                                >{proj.title}</span
                                            >
                                        </span>
                                    {/if}
                                    {#each (task.labels ?? []).slice(0, 3) as lbl (lbl.id)}
                                        <span
                                            style="background: {(lbl.hex_color ||
                                                '#0A84FF') +
                                                '26'}; color: {lbl.hex_color ||
                                                '#64D2FF'};"
                                            class="px-1.5 py-0.2 rounded-full text-[9px] font-semibold leading-tight"
                                        >
                                            {lbl.title}
                                        </span>
                                    {/each}
                                </div>
                            {/if}
                        </div>
                    </div>

                    <div class="flex items-center gap-1.5 shrink-0">
                        {#if due && !isDoneOrGraced}
                            <span
                                class="text-[10px] font-semibold ios-tabular-nums px-1.5 py-0.5 rounded-full {due.overdue
                                    ? 'bg-[#FF453A]/20 text-[#FF453A]'
                                    : 'text-white/50'}"
                            >
                                {due.text}
                            </span>
                        {/if}

                        {#if task.is_favorite}
                            <Star
                                class="size-3 text-[#FFD60A] fill-[#FFD60A] shrink-0"
                            />
                        {/if}

                        {#if !isPreview && !isCompact}
                            <button
                                type="button"
                                onclick={(e) => {
                                    e.stopPropagation();
                                    void dashboard.vikunja.deleteTask(task.id);
                                }}
                                class="opacity-0 group-hover:opacity-100 text-white/35 hover:text-destructive p-0.5 rounded transition-all shrink-0 cursor-pointer"
                                title="Delete task"
                            >
                                <Trash2 class="size-3" />
                            </button>
                        {/if}
                    </div>
                </div>
            {:else}
                <button
                    type="button"
                    onclick={openComposer}
                    class="w-full h-full flex flex-col items-center justify-center gap-1 text-xs ios-vibrant-secondary hover:text-white/80 transition-colors cursor-pointer"
                >
                    <span>All caught up</span>
                    <span class="text-[10px] text-primary font-semibold">
                        Tap + to create a Vikunja task
                    </span>
                </button>
            {/each}
        </div>
    {/if}
</div>
