<script lang="ts">
    import { Calendar, Plus, Trash2, X } from "@lucide/svelte";
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

<div
    class="w-full h-full bg-card text-card-foreground border-[1.2px] border-card-border shadow-md rounded-xl p-4 flex flex-col gap-3 overflow-hidden"
>
    <div
        class="flex items-center justify-between border-b border-card-border pb-2.5 shrink-0"
    >
        <div class="flex items-center gap-2 min-w-0">
            <Calendar class="size-4 text-secondary shrink-0" />
            <span class="text-sm font-semibold truncate">{node.title}</span>
        </div>
        <button
            type="button"
            onclick={() => (isAdding = !isAdding)}
            class="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer {isAdding
                ? 'bg-background text-foreground/70 hover:text-foreground border border-card-border'
                : 'bg-secondary text-secondary-foreground hover:bg-secondary/90'}"
        >
            {#if isAdding}
                <X class="size-3" />
                Cancel
            {:else}
                <Plus class="size-3" />
                Event
            {/if}
        </button>
    </div>

    {#if isAdding}
        <form
            onsubmit={addEvent}
            class="bg-background/80 border border-card-border rounded-xl p-2.5 space-y-2 text-xs shrink-0"
        >
            <input
                type="text"
                required
                bind:value={newTitle}
                placeholder="Event title..."
                class="w-full bg-card border border-card-border focus:border-primary rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder:text-foreground/40 focus:outline-none"
            />
            <div class="flex items-center gap-1.5">
                <input
                    type="text"
                    bind:value={newTime}
                    placeholder="11:00 - 12:00"
                    class="flex-1 min-w-0 bg-card border border-card-border focus:border-primary rounded-lg px-2 py-1 text-[11px] text-foreground placeholder:text-foreground/40 focus:outline-none"
                />
                <button
                    type="submit"
                    class="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-2.5 py-1 text-[11px] font-semibold cursor-pointer transition-colors"
                >
                    Add
                </button>
            </div>
        </form>
    {/if}

    <div class="flex-1 min-h-0 overflow-y-auto space-y-2">
        {#each events as ev (ev.id)}
            <div
                class="bg-background/60 border border-card-border border-l-2 border-l-secondary rounded-lg p-2 flex items-start justify-between gap-2"
            >
                <div class="min-w-0 flex-1">
                    <div class="text-xs font-medium text-foreground truncate">
                        {ev.title}
                    </div>
                    <div class="text-[11px] text-foreground/50 truncate mt-0.5">
                        {ev.time}
                    </div>
                </div>
                <button
                    type="button"
                    onclick={() => removeEvent(ev.id)}
                    class="text-foreground/40 hover:text-destructive p-1 rounded-md transition-colors shrink-0 cursor-pointer"
                    title="Remove event"
                >
                    <Trash2 class="size-3.5" />
                </button>
            </div>
        {:else}
            <div
                class="h-full flex items-center justify-center text-xs text-foreground/40 py-4"
            >
                No upcoming events.
            </div>
        {/each}
    </div>
</div>
