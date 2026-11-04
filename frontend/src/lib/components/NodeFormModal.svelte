<script lang="ts">
    import {
        Calendar,
        Clock,
        Folder,
        Globe,
        ListTodo,
        Search,
        X,
    } from "@lucide/svelte";
    import {
        dashboard,
        DEFAULT_NODE_SIZES,
        MAX_ICON_BYTES,
        WIDGET_SIZE_PRESETS,
    } from "../state/dashboard.svelte";
    import type { NodeType } from "../types";
    import Button from "./ui/Button.svelte";

    let formError = $state<string | null>(null);

    let isDockedOrChild = $derived(
        dashboard.nodeModal.parent_id !== null ||
            (dashboard.nodeModal.grid_x === -1 &&
                dashboard.nodeModal.grid_y === -1),
    );

    let sizePresets = $derived(
        WIDGET_SIZE_PRESETS[dashboard.nodeModal.node_type] ?? [],
    );

    const galleryItems: {
        type: NodeType;
        label: string;
        subtitle: string;
        accent: string;
    }[] = [
        {
            type: "action",
            label: "App Shortcut",
            subtitle: "Website icon & link",
            accent: "bg-[#0A84FF]",
        },
        {
            type: "container",
            label: "Folder / Library",
            subtitle: "Group apps together",
            accent: "bg-[#5E5CE6]",
        },
        {
            type: "clock",
            label: "World Clock",
            subtitle: "Analog & day/night",
            accent: "bg-[#FF9F0A]",
        },
        {
            type: "todo",
            label: "Reminders",
            subtitle: "Tasks & priority flags",
            accent: "bg-[#0A84FF]",
        },
        {
            type: "calendar",
            label: "Calendar",
            subtitle: "Up next & month grid",
            accent: "bg-[#FF453A]",
        },
        {
            type: "search",
            label: "Search Bar",
            subtitle: "Quick web launch",
            accent: "bg-[#30D158]",
        },
    ];

    function selectNodeType(t: NodeType) {
        dashboard.nodeModal.node_type = t;
        const size = DEFAULT_NODE_SIZES[t];
        dashboard.nodeModal.width = size.w;
        dashboard.nodeModal.height = size.h;
    }

    function selectSizePreset(w: number, h: number) {
        dashboard.nodeModal.width = w;
        dashboard.nodeModal.height = h;
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
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        onclick={(e) => e.target === e.currentTarget && handleClose()}
        class="fixed inset-0 z-50 bg-black/45 backdrop-blur-md flex items-center justify-center p-4 select-none"
    >
        <form
            onsubmit={handleSubmit}
            class="max-w-lg w-full ios-modal-surface rounded-[30px] text-card-foreground p-6 space-y-4 ios-context-menu"
        >
            <div
                class="flex items-center justify-between border-b border-white/10 pb-3.5"
            >
                <div>
                    <h3 class="text-base font-semibold ios-tight-tracking">
                        {dashboard.nodeModal.mode === "create"
                            ? "Widget & Shortcut Gallery"
                            : "Edit Shortcut"}
                    </h3>
                    <p class="text-[11px] text-white/50">
                        {dashboard.nodeModal.mode === "create"
                            ? "Choose an item to add to your Home Screen"
                            : "Update shortcut title, URL, or custom squircle artwork"}
                    </p>
                </div>
                <Button variant="ghost" size="icon" onclick={handleClose}>
                    <X class="size-4" />
                </Button>
            </div>

            {#if dashboard.nodeModal.mode === "create" && !dashboard.nodeModal.parent_id}
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {#each galleryItems as item (item.type)}
                        {#if !(isDockedOrChild && item.type !== "action" && item.type !== "container")}
                            {@const isSelected =
                                dashboard.nodeModal.node_type === item.type}
                            <button
                                type="button"
                                onclick={() => selectNodeType(item.type)}
                                class="p-2.5 rounded-2xl text-left transition-all flex items-center gap-2.5 cursor-pointer {isSelected
                                    ? 'bg-white/18 ring-1.5 ring-primary shadow-md'
                                    : 'ios-nested-surface hover:bg-white/10'}"
                            >
                                <div
                                    class="size-8 rounded-xl {item.accent} text-white flex items-center justify-center shrink-0 shadow-sm"
                                >
                                    {#if item.type === "action"}
                                        <Globe class="size-4" />
                                    {:else if item.type === "container"}
                                        <Folder class="size-4" />
                                    {:else if item.type === "clock"}
                                        <Clock class="size-4" />
                                    {:else if item.type === "todo"}
                                        <ListTodo class="size-4" />
                                    {:else if item.type === "calendar"}
                                        <Calendar class="size-4" />
                                    {:else if item.type === "search"}
                                        <Search class="size-4" />
                                    {/if}
                                </div>
                                <div class="min-w-0">
                                    <div
                                        class="text-xs font-semibold text-white truncate"
                                    >
                                        {item.label}
                                    </div>
                                    <div
                                        class="text-[10px] text-white/50 truncate"
                                    >
                                        {item.subtitle}
                                    </div>
                                </div>
                            </button>
                        {/if}
                    {/each}
                </div>
            {/if}

            <label class="block space-y-1.5">
                <span class="text-xs font-medium text-white/70 block">
                    Title
                </span>
                <input
                    type="text"
                    required
                    bind:value={dashboard.nodeModal.title}
                    placeholder="e.g. GitHub, Cupertino, Work Tasks"
                    class="w-full ios-input px-3 py-2 text-sm text-white placeholder:text-white/35"
                />
            </label>

            {#if dashboard.nodeModal.node_type === "action"}
                <label class="block space-y-1.5">
                    <span class="text-xs font-medium text-white/70 block">
                        Website URL
                    </span>
                    <input
                        type="url"
                        required
                        bind:value={dashboard.nodeModal.url}
                        placeholder="https://github.com"
                        class="w-full ios-input px-3 py-2 text-sm text-white placeholder:text-white/35"
                    />
                </label>

                <div class="space-y-1.5">
                    <span class="text-xs font-medium text-white/70 block">
                        Custom Squircle Artwork (optional, max 100 KB)
                    </span>
                    <input
                        type="file"
                        accept="image/*"
                        onchange={handleFileChange}
                        class="w-full text-xs text-white/70 file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-white/14 file:text-white hover:file:bg-white/20 file:cursor-pointer"
                    />
                    {#if dashboard.nodeModal.icon}
                        <div
                            class="flex items-center justify-between gap-2 ios-nested-surface p-2.5 mt-1"
                        >
                            <div class="flex items-center gap-2">
                                <img
                                    src={dashboard.nodeModal.icon}
                                    alt="Custom preview"
                                    class="w-8 h-8 object-cover rounded-[9px]"
                                />
                                <span class="text-xs text-white/75">
                                    Custom artwork active
                                </span>
                            </div>
                            <Button
                                variant="secondary"
                                size="sm"
                                onclick={() =>
                                    (dashboard.nodeModal.icon = null)}
                            >
                                Reset to Favicon
                            </Button>
                        </div>
                    {/if}
                </div>
            {:else if dashboard.nodeModal.node_type === "clock"}
                <div class="grid grid-cols-2 gap-3">
                    <label class="block space-y-1.5">
                        <span class="text-xs font-medium text-white/70 block">
                            IANA Timezone
                        </span>
                        <input
                            type="text"
                            required
                            bind:value={dashboard.nodeModal.settings.timezone}
                            placeholder="Europe/Amsterdam"
                            class="w-full ios-input px-3 py-2 text-sm text-white placeholder:text-white/35"
                        />
                    </label>
                    <label class="block space-y-1.5">
                        <span class="text-xs font-medium text-white/70 block">
                            Flag / Badge
                        </span>
                        <input
                            type="text"
                            bind:value={dashboard.nodeModal.settings.flag}
                            placeholder="🇳🇱"
                            class="w-full ios-input px-3 py-2 text-sm text-white placeholder:text-white/35"
                        />
                    </label>
                </div>
            {:else if dashboard.nodeModal.node_type === "search"}
                <div class="grid grid-cols-2 gap-3">
                    <label class="block space-y-1.5">
                        <span class="text-xs font-medium text-white/70 block">
                            Placeholder
                        </span>
                        <input
                            type="text"
                            bind:value={
                                dashboard.nodeModal.settings.placeholder
                            }
                            placeholder="Search the Web..."
                            class="w-full ios-input px-3 py-2 text-sm text-white placeholder:text-white/35"
                        />
                    </label>
                    <label class="block space-y-1.5">
                        <span class="text-xs font-medium text-white/70 block">
                            Search Engine URL
                        </span>
                        <input
                            type="url"
                            bind:value={dashboard.nodeModal.settings.engineUrl}
                            placeholder="https://www.google.com/search?q="
                            class="w-full ios-input px-3 py-2 text-sm text-white placeholder:text-white/35"
                        />
                    </label>
                </div>
            {/if}

            {#if sizePresets.length > 1 && !isDockedOrChild}
                <div class="space-y-1.5">
                    <span class="text-xs font-medium text-white/70 block">
                        Widget Size Class
                    </span>
                    <div
                        class="flex items-center gap-1.5 p-1 rounded-2xl bg-black/30 border border-white/8"
                    >
                        {#each sizePresets as preset (`${preset.w}x${preset.h}`)}
                            {@const isSelected =
                                dashboard.nodeModal.width === preset.w &&
                                dashboard.nodeModal.height === preset.h}
                            <button
                                type="button"
                                onclick={() =>
                                    selectSizePreset(preset.w, preset.h)}
                                class="flex-1 py-1.5 px-2 rounded-xl text-xs font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer {isSelected
                                    ? 'bg-white text-black font-semibold shadow-sm'
                                    : 'text-white/65 hover:text-white'}"
                            >
                                <span>{preset.label}</span>
                                <span
                                    class="text-[10px] ios-tabular-nums opacity-65"
                                >
                                    {preset.w}×{preset.h}
                                </span>
                            </button>
                        {/each}
                    </div>
                </div>
            {/if}

            {#if formError}
                <p
                    class="text-xs bg-destructive/15 border border-destructive/40 text-destructive rounded-xl p-2.5"
                >
                    {formError}
                </p>
            {/if}

            <div class="flex justify-end gap-2 pt-3 border-t border-white/10">
                <Button variant="ghost" onclick={handleClose}>Cancel</Button>
                <Button type="submit" variant="default">
                    {dashboard.nodeModal.mode === "create"
                        ? "Add to Home Screen"
                        : "Save Changes"}
                </Button>
            </div>
        </form>
    </div>
{/if}
