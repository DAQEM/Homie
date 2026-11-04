<script lang="ts">
    import {
        Check,
        Eye,
        EyeOff,
        Flag,
        ListTodo,
        Plus,
        Trash2,
    } from "@lucide/svelte";
    import { dashboard } from "../../state/dashboard.svelte";
    import type { DashboardNode, TodoItem } from "../../types";

    interface Props {
        node: DashboardNode;
    }

    let { node }: Props = $props();

    let isComposerOpen = $state(false);
    let showCompleted = $state(false);
    let newText = $state("");
    let newPriority = $state(false);
    let composerInputEl: HTMLInputElement | undefined = $state();

    // Tracks tasks in the 650ms Apple completion grace window before collapsing
    let graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    let pendingGraceIds = $state<Record<string, boolean>>({});

    let todos = $derived<TodoItem[]>(node.settings?.todos ?? []);
    let activeTodos = $derived(todos.filter((t) => !t.done));
    let completedTodos = $derived(todos.filter((t) => t.done));
    let visibleTodos = $derived(
        showCompleted ? [...activeTodos, ...completedTodos] : activeTodos,
    );
    let pendingCount = $derived(
        activeTodos.filter((t) => !pendingGraceIds[t.id]).length,
    );
    let isCompact = $derived((node.width || 2) <= 2 && (node.height || 2) <= 2);

    function openComposer(e?: MouseEvent) {
        e?.stopPropagation();
        if (dashboard.isEditMode) return;
        isComposerOpen = true;
        queueMicrotask(() => composerInputEl?.focus());
    }

    function handleRingClick(item: TodoItem) {
        if (dashboard.isEditMode) return;

        // If already done, uncheck immediately
        if (item.done) {
            void commitToggle(item.id, false);
            return;
        }

        // If currently in the 650ms grace window, cancel completion!
        const existingTimer = graceTimers.get(item.id);
        if (existingTimer) {
            clearTimeout(existingTimer);
            graceTimers.delete(item.id);
            delete pendingGraceIds[item.id];
            return;
        }

        // Start 650ms Apple Reminders completion grace window
        pendingGraceIds[item.id] = true;
        const timer = setTimeout(() => {
            graceTimers.delete(item.id);
            delete pendingGraceIds[item.id];
            void commitToggle(item.id, true);
        }, 650);
        graceTimers.set(item.id, timer);
    }

    async function commitToggle(id: string, doneState: boolean) {
        const updated = todos.map((t) =>
            t.id === id ? { ...t, done: doneState } : t,
        );
        await dashboard.updateNodeSettings(node.id, {
            ...node.settings,
            todos: updated,
        });
    }

    async function removeTodo(id: string) {
        const updated = todos.filter((t) => t.id !== id);
        await dashboard.updateNodeSettings(node.id, {
            ...node.settings,
            todos: updated,
        });
    }

    async function addTodo(e: SubmitEvent) {
        e.preventDefault();
        const text = newText.trim();
        if (!text) {
            isComposerOpen = false;
            return;
        }

        const item: TodoItem = {
            id: crypto.randomUUID(),
            text,
            priority: newPriority,
            done: false,
        };

        await dashboard.updateNodeSettings(node.id, {
            ...node.settings,
            todos: [item, ...todos],
        });

        newText = "";
        newPriority = false;
        queueMicrotask(() => composerInputEl?.focus());
    }

    function handleComposerKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            e.stopPropagation();
            newText = "";
            isComposerOpen = false;
        }
    }
</script>

<div
    class="w-full h-full ios-widget-surface p-3.5 flex flex-col gap-2 overflow-hidden select-none"
>
    <!-- iPadOS Reminders Header: Circular Icon + Title on Left, Count + '+' Button on Right -->
    <div class="flex items-center justify-between gap-2 shrink-0">
        <div class="flex items-center gap-2 min-w-0">
            <div
                class="size-6 rounded-full bg-primary flex items-center justify-center shadow-[0_2px_8px_rgba(10,132,255,0.45)] shrink-0"
            >
                <ListTodo class="size-3.5 text-white stroke-[2.5]" />
            </div>
            <span
                class="text-[13px] font-bold text-primary ios-tight-tracking truncate"
            >
                {node.title}
            </span>
        </div>

        <div class="flex items-center gap-2 shrink-0">
            {#if completedTodos.length > 0 && !isCompact}
                <button
                    type="button"
                    onclick={() => (showCompleted = !showCompleted)}
                    title={showCompleted
                        ? "Hide completed"
                        : `Show ${completedTodos.length} completed`}
                    class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/8 hover:bg-white/15 text-white/60 hover:text-white flex items-center gap-1 transition-colors cursor-pointer"
                >
                    {#if showCompleted}
                        <EyeOff class="size-2.5" />
                    {:else}
                        <Eye class="size-2.5" />
                    {/if}
                    <span>{completedTodos.length}</span>
                </button>
            {/if}

            <span
                class="text-2xl font-bold text-white ios-tabular-nums ios-tight-tracking leading-none"
            >
                {pendingCount}
            </span>

            {#if !dashboard.isEditMode}
                <button
                    type="button"
                    onclick={openComposer}
                    title="New Reminder"
                    aria-label="New Reminder"
                    class="size-6 rounded-full bg-white/10 hover:bg-primary text-white/80 hover:text-white flex items-center justify-center transition-all active:scale-90 cursor-pointer"
                >
                    <Plus class="size-3.5 stroke-[2.5]" />
                </button>
            {/if}
        </div>
    </div>

    <!-- Inline Auto-Focusing iOS Reminder Row (Only visible when '+' is tapped) -->
    {#if isComposerOpen && !dashboard.isEditMode}
        <form
            onsubmit={addTodo}
            class="ios-nested-surface px-2.5 py-1.5 flex items-center gap-2 shrink-0 ring-1 ring-primary/50"
        >
            <span
                class="size-4 rounded-full border-[1.75px] {newPriority
                    ? 'border-[#FF9F0A]'
                    : 'border-primary'} shrink-0"
            ></span>
            <input
                bind:this={composerInputEl}
                type="text"
                bind:value={newText}
                onkeydown={handleComposerKeydown}
                onblur={() => {
                    if (!newText.trim()) isComposerOpen = false;
                }}
                placeholder="New Reminder..."
                class="flex-1 min-w-0 bg-transparent text-xs font-medium text-white placeholder:text-white/40 focus:outline-none"
            />
            <button
                type="button"
                onpointerdown={(e) => e.preventDefault()}
                onclick={() => (newPriority = !newPriority)}
                title="Toggle Priority Flag"
                class="px-1.5 py-0.5 rounded-full text-[10px] font-bold transition-colors cursor-pointer {newPriority
                    ? 'bg-[#FF9F0A]/25 text-[#FF9F0A]'
                    : 'text-white/40 hover:text-white'}"
            >
                !
            </button>
        </form>
    {/if}

    <!-- Reminders List with Circular iOS Completion Rings & 650ms Grace Feedback -->
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
        {#each visibleTodos as item (item.id)}
            {@const isDoneOrGraced =
                item.done || Boolean(pendingGraceIds[item.id])}
            <div class="py-1.5 flex items-center justify-between gap-2 group">
                <button
                    type="button"
                    onclick={() => handleRingClick(item)}
                    class="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                >
                    <!-- Circular iOS Reminder Ring -->
                    <span
                        class="size-4.5 rounded-full border-[1.75px] flex items-center justify-center shrink-0 transition-all duration-200 {isDoneOrGraced
                            ? item.priority
                                ? 'bg-[#FF9F0A] border-[#FF9F0A] scale-95 shadow-[0_0_8px_rgba(255,159,10,0.45)]'
                                : 'bg-primary border-primary scale-95 shadow-[0_0_8px_rgba(10,132,255,0.45)]'
                            : item.priority
                              ? 'border-[#FF9F0A] hover:bg-[#FF9F0A]/15'
                              : 'border-white/35 hover:border-primary'}"
                    >
                        {#if isDoneOrGraced}
                            <Check class="size-2.5 text-white stroke-[3]" />
                        {/if}
                    </span>

                    <span
                        class="text-xs font-medium truncate transition-all duration-200 {isDoneOrGraced
                            ? 'line-through text-white/40'
                            : 'text-white/92'}"
                    >
                        {item.text}
                    </span>

                    {#if item.priority && !isDoneOrGraced}
                        <Flag
                            class="size-3 text-[#FF9F0A] fill-[#FF9F0A] shrink-0"
                        />
                    {/if}
                    {#if item.date && !isCompact}
                        <span
                            class="text-[10px] ios-vibrant-secondary ios-tabular-nums shrink-0"
                        >
                            {item.date}
                        </span>
                    {/if}
                </button>

                <button
                    type="button"
                    onclick={() => removeTodo(item.id)}
                    class="opacity-0 group-hover:opacity-100 text-white/35 hover:text-destructive p-0.5 rounded transition-all shrink-0 cursor-pointer"
                    title="Delete reminder"
                >
                    <Trash2 class="size-3" />
                </button>
            </div>
        {:else}
            <button
                type="button"
                onclick={openComposer}
                class="w-full h-full flex flex-col items-center justify-center gap-1 text-xs ios-vibrant-secondary hover:text-white/80 transition-colors cursor-pointer"
            >
                <span>All reminders completed</span>
                <span class="text-[10px] text-primary font-semibold">
                    Tap + to add a reminder
                </span>
            </button>
        {/each}
    </div>
</div>
