<script lang="ts">
    import { Check, Flag, ListTodo, Plus, Trash2 } from "@lucide/svelte";
    import { dashboard } from "../../state/dashboard.svelte";
    import type { DashboardNode, TodoItem } from "../../types";

    interface Props {
        node: DashboardNode;
    }

    let { node }: Props = $props();

    let newText = $state("");
    let newPriority = $state(false);

    let todos = $derived<TodoItem[]>(node.settings?.todos ?? []);
    let pendingCount = $derived(todos.filter((t) => !t.done).length);
    let isCompact = $derived((node.width || 2) <= 2 && (node.height || 2) <= 2);

    async function toggleTodo(id: string) {
        const updated = todos.map((t) =>
            t.id === id ? { ...t, done: !t.done } : t,
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
        if (!text) return;

        const item: TodoItem = {
            id: crypto.randomUUID(),
            text,
            priority: newPriority,
            done: false,
        };

        await dashboard.updateNodeSettings(node.id, {
            ...node.settings,
            todos: [...todos, item],
        });

        newText = "";
        newPriority = false;
    }
</script>

<div
    class="w-full h-full ios-widget-surface p-3.5 flex flex-col gap-2 overflow-hidden select-none"
>
    <!-- iPadOS Reminders Header: Circular Icon + Title on Left, Large Bold Count on Right -->
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

        <span
            class="text-2xl font-bold text-white ios-tabular-nums ios-tight-tracking leading-none"
        >
            {pendingCount}
        </span>
    </div>

    <!-- Reminders List with Circular iOS Completion Rings -->
    <div
        class="flex-1 min-h-0 overflow-y-auto divide-y divide-white/[0.07] pr-0.5"
    >
        {#each todos as item (item.id)}
            <div class="py-1.5 flex items-center justify-between gap-2 group">
                <button
                    type="button"
                    onclick={() => toggleTodo(item.id)}
                    class="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                >
                    <!-- Circular iOS Reminder Ring -->
                    <span
                        class="size-4.5 rounded-full border-[1.75px] flex items-center justify-center shrink-0 transition-all duration-150 {item.done
                            ? item.priority
                                ? 'bg-[#FF9F0A] border-[#FF9F0A] scale-95'
                                : 'bg-primary border-primary scale-95'
                            : item.priority
                              ? 'border-[#FF9F0A] hover:bg-[#FF9F0A]/15'
                              : 'border-white/35 hover:border-primary'}"
                    >
                        {#if item.done}
                            <Check class="size-2.5 text-white stroke-[3]" />
                        {/if}
                    </span>

                    <span
                        class="text-xs font-medium truncate transition-colors {item.done
                            ? 'line-through text-white/35'
                            : 'text-white/92'}"
                    >
                        {item.text}
                    </span>

                    {#if item.priority && !item.done}
                        <Flag
                            class="size-3 text-[#FF9F0A] fill-[#FF9F0A] shrink-0"
                        />
                    {/if}
                    {#if item.date && !isCompact}
                        <span
                            class="text-[10px] text-white/45 ios-tabular-nums shrink-0"
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
            <div
                class="h-full flex items-center justify-center text-xs text-white/35"
            >
                All reminders completed
            </div>
        {/each}
    </div>

    <!-- Persistent Whisper-Quiet Inline Quick Add Bar -->
    <form
        onsubmit={addTodo}
        class="pt-1.5 border-t border-white/[0.08] flex items-center gap-1.5 shrink-0"
    >
        <Plus class="size-3.5 text-white/40 shrink-0" />
        <input
            type="text"
            bind:value={newText}
            placeholder="New Reminder..."
            disabled={dashboard.isEditMode}
            class="flex-1 min-w-0 bg-transparent text-xs text-white placeholder:text-white/35 focus:outline-none"
        />
        <button
            type="button"
            onclick={() => (newPriority = !newPriority)}
            title="Toggle Priority Flag"
            class="px-1.5 py-0.5 rounded-full text-[10px] font-bold transition-colors cursor-pointer {newPriority
                ? 'bg-[#FF9F0A]/25 text-[#FF9F0A]'
                : 'text-white/35 hover:text-white/70'}"
        >
            !
        </button>
    </form>
</div>
