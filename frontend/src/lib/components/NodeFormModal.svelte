<script lang="ts">
    import { X } from "@lucide/svelte";
    import {
        dashboard,
        DEFAULT_NODE_SIZES,
        GRID_COLS,
        GRID_ROWS,
        MAX_ICON_BYTES,
    } from "../state/dashboard.svelte";
    import type { NodeType } from "../types";
    import Button from "./ui/Button.svelte";

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

    function handleClose() {
        formError = null;
        dashboard.closeNodeModal();
    }
</script>

{#if dashboard.nodeModal.open}
    <div
        class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
    >
        <form
            onsubmit={handleSubmit}
            class="max-w-md w-full bg-card text-card-foreground border-[1.2px] border-card-border rounded-2xl shadow-2xl p-6 space-y-4"
        >
            <div
                class="flex items-center justify-between border-b border-card-border pb-3"
            >
                <h3 class="text-base font-bold">
                    {dashboard.nodeModal.mode === "create"
                        ? "Add Node"
                        : "Edit Node"}
                </h3>
                <Button variant="ghost" size="icon" onclick={handleClose}>
                    <X class="size-4" />
                </Button>
            </div>

            {#if dashboard.nodeModal.mode === "create" && !dashboard.nodeModal.parent_id}
                <div class="space-y-1.5">
                    <span class="text-xs font-medium text-foreground/70 block">
                        Node Type
                    </span>
                    <div class="flex flex-wrap gap-1.5">
                        {#each nodeTypes as item (item.type)}
                            {#if !(isDockedOrChild && item.type !== "action" && item.type !== "container")}
                                <button
                                    type="button"
                                    onclick={() => selectNodeType(item.type)}
                                    class="px-3 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer {dashboard
                                        .nodeModal.node_type === item.type
                                        ? 'bg-primary text-primary-foreground'
                                        : 'bg-background border border-card-border text-foreground/70 hover:text-foreground hover:border-primary/50'}"
                                >
                                    {item.label}
                                </button>
                            {/if}
                        {/each}
                    </div>
                </div>
            {/if}

            <label class="block space-y-1.5">
                <span class="text-xs font-medium text-foreground/70 block">
                    Title
                </span>
                <input
                    type="text"
                    required
                    bind:value={dashboard.nodeModal.title}
                    placeholder="Title"
                    class="w-full bg-background border border-card-border focus:border-primary rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none transition-colors"
                />
            </label>

            {#if dashboard.nodeModal.node_type === "action"}
                <label class="block space-y-1.5">
                    <span class="text-xs font-medium text-foreground/70 block">
                        URL (Favicon used automatically)
                    </span>
                    <input
                        type="url"
                        required
                        bind:value={dashboard.nodeModal.url}
                        placeholder="https://example.com"
                        class="w-full bg-background border border-card-border focus:border-primary rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none transition-colors"
                    />
                </label>

                <div class="space-y-1.5">
                    <span class="text-xs font-medium text-foreground/70 block">
                        Custom Icon Upload (optional, max 100 KB)
                    </span>
                    <input
                        type="file"
                        accept="image/*"
                        onchange={handleFileChange}
                        class="w-full text-xs text-foreground/70 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-secondary file:text-secondary-foreground hover:file:bg-secondary/90 file:cursor-pointer"
                    />
                    {#if dashboard.nodeModal.icon}
                        <div
                            class="flex items-center justify-between gap-2 bg-background border border-card-border rounded-xl p-2 mt-1"
                        >
                            <div class="flex items-center gap-2">
                                <img
                                    src={dashboard.nodeModal.icon}
                                    alt="Custom preview"
                                    class="w-7 h-7 object-contain rounded border border-card-border p-0.5"
                                />
                                <span class="text-xs text-foreground/70">
                                    Custom icon selected
                                </span>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onclick={() =>
                                    (dashboard.nodeModal.icon = null)}
                            >
                                Use Website Favicon
                            </Button>
                        </div>
                    {/if}
                </div>
            {:else if dashboard.nodeModal.node_type === "clock"}
                <div class="grid grid-cols-2 gap-3">
                    <label class="block space-y-1.5">
                        <span
                            class="text-xs font-medium text-foreground/70 block"
                        >
                            IANA Timezone
                        </span>
                        <input
                            type="text"
                            required
                            bind:value={dashboard.nodeModal.settings.timezone}
                            placeholder="Europe/Amsterdam"
                            class="w-full bg-background border border-card-border focus:border-primary rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none transition-colors"
                        />
                    </label>
                    <label class="block space-y-1.5">
                        <span
                            class="text-xs font-medium text-foreground/70 block"
                        >
                            Flag / Badge
                        </span>
                        <input
                            type="text"
                            bind:value={dashboard.nodeModal.settings.flag}
                            placeholder="🇳🇱"
                            class="w-full bg-background border border-card-border focus:border-primary rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none transition-colors"
                        />
                    </label>
                </div>
            {:else if dashboard.nodeModal.node_type === "search"}
                <label class="block space-y-1.5">
                    <span class="text-xs font-medium text-foreground/70 block">
                        Placeholder
                    </span>
                    <input
                        type="text"
                        bind:value={dashboard.nodeModal.settings.placeholder}
                        placeholder="Search the Web..."
                        class="w-full bg-background border border-card-border focus:border-primary rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none transition-colors"
                    />
                </label>
                <label class="block space-y-1.5">
                    <span class="text-xs font-medium text-foreground/70 block">
                        Search Query URL Prefix
                    </span>
                    <input
                        type="url"
                        bind:value={dashboard.nodeModal.settings.engineUrl}
                        placeholder="https://www.google.com/search?q="
                        class="w-full bg-background border border-card-border focus:border-primary rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none transition-colors"
                    />
                </label>
            {/if}

            {#if dashboard.nodeModal.node_type !== "action" && !isDockedOrChild}
                <div class="grid grid-cols-2 gap-3">
                    <label class="block space-y-1.5">
                        <span
                            class="text-xs font-medium text-foreground/70 block"
                        >
                            Width (1–{GRID_COLS})
                        </span>
                        <input
                            type="number"
                            min="1"
                            max={GRID_COLS}
                            bind:value={dashboard.nodeModal.width}
                            class="w-full bg-background border border-card-border focus:border-primary rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none transition-colors"
                        />
                    </label>
                    <label class="block space-y-1.5">
                        <span
                            class="text-xs font-medium text-foreground/70 block"
                        >
                            Height (1–{GRID_ROWS})
                        </span>
                        <input
                            type="number"
                            min="1"
                            max={GRID_ROWS}
                            bind:value={dashboard.nodeModal.height}
                            class="w-full bg-background border border-card-border focus:border-primary rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none transition-colors"
                        />
                    </label>
                </div>
            {/if}

            {#if formError}
                <p
                    class="text-xs bg-destructive/15 border border-destructive/40 text-destructive rounded-xl p-2.5"
                >
                    {formError}
                </p>
            {/if}

            <div
                class="flex justify-end gap-2 pt-2 border-t border-card-border"
            >
                <Button variant="ghost" onclick={handleClose}>Cancel</Button>
                <Button type="submit" variant="default">Save</Button>
            </div>
        </form>
    </div>
{/if}
