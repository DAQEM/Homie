<script lang="ts">
    import {
        dashboard,
        DEFAULT_NODE_SIZES,
        GRID_COLS,
        GRID_ROWS,
        MAX_ICON_BYTES,
    } from "../state/dashboard.svelte";
    import type { NodeType } from "../types";

    let formError = $state<string | null>(null);

    let isDockedOrChild = $derived(
        dashboard.nodeModal.parent_id !== null ||
            (dashboard.nodeModal.grid_x === -1 &&
                dashboard.nodeModal.grid_y === -1),
    );

    const nodeTypes: { type: NodeType; label: string }[] = [
        { type: "action", label: "Action" },
        { type: "container", label: "Container" },
        { type: "clock", label: "Clock" },
        { type: "search", label: "Search" },
        { type: "todo", label: "To-Do" },
        { type: "calendar", label: "Calendar" },
    ];

    function selectNodeType(t: NodeType) {
        dashboard.nodeModal.node_type = t;
        const size = DEFAULT_NODE_SIZES[t];
        dashboard.nodeModal.width = size.w;
        dashboard.nodeModal.height = size.h;
    }

    function handleFileChange(e: Event) {
        formError = null;
        const input = e.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;

        if (file.size > MAX_ICON_BYTES) {
            formError = "File is too large. Maximum size is 100 KB.";
            input.value = "";
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === "string") {
                dashboard.nodeModal.icon = reader.result;
            }
        };
        reader.readAsDataURL(file);
    }

    async function handleSubmit(e: SubmitEvent) {
        e.preventDefault();
        formError = await dashboard.saveNodeModal();
    }
</script>

{#if dashboard.nodeModal.open}
    <div
        class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
    >
        <form
            onsubmit={handleSubmit}
            class="max-w-md w-full bg-white text-black border p-4 space-y-3"
        >
            <h3 class="text-base font-bold">
                {dashboard.nodeModal.mode === "create"
                    ? "Add Node"
                    : "Edit Node"}
            </h3>

            {#if dashboard.nodeModal.mode === "create" && !dashboard.nodeModal.parent_id}
                <div class="flex flex-wrap gap-1">
                    {#each nodeTypes as item (item.type)}
                        {#if !(isDockedOrChild && item.type !== "action" && item.type !== "container")}
                            <button
                                type="button"
                                onclick={() => selectNodeType(item.type)}
                                class="border px-2 py-1 text-xs {dashboard
                                    .nodeModal.node_type === item.type
                                    ? 'font-bold underline'
                                    : ''}"
                            >
                                {item.label}
                            </button>
                        {/if}
                    {/each}
                </div>
            {/if}

            <label class="block space-y-1">
                <span class="text-xs block">Title</span>
                <input
                    type="text"
                    required
                    bind:value={dashboard.nodeModal.title}
                    placeholder="Title"
                    class="w-full border px-2 py-1 text-sm"
                />
            </label>

            {#if dashboard.nodeModal.node_type === "action"}
                <label class="block space-y-1">
                    <span class="text-xs block"
                        >URL (Favicon used automatically)</span
                    >
                    <input
                        type="url"
                        required
                        bind:value={dashboard.nodeModal.url}
                        placeholder="https://example.com"
                        class="w-full border px-2 py-1 text-sm"
                    />
                </label>

                <div class="space-y-1">
                    <span class="text-xs block"
                        >Custom Icon Upload (optional, max 100 KB)</span
                    >
                    <input
                        type="file"
                        accept="image/*"
                        onchange={handleFileChange}
                        class="w-full text-xs"
                    />
                    {#if dashboard.nodeModal.icon}
                        <div class="flex items-center gap-2 pt-1">
                            <img
                                src={dashboard.nodeModal.icon}
                                alt="Custom preview"
                                class="w-6 h-6 object-contain border"
                            />
                            <button
                                type="button"
                                onclick={() =>
                                    (dashboard.nodeModal.icon = null)}
                                class="border px-2 py-0.5 text-xs"
                            >
                                Use Website Favicon
                            </button>
                        </div>
                    {/if}
                </div>
            {:else if dashboard.nodeModal.node_type === "clock"}
                <div class="grid grid-cols-2 gap-2">
                    <label class="block space-y-1">
                        <span class="text-xs block">IANA Timezone</span>
                        <input
                            type="text"
                            required
                            bind:value={dashboard.nodeModal.settings.timezone}
                            placeholder="Europe/Belgrade"
                            class="w-full border px-2 py-1 text-sm"
                        />
                    </label>
                    <label class="block space-y-1">
                        <span class="text-xs block">Flag / Badge</span>
                        <input
                            type="text"
                            bind:value={dashboard.nodeModal.settings.flag}
                            placeholder="🇷🇸"
                            class="w-full border px-2 py-1 text-sm"
                        />
                    </label>
                </div>
            {:else if dashboard.nodeModal.node_type === "search"}
                <label class="block space-y-1">
                    <span class="text-xs block">Placeholder</span>
                    <input
                        type="text"
                        bind:value={dashboard.nodeModal.settings.placeholder}
                        placeholder="Search the Web..."
                        class="w-full border px-2 py-1 text-sm"
                    />
                </label>
                <label class="block space-y-1">
                    <span class="text-xs block">Search Query URL Prefix</span>
                    <input
                        type="url"
                        bind:value={dashboard.nodeModal.settings.engineUrl}
                        placeholder="https://www.google.com/search?q="
                        class="w-full border px-2 py-1 text-sm"
                    />
                </label>
            {/if}

            {#if dashboard.nodeModal.node_type !== "action" && !isDockedOrChild}
                <div class="grid grid-cols-2 gap-2">
                    <label class="block space-y-1">
                        <span class="text-xs block">Width (1–{GRID_COLS})</span>
                        <input
                            type="number"
                            min="1"
                            max={GRID_COLS}
                            bind:value={dashboard.nodeModal.width}
                            class="w-full border px-2 py-1 text-sm"
                        />
                    </label>
                    <label class="block space-y-1">
                        <span class="text-xs block">Height (1–{GRID_ROWS})</span
                        >
                        <input
                            type="number"
                            min="1"
                            max={GRID_ROWS}
                            bind:value={dashboard.nodeModal.height}
                            class="w-full border px-2 py-1 text-sm"
                        />
                    </label>
                </div>
            {/if}

            {#if formError}
                <p class="text-xs border p-2">{formError}</p>
            {/if}

            <div class="flex justify-end gap-2 pt-2">
                <button
                    type="button"
                    onclick={() => {
                        formError = null;
                        dashboard.closeNodeModal();
                    }}
                    class="border px-3 py-1 text-xs"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    class="border px-3 py-1 text-xs font-bold"
                >
                    Save
                </button>
            </div>
        </form>
    </div>
{/if}
