<script lang="ts">
    import { dashboard } from "../state/dashboard.svelte";

    let name = $state("");

    async function handleSubmit(e: SubmitEvent) {
        e.preventDefault();
        await dashboard.createWorkspace(name);
        name = "";
    }
</script>

{#if dashboard.isWorkspaceModalOpen}
    <div
        class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
    >
        <form
            onsubmit={handleSubmit}
            class="max-w-sm w-full bg-white text-black border p-4 space-y-3"
        >
            <h3 class="text-base font-bold">New Workspace</h3>
            <input
                type="text"
                required
                bind:value={name}
                placeholder="Workspace Name"
                class="w-full border px-2 py-1 text-sm"
            />
            <div class="flex justify-end gap-2">
                <button
                    type="button"
                    onclick={() => (dashboard.isWorkspaceModalOpen = false)}
                    class="border px-3 py-1 text-xs"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    class="border px-3 py-1 text-xs font-bold"
                >
                    Create
                </button>
            </div>
        </form>
    </div>
{/if}
