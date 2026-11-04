<script lang="ts">
    import {
        Calendar,
        Clock,
        Folder,
        Globe,
        GripHorizontal,
        ListTodo,
        Loader2,
        Plus,
        Search,
        Sparkles,
        X,
    } from "@lucide/svelte";
    import {
        dashboard,
        DEFAULT_NODE_SIZES,
        MAX_ICON_BYTES,
        WIDGET_SIZE_PRESETS,
    } from "../state/dashboard.svelte";
    import {
        getNodeBrandGradient,
        getNodeIconSrc,
        type DashboardNode,
        type NodeType,
        type WorldClockCity,
    } from "../types";
    import Button from "./ui/Button.svelte";
    import ClockTile from "./widgets/ClockTile.svelte";
    import TodoTile from "./widgets/TodoTile.svelte";
    import CalendarTile from "./widgets/CalendarTile.svelte";
    import SearchTile from "./widgets/SearchTile.svelte";

    let formError = $state<string | null>(null);
    let gallerySearch = $state("");
    let isFetchingMeta = $state(false);
    let lastAutoFetchedUrl = "";
    let userManuallyEditedTitle = $state(false);
    let metaDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    let previewContainerEl: HTMLDivElement | undefined = $state();

    const DEFAULT_QUAD_CITIES: WorldClockCity[] = [
        { name: "Amsterdam", timezone: "Europe/Amsterdam", flag: "🇳🇱" },
        { name: "Cupertino", timezone: "America/Los_Angeles", flag: "🇺🇸" },
        { name: "New York", timezone: "America/New_York", flag: "🇺🇸" },
        { name: "Tokyo", timezone: "Asia/Tokyo", flag: "🇯🇵" },
    ];

    let isDockedOrChild = $derived(
        dashboard.nodeModal.parent_id !== null ||
            (dashboard.nodeModal.grid_x === -1 &&
                dashboard.nodeModal.grid_y === -1),
    );

    let isGalleryMode = $derived(
        dashboard.nodeModal.mode === "create" && !isDockedOrChild,
    );

    let isQuadClockSelected = $derived(
        dashboard.nodeModal.node_type === "clock" &&
            dashboard.nodeModal.width >= 4 &&
            dashboard.nodeModal.height >= 4,
    );

    $effect(() => {
        if (
            isQuadClockSelected &&
            (!dashboard.nodeModal.settings.cities ||
                dashboard.nodeModal.settings.cities.length < 4)
        ) {
            dashboard.nodeModal.settings.cities =
                structuredClone(DEFAULT_QUAD_CITIES);
        }
    });

    let sizePresets = $derived(
        WIDGET_SIZE_PRESETS[dashboard.nodeModal.node_type] ?? [],
    );

    const galleryItems: {
        type: NodeType;
        label: string;
        subtitle: string;
        description: string;
        accent: string;
    }[] = [
        {
            type: "clock",
            label: "World Clock",
            subtitle: "Day & night analog dial",
            description:
                "Track local time in a single city or a 4-city world grid with adaptive day/night dials.",
            accent: "bg-[#FF9F0A]",
        },
        {
            type: "todo",
            label: "Reminders",
            subtitle: "Tasks & priority flags",
            description:
                "Stay on top of daily tasks with interactive iOS completion rings and priority flags.",
            accent: "bg-[#0A84FF]",
        },
        {
            type: "calendar",
            label: "Calendar",
            subtitle: "Up next & month grid",
            description:
                "Glance at today's schedule alongside an interactive monthly calendar view.",
            accent: "bg-[#FF453A]",
        },
        {
            type: "search",
            label: "Web Search",
            subtitle: "Quick launch & Spotlight",
            description:
                "Search your favorite web engine or trigger Spotlight directly from the Home Screen.",
            accent: "bg-[#30D158]",
        },
        {
            type: "action",
            label: "App Shortcut",
            subtitle: "Website icon & auto-title",
            description:
                "Pin any web app or bookmark as a tactile iPadOS squircle with automatic icon discovery.",
            accent: "bg-[#0A84FF]",
        },
        {
            type: "container",
            label: "App Folder",
            subtitle: "Group shortcuts together",
            description:
                "Organize related web apps into a morphing iPadOS folder or expanded grid.",
            accent: "bg-[#5E5CE6]",
        },
    ];

    let filteredGalleryItems = $derived.by(() => {
        const q = gallerySearch.trim().toLowerCase();
        return galleryItems.filter((item) => {
            if (
                isDockedOrChild &&
                item.type !== "action" &&
                item.type !== "container"
            ) {
                return false;
            }
            if (!q) return true;
            return (
                item.label.toLowerCase().includes(q) ||
                item.subtitle.toLowerCase().includes(q) ||
                item.description.toLowerCase().includes(q)
            );
        });
    });

    let activeGalleryMeta = $derived(
        galleryItems.find((i) => i.type === dashboard.nodeModal.node_type) ??
            galleryItems[0],
    );

    let previewNode = $derived.by<DashboardNode>(() => {
        const defaultTitleMap: Record<NodeType, string> = {
            action: "GitHub",
            container: "Folder",
            clock: "Amsterdam",
            search: "Search",
            todo: "Reminders",
            calendar: "Schedule",
        };
        const t = dashboard.nodeModal.node_type;
        const nowIso = new Date().toISOString();
        return {
            id: "gallery-preview-node",
            workspace_id: dashboard.activeWorkspace?.id ?? "",
            parent_id: null,
            sort_order: 1,
            grid_x: 1,
            grid_y: 1,
            title: dashboard.nodeModal.title.trim() || defaultTitleMap[t],
            icon: dashboard.nodeModal.icon,
            node_type: t,
            url:
                t === "action"
                    ? dashboard.nodeModal.url.trim() || "https://github.com"
                    : null,
            width: dashboard.nodeModal.width || DEFAULT_NODE_SIZES[t].w,
            height: dashboard.nodeModal.height || DEFAULT_NODE_SIZES[t].h,
            settings: {
                timezone:
                    dashboard.nodeModal.settings.timezone || "Europe/Amsterdam",
                flag: dashboard.nodeModal.settings.flag || "🇳🇱",
                sweepSeconds:
                    dashboard.nodeModal.settings.sweepSeconds !== false,
                cities: dashboard.nodeModal.settings.cities,
                placeholder:
                    dashboard.nodeModal.settings.placeholder ||
                    "Search Web or Spotlight (⌘K)...",
                engineUrl:
                    dashboard.nodeModal.settings.engineUrl ||
                    "https://www.google.com/search?q=",
                todos: dashboard.nodeModal.settings.todos?.length
                    ? dashboard.nodeModal.settings.todos
                    : [
                          {
                              id: "p1",
                              text: "Review design system",
                              priority: true,
                              done: false,
                          },
                          {
                              id: "p2",
                              text: "Ship iPadOS spatial update",
                              priority: false,
                              done: true,
                          },
                      ],
                events: dashboard.nodeModal.settings.events?.length
                    ? dashboard.nodeModal.settings.events
                    : [
                          {
                              id: "e1",
                              title: "Design Critique",
                              time: "10:30 - 11:15",
                              color: "#0A84FF",
                          },
                          {
                              id: "e2",
                              title: "Architecture Sync",
                              time: "14:00 - 15:00",
                              color: "#30D158",
                          },
                      ],
            },
            created_at: nowIso,
            updated_at: nowIso,
        };
    });

    let previewPixelSize = $derived.by(() => {
        const w = previewNode.width || 2;
        const h = previewNode.height || 2;
        if (w >= 4 && h >= 4) {
            return "width: 340px; height: 220px;";
        }
        const pxW = w === 1 ? 84 : Math.min(w * 86 + (w - 1) * 12, 420);
        const pxH = h === 1 ? 66 : Math.min(h * 92 + (h - 1) * 12, 220);
        return `width: ${pxW}px; height: ${pxH}px;`;
    });

    $effect(() => {
        if (dashboard.nodeModal.open) {
            formError = null;
            userManuallyEditedTitle = dashboard.nodeModal.mode === "edit";
            lastAutoFetchedUrl = "";
        }
    });

    function selectNodeType(t: NodeType) {
        dashboard.nodeModal.node_type = t;
        const size = DEFAULT_NODE_SIZES[t];
        dashboard.nodeModal.width = size.w;
        dashboard.nodeModal.height = size.h;
        formError = null;
    }

    function selectSizePreset(w: number, h: number) {
        dashboard.nodeModal.width = w;
        dashboard.nodeModal.height = h;
    }

    function handleUrlInput() {
        if (dashboard.nodeModal.node_type !== "action") return;
        const raw = dashboard.nodeModal.url.trim();
        if (metaDebounceTimer) clearTimeout(metaDebounceTimer);

        if (!raw || raw === "https://" || raw === "http://") return;

        let parsed: URL;
        try {
            parsed = new URL(
                raw.startsWith("http://") || raw.startsWith("https://")
                    ? raw
                    : `https://${raw}`,
            );
        } catch {
            return;
        }

        if (!parsed.hostname.includes(".") && parsed.hostname !== "localhost") {
            return;
        }

        const targetHref = parsed.toString();
        if (targetHref === lastAutoFetchedUrl) return;

        metaDebounceTimer = setTimeout(async () => {
            isFetchingMeta = true;
            try {
                const res = await fetch(
                    `/api/v1/meta?url=${encodeURIComponent(targetHref)}`,
                );
                if (res.ok) {
                    const data = (await res.json()) as {
                        title?: string;
                        canonical_url?: string;
                    };
                    lastAutoFetchedUrl = targetHref;
                    if (
                        data.title &&
                        (!userManuallyEditedTitle ||
                            !dashboard.nodeModal.title.trim())
                    ) {
                        dashboard.nodeModal.title = data.title;
                    }
                }
            } catch {
                // Ignore network errors on metadata preview
            } finally {
                isFetchingMeta = false;
            }
        }, 280);
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

    function handleStagePreviewPointerDown(e: PointerEvent) {
        if (
            e.button !== 0 ||
            !isGalleryMode ||
            dashboard.nodeModal.node_type === "action"
        ) {
            return;
        }
        const startX = e.clientX;
        const startY = e.clientY;
        const rect = previewContainerEl?.getBoundingClientRect();

        const onMove = (moveEvent: PointerEvent) => {
            const dist = Math.hypot(
                moveEvent.clientX - startX,
                moveEvent.clientY - startY,
            );
            if (dist > 14) {
                cleanup();
                const bounds = rect
                    ? {
                          left: rect.left,
                          top: rect.top,
                          width: rect.width,
                          height: rect.height,
                      }
                    : {
                          left: startX - 90,
                          top: startY - 90,
                          width: 180,
                          height: 180,
                      };
                void dashboard.startGalleryWidgetDrag(
                    moveEvent.clientX,
                    moveEvent.clientY,
                    bounds,
                );
            }
        };

        const cleanup = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", cleanup);
            window.removeEventListener("pointercancel", cleanup);
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", cleanup);
        window.addEventListener("pointercancel", cleanup);
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
        {#if isGalleryMode}
            <!-- Two-Column iPadOS Widget Gallery Sheet -->
            <form
                onsubmit={handleSubmit}
                class="w-full max-w-[800px] h-[560px] max-h-[92vh] ios-modal-surface rounded-[32px] text-card-foreground flex overflow-hidden shadow-2xl ios-context-menu"
            >
                <!-- Left Sidebar: Search & Widget Families -->
                <aside
                    class="w-[236px] shrink-0 border-r border-white/10 bg-black/20 p-3.5 flex flex-col gap-3"
                >
                    <div
                        class="ios-input px-3 py-1.5 flex items-center gap-2 rounded-full"
                    >
                        <Search class="size-3.5 text-white/45 shrink-0" />
                        <input
                            type="text"
                            bind:value={gallerySearch}
                            placeholder="Search Widgets"
                            class="w-full bg-transparent text-xs text-white placeholder:text-white/40 focus:outline-none"
                        />
                    </div>

                    <div class="flex-1 overflow-y-auto space-y-1 pr-0.5">
                        {#each filteredGalleryItems as item (item.type)}
                            {@const isSelected =
                                dashboard.nodeModal.node_type === item.type}
                            <button
                                type="button"
                                onclick={() => selectNodeType(item.type)}
                                class="w-full p-2 rounded-[16px] text-left transition-all flex items-center gap-2.5 cursor-pointer {isSelected
                                    ? 'bg-primary text-white shadow-sm'
                                    : 'text-white/80 hover:bg-white/8'}"
                            >
                                <div
                                    class="size-7 rounded-[9px] {isSelected
                                        ? 'bg-white/20'
                                        : item.accent} text-white flex items-center justify-center shrink-0 shadow-xs"
                                >
                                    {#if item.type === "action"}
                                        <Globe class="size-3.5" />
                                    {:else if item.type === "container"}
                                        <Folder class="size-3.5" />
                                    {:else if item.type === "clock"}
                                        <Clock class="size-3.5" />
                                    {:else if item.type === "todo"}
                                        <ListTodo class="size-3.5" />
                                    {:else if item.type === "calendar"}
                                        <Calendar class="size-3.5" />
                                    {:else if item.type === "search"}
                                        <Search class="size-3.5" />
                                    {/if}
                                </div>
                                <div class="min-w-0">
                                    <div class="text-xs font-semibold truncate">
                                        {item.label}
                                    </div>
                                    <div
                                        class="text-[10px] truncate {isSelected
                                            ? 'text-white/80'
                                            : 'text-white/45'}"
                                    >
                                        {item.subtitle}
                                    </div>
                                </div>
                            </button>
                        {/each}
                    </div>
                </aside>

                <!-- Right Stage: Live WYSIWYG Preview & Instant Installation -->
                <div
                    class="flex-1 flex flex-col justify-between p-5 min-w-0 overflow-y-auto"
                >
                    <!-- Top Stage Header -->
                    <div
                        class="flex items-start justify-between gap-3 shrink-0"
                    >
                        <div>
                            <h3
                                class="text-base font-semibold text-white ios-tight-tracking"
                            >
                                {activeGalleryMeta.label}
                            </h3>
                            <p class="text-xs text-white/55 leading-relaxed">
                                {activeGalleryMeta.description}
                            </p>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            onclick={handleClose}
                        >
                            <X class="size-4" />
                        </Button>
                    </div>

                    {#if dashboard.nodeModal.node_type === "action"}
                        {@const previewIconSrc = getNodeIconSrc(previewNode)}
                        {@const previewGrad = getNodeBrandGradient(previewNode)}
                        {@const hasUpload = Boolean(
                            dashboard.nodeModal.icon &&
                            dashboard.nodeModal.icon.startsWith("data:"),
                        )}
                        <div class="my-auto space-y-4">
                            <div
                                class="ios-gallery-stage rounded-[24px] py-5 px-4 flex flex-col items-center justify-center gap-2"
                            >
                                <div
                                    style={!hasUpload
                                        ? `background: ${previewGrad};`
                                        : ""}
                                    class="relative size-[68px] rounded-[18px] ios-icon-surface flex items-center justify-center overflow-hidden shadow-xl"
                                >
                                    <div
                                        aria-hidden="true"
                                        class="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/20 to-transparent"
                                    ></div>
                                    {#if hasUpload && previewIconSrc}
                                        <img
                                            src={previewIconSrc}
                                            alt="Preview"
                                            class="w-full h-full object-cover"
                                        />
                                    {:else if previewIconSrc}
                                        <img
                                            src={previewIconSrc}
                                            alt="Preview"
                                            class="w-10 h-10 object-contain drop-shadow-md"
                                        />
                                    {:else}
                                        <span
                                            class="text-xl font-bold text-white uppercase"
                                        >
                                            {previewNode.title.slice(0, 2)}
                                        </span>
                                    {/if}
                                </div>
                                <div
                                    class="flex items-center gap-1.5 text-xs font-medium text-white/90 ios-label-shadow"
                                >
                                    <span>{previewNode.title}</span>
                                    {#if isFetchingMeta}
                                        <Loader2
                                            class="size-3 text-primary animate-spin"
                                        />
                                    {/if}
                                </div>
                            </div>

                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <label class="block space-y-1">
                                    <span
                                        class="text-[11px] font-medium text-white/70 flex items-center justify-between"
                                    >
                                        <span>Website URL</span>
                                        <span
                                            class="text-[10px] text-primary flex items-center gap-0.5"
                                        >
                                            <Sparkles class="size-2.5" />
                                            Auto-fills title
                                        </span>
                                    </span>
                                    <input
                                        type="url"
                                        required
                                        bind:value={dashboard.nodeModal.url}
                                        oninput={handleUrlInput}
                                        placeholder="https://github.com"
                                        class="w-full ios-input px-3 py-2 text-xs text-white placeholder:text-white/35"
                                    />
                                </label>

                                <label class="block space-y-1">
                                    <span
                                        class="text-[11px] font-medium text-white/70 block"
                                    >
                                        Shortcut Title
                                    </span>
                                    <input
                                        type="text"
                                        required
                                        bind:value={dashboard.nodeModal.title}
                                        oninput={() =>
                                            (userManuallyEditedTitle = true)}
                                        placeholder="Auto-detected from URL"
                                        class="w-full ios-input px-3 py-2 text-xs text-white placeholder:text-white/35"
                                    />
                                </label>
                            </div>

                            <div
                                class="flex items-center justify-between gap-3"
                            >
                                <label
                                    class="text-[11px] text-white/65 hover:text-white cursor-pointer flex items-center gap-2"
                                >
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onchange={handleFileChange}
                                        class="hidden"
                                    />
                                    <span
                                        class="px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/16 text-white text-[11px] font-medium transition-colors"
                                    >
                                        Upload Custom Artwork (optional)
                                    </span>
                                </label>
                                {#if dashboard.nodeModal.icon}
                                    <button
                                        type="button"
                                        onclick={() =>
                                            (dashboard.nodeModal.icon = null)}
                                        class="text-[11px] text-white/55 hover:text-white underline cursor-pointer"
                                    >
                                        Reset to Favicon
                                    </button>
                                {/if}
                            </div>
                        </div>
                    {:else}
                        <!-- Live Interactive Widget Preview Stage -->
                        <div class="my-auto space-y-2.5">
                            <div
                                onpointerdown={handleStagePreviewPointerDown}
                                title="Drag directly onto your Home Screen or click Add Widget"
                                class="relative ios-gallery-stage rounded-[24px] h-[235px] flex flex-col items-center justify-center p-3 overflow-hidden cursor-grab active:cursor-grabbing group/stage"
                            >
                                <div
                                    bind:this={previewContainerEl}
                                    style={previewPixelSize}
                                    class="pointer-events-none transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/stage:scale-[1.02] shadow-2xl"
                                >
                                    {#if previewNode.node_type === "clock"}
                                        <ClockTile node={previewNode} />
                                    {:else if previewNode.node_type === "todo"}
                                        <TodoTile node={previewNode} />
                                    {:else if previewNode.node_type === "calendar"}
                                        <CalendarTile node={previewNode} />
                                    {:else if previewNode.node_type === "search"}
                                        <SearchTile node={previewNode} />
                                    {:else if previewNode.node_type === "container"}
                                        <div
                                            class="w-full h-full ios-widget-surface p-3 flex items-center justify-center text-xs text-white/60"
                                        >
                                            {previewNode.title} ({previewNode.width}×{previewNode.height})
                                        </div>
                                    {/if}
                                </div>

                                <span
                                    class="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 text-[10px] font-medium text-white/45 group-hover/stage:text-white/75 transition-colors"
                                >
                                    <GripHorizontal class="size-3" />
                                    Drag widget onto Home Screen or click Add below
                                </span>
                            </div>

                            {#if isQuadClockSelected && dashboard.nodeModal.settings.cities}
                                <!-- 4-City Configuration Grid for 4x4 World Clock -->
                                <div class="grid grid-cols-2 gap-2">
                                    {#each dashboard.nodeModal.settings.cities.slice(0, 4) as city, idx (idx)}
                                        <div
                                            class="ios-nested-surface p-2 rounded-xl grid grid-cols-12 gap-1.5 items-center"
                                        >
                                            <input
                                                type="text"
                                                bind:value={city.flag}
                                                placeholder="🌍"
                                                class="col-span-2 ios-input px-1 py-1 text-[11px] text-center"
                                            />
                                            <input
                                                type="text"
                                                bind:value={city.name}
                                                placeholder="City"
                                                class="col-span-4 ios-input px-2 py-1 text-[11px] text-white"
                                            />
                                            <input
                                                type="text"
                                                list="iana-timezones-list"
                                                bind:value={city.timezone}
                                                placeholder="Europe/Amsterdam"
                                                class="col-span-6 ios-input px-2 py-1 text-[10px] text-white/85 font-mono"
                                            />
                                        </div>
                                    {/each}
                                </div>
                            {:else}
                                <div class="grid grid-cols-3 gap-2.5">
                                    <label class="block space-y-1">
                                        <span
                                            class="text-[10px] font-medium text-white/60 block"
                                        >
                                            Title
                                        </span>
                                        <input
                                            type="text"
                                            bind:value={
                                                dashboard.nodeModal.title
                                            }
                                            placeholder={previewNode.title}
                                            class="w-full ios-input px-2.5 py-1.5 text-xs text-white placeholder:text-white/35"
                                        />
                                    </label>

                                    {#if dashboard.nodeModal.node_type === "clock"}
                                        <label class="block space-y-1">
                                            <span
                                                class="text-[10px] font-medium text-white/60 block"
                                            >
                                                IANA Timezone
                                            </span>
                                            <input
                                                type="text"
                                                list="iana-timezones-list"
                                                bind:value={
                                                    dashboard.nodeModal.settings
                                                        .timezone
                                                }
                                                placeholder="Europe/Amsterdam"
                                                class="w-full ios-input px-2.5 py-1.5 text-xs text-white"
                                            />
                                        </label>
                                        <label class="block space-y-1">
                                            <span
                                                class="text-[10px] font-medium text-white/60 block"
                                            >
                                                Flag
                                            </span>
                                            <input
                                                type="text"
                                                bind:value={
                                                    dashboard.nodeModal.settings
                                                        .flag
                                                }
                                                placeholder="🇳🇱"
                                                class="w-full ios-input px-2.5 py-1.5 text-xs text-white text-center"
                                            />
                                        </label>
                                    {:else if dashboard.nodeModal.node_type === "search"}
                                        <label
                                            class="col-span-2 block space-y-1"
                                        >
                                            <span
                                                class="text-[10px] font-medium text-white/60 block"
                                            >
                                                Search Engine URL
                                            </span>
                                            <input
                                                type="url"
                                                bind:value={
                                                    dashboard.nodeModal.settings
                                                        .engineUrl
                                                }
                                                placeholder="https://www.google.com/search?q="
                                                class="w-full ios-input px-2.5 py-1.5 text-xs text-white"
                                            />
                                        </label>
                                    {/if}
                                </div>
                            {/if}
                        </div>
                    {/if}

                    {#if formError}
                        <p
                            class="text-xs bg-destructive/15 border border-destructive/40 text-destructive rounded-xl p-2"
                        >
                            {formError}
                        </p>
                    {/if}

                    <!-- Bottom Gallery Bar: Size Segmented Picker + "+ Add Widget" Pill -->
                    <div
                        class="flex items-center justify-between gap-3 pt-3 border-t border-white/10 shrink-0"
                    >
                        {#if sizePresets.length > 1}
                            <div
                                class="flex items-center gap-1 p-1 rounded-full bg-black/35 border border-white/8"
                            >
                                {#each sizePresets as preset (`${preset.w}x${preset.h}`)}
                                    {@const isSelected =
                                        dashboard.nodeModal.width ===
                                            preset.w &&
                                        dashboard.nodeModal.height === preset.h}
                                    <button
                                        type="button"
                                        onclick={() =>
                                            selectSizePreset(
                                                preset.w,
                                                preset.h,
                                            )}
                                        class="px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer {isSelected
                                            ? 'bg-white text-black shadow-xs'
                                            : 'text-white/65 hover:text-white'}"
                                    >
                                        {preset.label}
                                        <span
                                            class="text-[10px] opacity-60 ml-0.5 ios-tabular-nums"
                                        >
                                            {preset.w}×{preset.h}
                                        </span>
                                    </button>
                                {/each}
                            </div>
                        {:else}
                            <div class="text-[11px] text-white/45">
                                1×1 Home Screen Squircle
                            </div>
                        {/if}

                        <Button type="submit" variant="default" size="md">
                            <Plus class="size-3.5 stroke-[2.5]" />
                            <span>
                                {dashboard.nodeModal.node_type === "action"
                                    ? "Add Shortcut"
                                    : "Add Widget"}
                            </span>
                        </Button>
                    </div>
                </div>
            </form>
        {:else}
            <!-- Compact Sheet for Editing an Existing Shortcut/Folder or Adding inside a Folder/Dock -->
            <form
                onsubmit={handleSubmit}
                class="max-w-md w-full ios-modal-surface rounded-[30px] text-card-foreground p-6 space-y-4 ios-context-menu"
            >
                <div
                    class="flex items-center justify-between border-b border-white/10 pb-3.5"
                >
                    <div>
                        <h3 class="text-base font-semibold ios-tight-tracking">
                            {dashboard.nodeModal.mode === "create"
                                ? "Add Shortcut"
                                : dashboard.nodeModal.node_type === "container"
                                  ? "Edit Folder"
                                  : "Edit Shortcut"}
                        </h3>
                        <p class="text-[11px] text-white/50">
                            {dashboard.nodeModal.node_type === "container"
                                ? "Update folder title"
                                : "Paste a URL to auto-detect the title and app icon"}
                        </p>
                    </div>
                    <Button variant="ghost" size="icon" onclick={handleClose}>
                        <X class="size-4" />
                    </Button>
                </div>

                {#if dashboard.nodeModal.node_type === "action"}
                    <label class="block space-y-1.5">
                        <span
                            class="text-xs font-medium text-white/70 flex items-center justify-between"
                        >
                            <span>Website URL</span>
                            {#if isFetchingMeta}
                                <Loader2
                                    class="size-3.5 text-primary animate-spin"
                                />
                            {/if}
                        </span>
                        <input
                            type="url"
                            required
                            bind:value={dashboard.nodeModal.url}
                            oninput={handleUrlInput}
                            placeholder="https://github.com"
                            class="w-full ios-input px-3 py-2 text-sm text-white placeholder:text-white/35"
                        />
                    </label>
                {/if}

                <label class="block space-y-1.5">
                    <span class="text-xs font-medium text-white/70 block">
                        Title
                    </span>
                    <input
                        type="text"
                        required
                        bind:value={dashboard.nodeModal.title}
                        oninput={() => (userManuallyEditedTitle = true)}
                        placeholder="e.g. GitHub"
                        class="w-full ios-input px-3 py-2 text-sm text-white placeholder:text-white/35"
                    />
                </label>

                {#if dashboard.nodeModal.node_type === "action"}
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
                                    Reset
                                </Button>
                            </div>
                        {/if}
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
                    class="flex justify-end gap-2 pt-3 border-t border-white/10"
                >
                    <Button variant="ghost" onclick={handleClose}>Cancel</Button
                    >
                    <Button type="submit" variant="default">
                        {dashboard.nodeModal.mode === "create"
                            ? "Add"
                            : "Save Changes"}
                    </Button>
                </div>
            </form>
        {/if}
    </div>
{/if}
