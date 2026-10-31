<script lang="ts">
    import { dashboard } from "../../state/dashboard.svelte";
    import type { CalendarEvent, DashboardNode } from "../../types";

    interface Props {
        node: DashboardNode;
    }

    let { node }: Props = $props();

    let newTitle = $state("");
    let newTime = $state("");
    let isAdding = $state(false);

    let events = $derived<CalendarEvent[]>(node.settings?.events ?? []);

    async function addEvent(e: SubmitEvent) {
        e.preventDefault();
        const title = newTitle.trim();
        if (!title) return;

        const ev: CalendarEvent = {
            id: crypto.randomUUID(),
            title,
            time: newTime.trim() || "All day",
        };

        await dashboard.updateNodeSettings(node.id, {
            ...node.settings,
            events: [...events, ev],
        });

        newTitle = "";
        newTime = "";
        isAdding = false;
    }

    async function removeEvent(id: string) {
        const updated = events.filter((ev) => ev.id !== id);
        await dashboard.updateNodeSettings(node.id, {
            ...node.settings,
            events: updated,
        });
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
            {isAdding ? "Cancel" : "+ Event"}
        </button>
    </div>

    {#if isAdding}
        <form
            onsubmit={addEvent}
            class="space-y-1 border p-1.5 text-xs shrink-0"
        >
            <input
                type="text"
                required
                bind:value={newTitle}
                placeholder="Event title..."
                class="w-full border px-1.5 py-0.5 text-xs"
            />
            <div class="flex items-center gap-1">
                <input
                    type="text"
                    bind:value={newTime}
                    placeholder="11:00-12:00"
                    class="flex-1 min-w-0 border px-1.5 py-0.5 text-[10px]"
                />
                <button
                    type="submit"
                    class="border px-2 py-0.5 text-[10px] font-bold"
                >
                    Add
                </button>
            </div>
        </form>
    {/if}

    <div class="flex-1 min-h-0 overflow-y-auto space-y-2">
        {#each events as ev (ev.id)}
            <div class="border-l-2 pl-2 flex items-start justify-between gap-2">
                <div class="min-w-0 flex-1">
                    <div class="text-xs truncate">{ev.title}</div>
                    <div class="text-[10px] opacity-60 truncate">{ev.time}</div>
                </div>
                <button
                    type="button"
                    onclick={() => removeEvent(ev.id)}
                    class="text-[10px] border px-1 opacity-60 hover:opacity-100 shrink-0"
                    title="Remove event"
                >
                    x
                </button>
            </div>
        {:else}
            <div class="text-xs opacity-50 py-2">No upcoming events.</div>
        {/each}
    </div>
</div>
