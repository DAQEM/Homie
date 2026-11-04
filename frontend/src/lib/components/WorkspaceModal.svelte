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
        class="fixed inset-0 z-50 bg-black/55 backdrop-blur-md flex items-center justify-center p-4"
    >
        <form
            onsubmit={handleSubmit}
            class="max-w-sm w-full ios-modal-surface text-card-foreground p-6 space-y-4"
        >
            <div
                class="flex items-center justify-between border-b border-white/10 pb-3.5"
            >
                <h3 class="text-base font-semibold ios-tight-tracking">
                    New Workspace
                </h3>
                <Button
                    variant="ghost"
                    size="icon"
                    onclick={() => (dashboard.isWorkspaceModalOpen = false)}
                >
                    <X class="size-4" />
                </Button>
            </div>

            <label class="block space-y-1.5">
                <span class="text-xs font-medium text-white/70 block">
                    Workspace Name
                </span>
                <input
                    type="text"
                    required
                    bind:value={name}
                    placeholder="e.g. Home, Work, Media"
                    class="w-full ios-input px-3 py-2 text-sm text-white placeholder:text-white/35"
                />
            </label>

            <div class="flex justify-end gap-2 pt-3 border-t border-white/10">
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
