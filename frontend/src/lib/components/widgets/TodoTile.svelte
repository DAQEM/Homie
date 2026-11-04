<script lang="ts">
    import { ListTodo, Plus, Trash2, X } from "@lucide/svelte";
    import { dashboard } from "../../state/dashboard.svelte";
    import type { DashboardNode, TodoItem } from "../../types";

    interface Props {
        node: DashboardNode;
    }

    let { node }: Props = $props();

    let newText = $state("");
    let newDate = $state("");
    let newPriority = $state(false);
    let isAdding = $state(false);

    let todos = $derived<TodoItem[]>(node.settings?.todos ?? []);

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
            date: newDate.trim() || undefined,
            priority: newPriority,
            done: false,
        };

        await dashboard.updateNodeSettings(node.id, {
            ...node.settings,
            todos: [...todos, item],
        });

        newText = "";
        newDate = "";
        newPriority = false;
        isAdding = false;
    }
</script>

<div
    class="w-full h-full bg-card text-card-foreground border-[1.2px] border-card-border shadow-md rounded-xl p-4 flex flex-col gap-3 overflow-hidden"
>
    <div
        class="flex items-center justify-between border-b border-card-border pb-2.5 shrink-0"
    >
        <div class="flex items-center gap-2 min-w-0">
            <ListTodo class="size-4 text-primary shrink-0" />
            <span class="text-sm font-semibold truncate">{node.title}</span>
        </div>
        <button
            type="button"
            onclick={() => (isAdding = !isAdding)}
            class="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer {isAdding
                ? 'bg-background text-foreground/70 hover:text-foreground border border-card-border'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'}"
        >
            {#if isAdding}
                <X class="size-3" />
                Cancel
            {:else}
                <Plus class="size-3" />
                Task
            {/if}
        </button>
    </div>

    {#if isAdding}
        <form
            onsubmit={addTodo}
            class="bg-background/80 border border-card-border rounded-xl p-2.5 space-y-2 text-xs shrink-0"
        >
            <input
                type="text"
                required
                bind:value={newText}
                placeholder="Task name..."
                class="w-full bg-card border border-card-border focus:border-primary rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder:text-foreground/40 focus:outline-none"
            />
            <div class="flex items-center gap-1.5">
                <input
                    type="text"
                    bind:value={newDate}
                    placeholder="Date (e.g. 12 Mar)"
                    class="flex-1 min-w-0 bg-card border border-card-border focus:border-primary rounded-lg px-2 py-1 text-[11px] text-foreground placeholder:text-foreground/40 focus:outline-none"
                />
                <label
                    class="flex items-center gap-1.5 text-[11px] bg-card border border-card-border rounded-lg px-2 py-1 cursor-pointer select-none"
                >
                    <input
                        type="checkbox"
                        bind:checked={newPriority}
                        class="accent-primary"
                    />
                    Priority
                </label>
                <button
                    type="submit"
                    class="bg-secondary text-secondary-foreground hover:bg-secondary/90 rounded-lg px-2.5 py-1 text-[11px] font-semibold cursor-pointer transition-colors"
                >
                    Add
                </button>
            </div>
        </form>
    {/if}

    <div class="flex-1 min-h-0 overflow-y-auto divide-y divide-card-border/60">
        {#each todos as item (item.id)}
            <div class="py-2 flex items-start justify-between gap-2 group">
                <label
                    class="flex items-start gap-2.5 cursor-pointer min-w-0 flex-1"
                >
                    <input
                        type="checkbox"
                        checked={item.done}
                        onchange={() => toggleTodo(item.id)}
                        class="mt-0.5 shrink-0 accent-primary rounded"
                    />
                    <div class="min-w-0 flex-1 space-y-1">
                        <div
                            class="text-xs truncate transition-colors {item.done
                                ? 'line-through text-foreground/40'
                                : 'text-foreground'}"
                        >
                            {item.text}
                        </div>
                        {#if item.date || item.priority}
                            <div class="flex flex-wrap gap-1">
                                {#if item.date}
                                    <span
                                        class="bg-background border border-card-border text-foreground/70 rounded-md px-1.5 py-0.5 text-[10px]"
                                    >
                                        {item.date}
                                    </span>
                                {/if}
                                {#if item.priority}
                                    <span
                                        class="bg-primary/20 text-primary border border-primary/30 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                                    >
                                        Priority
                                    </span>
                                {/if}
                            </div>
                        {/if}
                    </div>
                </label>

                <button
                    type="button"
                    onclick={() => removeTodo(item.id)}
                    class="text-foreground/40 hover:text-destructive p-1 rounded-md transition-colors shrink-0 cursor-pointer"
                    title="Delete task"
                >
                    <Trash2 class="size-3.5" />
                </button>
            </div>
        {:else}
            <div
                class="h-full flex items-center justify-center text-xs text-foreground/40 py-4"
            >
                No tasks yet.
            </div>
        {/each}
    </div>
</div>
