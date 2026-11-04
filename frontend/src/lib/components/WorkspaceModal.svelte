<script lang="ts">
    import { X } from "@lucide/svelte";
    import { dashboard } from "../state/dashboard.svelte";
    import Button from "./ui/Button.svelte";

    let name = $state("");

    async function handleSubmit(e: SubmitEvent) {
        e.preventDefault();
        await dashboard.createWorkspace(name);
        name = "";
    }
</script>

{#if dashboard.isWorkspaceModalOpen}
    <div
        class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
    >
        <form
            onsubmit={handleSubmit}
            class="max-w-sm w-full bg-card text-card-foreground border-[1.2px] border-card-border rounded-2xl shadow-2xl p-6 space-y-4"
        >
            <div
                class="flex items-center justify-between border-b border-card-border pb-3"
            >
                <h3 class="text-base font-bold">New Workspace</h3>
                <Button
                    variant="ghost"
                    size="icon"
                    onclick={() => (dashboard.isWorkspaceModalOpen = false)}
                >
                    <X class="size-4" />
                </Button>
            </div>

            <label class="block space-y-1.5">
                <span class="text-xs font-medium text-foreground/70 block">
                    Workspace Name
                </span>
                <input
                    type="text"
                    required
                    bind:value={name}
                    placeholder="e.g. Home, Work, Media"
                    class="w-full bg-background border border-card-border focus:border-primary rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none transition-colors"
                />
            </label>

            <div
                class="flex justify-end gap-2 pt-2 border-t border-card-border"
            >
                <Button
                    variant="ghost"
                    onclick={() => (dashboard.isWorkspaceModalOpen = false)}
                >
                    Cancel
                </Button>
                <Button type="submit" variant="default">Create</Button>
            </div>
        </form>
    </div>
{/if}
