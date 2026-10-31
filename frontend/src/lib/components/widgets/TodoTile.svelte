<script lang="ts">
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

<div class="w-full h-full border p-3 flex flex-col gap-2 overflow-hidden">
    <div class="flex items-center justify-between border-b pb-1 shrink-0">
        <span class="text-xs font-bold truncate">{node.title}</span>
        <button
            type="button"
            onclick={() => (isAdding = !isAdding)}
            class="border px-1.5 py-0.5 text-[10px]"
        >
            {isAdding ? "Cancel" : "+ Task"}
        </button>
    </div>

    {#if isAdding}
        <form
            onsubmit={addTodo}
            class="space-y-1 border p-1.5 text-xs shrink-0"
        >
            <input
                type="text"
                required
                bind:value={newText}
                placeholder="Task name..."
                class="w-full border px-1.5 py-0.5 text-xs"
            />
            <div class="flex items-center gap-1">
                <input
                    type="text"
                    bind:value={newDate}
                    placeholder="Date (e.g. 12 Mar)"
                    class="flex-1 min-w-0 border px-1.5 py-0.5 text-[10px]"
                />
                <label
                    class="flex items-center gap-1 text-[10px] border px-1.5 py-0.5 cursor-pointer"
                >
                    <input type="checkbox" bind:checked={newPriority} />
                    Priority
                </label>
                <button
                    type="submit"
                    class="border px-2 py-0.5 text-[10px] font-bold"
                >
                    Add
                </button>
            </div>
        </form>
    {/if}

    <div class="flex-1 min-h-0 overflow-y-auto divide-y">
        {#each todos as item (item.id)}
            <div class="py-1.5 flex items-start justify-between gap-2">
                <label
                    class="flex items-start gap-2 cursor-pointer min-w-0 flex-1"
                >
                    <input
                        type="checkbox"
                        checked={item.done}
                        onchange={() => toggleTodo(item.id)}
                        class="mt-0.5 shrink-0"
                    />
                    <div class="min-w-0 flex-1 space-y-1">
                        <div
                            class="text-xs truncate {item.done
                                ? 'line-through opacity-50'
                                : ''}"
                        >
                            {item.text}
                        </div>
                        {#if item.date || item.priority}
                            <div class="flex flex-wrap gap-1">
                                {#if item.date}
                                    <span class="border px-1 text-[10px]"
                                        >{item.date}</span
                                    >
                                {/if}
                                {#if item.priority}
                                    <span
                                        class="border px-1 text-[10px] font-bold"
                                        >Priority</span
                                    >
                                {/if}
                            </div>
                        {/if}
                    </div>
                </label>

                <button
                    type="button"
                    onclick={() => removeTodo(item.id)}
                    class="text-[10px] border px-1 opacity-60 hover:opacity-100 shrink-0"
                    title="Delete task"
                >
                    x
                </button>
            </div>
        {:else}
            <div class="text-xs opacity-50 py-2">No tasks yet.</div>
        {/each}
    </div>
</div>
