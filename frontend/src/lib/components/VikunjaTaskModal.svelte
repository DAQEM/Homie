<script lang="ts">
    import {
        Check,
        Eye,
        ExternalLink,
        Folder,
        MessageSquare,
        Pencil,
        Send,
        Star,
        Tag,
        Trash2,
        X,
    } from "@lucide/svelte";
    import {
        htmlToMarkdown,
        markdownToHtml,
        renderMarkdownSafeHtml,
    } from "../markdown";
    import { dashboard } from "../state/dashboard.svelte";
    import { VIKUNJA_ZERO_DATE } from "../state/vikunja.svelte";
    import type { VikunjaComment, VikunjaTask } from "../types";

    const PRIORITIES = [
        { value: 0, label: "None" },
        { value: 1, label: "Low" },
        { value: 2, label: "Medium" },
        { value: 3, label: "High" },
        { value: 4, label: "Urgent" },
        { value: 5, label: "Do Now" },
    ];

    let task = $derived<VikunjaTask | null>(dashboard.openVikunjaTask);
    let integrationId = $derived(
        dashboard.openVikunjaIntegrationId ?? undefined,
    );
    let accountProjects = $derived(
        dashboard.vikunja.getWritableProjects(integrationId),
    );
    let accountLabels = $derived(dashboard.vikunja.getLabels(integrationId));

    let loadedTaskId = $state<number | null>(null);
    let titleDraft = $state("");
    let titleDirty = $state(false);
    let titleFocused = $state(false);

    let descDraft = $state("");
    let lastSavedDescMd = $state("");
    let descDirty = $state(false);
    let descFocused = $state(false);
    let isEditingDesc = $state(false);
    let isSavingDesc = $state(false);

    let dueInput = $state("");
    let dueFocused = $state(false);

    let comments = $state<VikunjaComment[]>([]);
    let commentDraft = $state("");
    let loadingComments = $state(false);

    let descTextareaEl: HTMLTextAreaElement | undefined = $state();
    let markdownPreviewEl: HTMLDivElement | undefined = $state();

    let renderedDescriptionHtml = $derived(
        renderMarkdownSafeHtml(
            isEditingDesc || descDirty
                ? descDraft
                : (task?.description ?? descDraft),
        ),
    );

    $effect(() => {
        if (!task) {
            loadedTaskId = null;
            titleDirty = false;
            descDirty = false;
            isEditingDesc = false;
            isSavingDesc = false;
            comments = [];
            commentDraft = "";
            return;
        }

        if (task.id !== loadedTaskId) {
            const targetId = task.id;
            loadedTaskId = targetId;
            titleDirty = false;
            descDirty = false;
            isEditingDesc = false;
            isSavingDesc = false;

            titleDraft = task.title;
            const md = htmlToMarkdown(task.description);
            descDraft = md;
            lastSavedDescMd = md;
            dueInput = task.due_date ? task.due_date.slice(0, 16) : "";

            loadingComments = true;
            void dashboard.vikunja
                .fetchComments(targetId, integrationId)
                .then((list) => {
                    if (loadedTaskId === targetId) {
                        comments = list;
                        loadingComments = false;
                    }
                });
            return;
        }

        // Background 20s SSE refreshes must never overwrite actively edited / dirty fields
        if (!titleFocused && !titleDirty) {
            titleDraft = task.title;
        }
        if (!descFocused && !descDirty && !isSavingDesc && !isEditingDesc) {
            const incomingMd = htmlToMarkdown(task.description);
            descDraft = incomingMd;
            lastSavedDescMd = incomingMd;
        }
        if (!dueFocused) {
            dueInput = task.due_date ? task.due_date.slice(0, 16) : "";
        }
    });

    async function commitTitle() {
        titleFocused = false;
        if (!task) return;
        const trimmed = titleDraft.trim();
        if (!trimmed) {
            titleDraft = task.title;
            titleDirty = false;
            return;
        }
        if (trimmed !== task.title) {
            await dashboard.vikunja.updateTask(
                task.id,
                { title: trimmed },
                integrationId,
            );
        }
        titleDirty = false;
    }

    async function commitDescription(exitEdit = false) {
        if (!task) return;
        const currentMd = descDraft.replace(/\r\n/g, "\n").trimEnd();
        if (currentMd === lastSavedDescMd.trimEnd()) {
            descDirty = false;
            if (exitEdit) isEditingDesc = false;
            return;
        }

        isSavingDesc = true;
        try {
            const htmlPayload = markdownToHtml(currentMd);
            const updated = await dashboard.vikunja.updateTask(
                task.id,
                { description: htmlPayload },
                integrationId,
            );
            if (updated) {
                lastSavedDescMd = currentMd;
                if (descDraft.replace(/\r\n/g, "\n").trimEnd() === currentMd) {
                    descDirty = false;
                }
            }
        } finally {
            isSavingDesc = false;
            if (exitEdit) isEditingDesc = false;
        }
    }

    function enterDescEdit() {
        isEditingDesc = true;
        queueMicrotask(() => {
            if (descTextareaEl) {
                descTextareaEl.focus();
                const len = descTextareaEl.value.length;
                descTextareaEl.setSelectionRange(len, len);
            }
        });
    }

    function cancelDescEdit() {
        descDraft = lastSavedDescMd;
        descDirty = false;
        isEditingDesc = false;
    }

    function handleDescKeydown(e: KeyboardEvent) {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void commitDescription(true);
            return;
        }
        if (e.key === "Tab") {
            e.preventDefault();
            const el = e.currentTarget as HTMLTextAreaElement;
            const start = el.selectionStart;
            const end = el.selectionEnd;
            descDraft = descDraft.slice(0, start) + "  " + descDraft.slice(end);
            descDirty = true;
            queueMicrotask(() => {
                el.selectionStart = el.selectionEnd = start + 2;
            });
        }
    }

    function handlePreviewClick(e: MouseEvent) {
        const target = e.target as HTMLElement | null;
        if (!target) return;

        // Allow toggling Markdown task list checkboxes directly in Preview mode
        if (target.matches('input[type="checkbox"]') && markdownPreviewEl) {
            e.stopPropagation();
            const checkboxes = Array.from(
                markdownPreviewEl.querySelectorAll('input[type="checkbox"]'),
            );
            const idx = checkboxes.indexOf(target as HTMLInputElement);
            if (idx >= 0) {
                let seen = 0;
                const nextMd = descDraft.replace(
                    /^(\s*[-*+]\s+\[)([ xX])(\]\s+)/gm,
                    (full, pre: string, stateChar: string, post: string) => {
                        if (seen++ === idx) {
                            const nextChar =
                                stateChar.toLowerCase() === "x" ? " " : "x";
                            return `${pre}${nextChar}${post}`;
                        }
                        return full;
                    },
                );
                descDraft = nextMd;
                descDirty = true;
                void commitDescription(false);
            }
        }
    }

    async function commitDueDate() {
        dueFocused = false;
        if (!task) return;
        if (!dueInput) {
            await dashboard.vikunja.updateTask(
                task.id,
                {
                    due_date: VIKUNJA_ZERO_DATE,
                },
                integrationId,
            );
            return;
        }
        const parsed = new Date(dueInput);
        if (!Number.isNaN(parsed.getTime())) {
            await dashboard.vikunja.updateTask(
                task.id,
                {
                    due_date: parsed.toISOString(),
                },
                integrationId,
            );
        }
    }

    async function handlePostComment(e: SubmitEvent) {
        e.preventDefault();
        if (!task || !commentDraft.trim()) return;
        const text = commentDraft.trim();
        commentDraft = "";
        const posted = await dashboard.vikunja.postComment(
            task.id,
            text,
            integrationId,
        );
        if (posted) {
            comments = [...comments, posted];
        }
    }

    async function handleClose() {
        if (titleDirty) {
            await commitTitle();
        }
        if (descDirty) {
            await commitDescription(true);
        }
        dashboard.closeVikunjaModal();
    }

    async function handleDelete() {
        if (!task) return;
        const id = task.id;
        const targetIntegration = integrationId;
        dashboard.closeVikunjaModal();
        await dashboard.vikunja.deleteTask(id, targetIntegration);
    }
</script>

{#if task}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
        role="dialog"
        aria-modal="true"
        aria-label={task.title}
        tabindex="-1"
        onclick={(e) => e.target === e.currentTarget && void handleClose()}
        class="fixed inset-0 z-50 bg-black/50 backdrop-blur-2xl flex items-center justify-center p-4 select-none"
    >
        <div
            class="w-full max-w-[740px] max-h-[86vh] ios-modal-surface rounded-[30px] flex flex-col overflow-hidden text-white shadow-2xl ios-folder-morph"
        >
            <!-- Top Toolbar -->
            <header
                class="px-5 py-3.5 border-b border-white/10 bg-black/15 flex items-center justify-between gap-3 shrink-0"
            >
                <div class="flex items-center gap-2.5 min-w-0">
                    <button
                        type="button"
                        onclick={() =>
                            dashboard.vikunja.updateTask(
                                task.id,
                                {
                                    done: !task.done,
                                },
                                integrationId,
                            )}
                        class="px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer {task.done
                            ? 'bg-[#30D158] text-black'
                            : 'bg-white/10 hover:bg-[#30D158] hover:text-black text-white'}"
                    >
                        <Check class="size-3.5 stroke-[2.75]" />
                        <span>{task.done ? "Completed" : "Mark Done"}</span>
                    </button>

                    <span
                        class="text-xs font-mono text-white/45 ios-tabular-nums"
                    >
                        {dashboard.vikunja.formatTaskIdentifier(
                            task,
                            integrationId,
                        )}
                    </span>
                </div>

                <div class="flex items-center gap-1.5">
                    <button
                        type="button"
                        onclick={() =>
                            dashboard.vikunja.updateTask(
                                task.id,
                                {
                                    is_favorite: !task.is_favorite,
                                },
                                integrationId,
                            )}
                        title="Toggle Favorite"
                        class="size-8 rounded-full bg-white/10 hover:bg-white/18 flex items-center justify-center cursor-pointer"
                    >
                        <Star
                            class="size-4 {task.is_favorite
                                ? 'text-[#FFD60A] fill-[#FFD60A]'
                                : 'text-white/70'}"
                        />
                    </button>

                    {#if task.url}
                        <a
                            href={task.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open in Vikunja Web"
                            class="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/18 text-xs font-medium text-white/85 flex items-center gap-1.5"
                        >
                            <span>Vikunja</span>
                            <ExternalLink class="size-3" />
                        </a>
                    {/if}

                    <button
                        type="button"
                        onclick={handleDelete}
                        title="Delete Task"
                        class="size-8 rounded-full bg-white/10 hover:bg-destructive/25 text-white/70 hover:text-destructive flex items-center justify-center cursor-pointer"
                    >
                        <Trash2 class="size-4" />
                    </button>

                    <button
                        type="button"
                        onclick={() => void handleClose()}
                        class="size-8 rounded-full bg-white/12 hover:bg-white/22 flex items-center justify-center text-white cursor-pointer"
                    >
                        <X class="size-4" />
                    </button>
                </div>
            </header>

            <!-- Body -->
            <div class="flex-1 min-h-0 overflow-y-auto p-5 space-y-5">
                <!-- Editable Title -->
                <input
                    type="text"
                    bind:value={titleDraft}
                    onfocus={() => (titleFocused = true)}
                    oninput={() => (titleDirty = true)}
                    onblur={commitTitle}
                    onkeydown={(e) =>
                        e.key === "Enter" && e.currentTarget.blur()}
                    class="w-full bg-transparent text-xl font-bold text-white ios-tight-tracking focus:bg-white/6 rounded-xl px-2 py-1 -mx-2 outline-none"
                />

                <!-- Properties Grid -->
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <label
                        class="ios-nested-surface p-2.5 rounded-2xl space-y-1 block"
                    >
                        <span
                            class="text-[10px] font-semibold uppercase tracking-wider text-white/45 flex items-center gap-1"
                        >
                            <Folder class="size-3" /> Project
                        </span>
                        <select
                            value={task.project_id}
                            onchange={(e) =>
                                dashboard.vikunja.updateTask(
                                    task.id,
                                    {
                                        project_id: Number(
                                            e.currentTarget.value,
                                        ),
                                    },
                                    integrationId,
                                )}
                            class="w-full bg-transparent text-xs font-semibold text-white focus:outline-none cursor-pointer"
                        >
                            {#each accountProjects as proj (proj.id)}
                                <option value={proj.id} class="bg-[#181920]">
                                    {proj.title}
                                </option>
                            {/each}
                        </select>
                    </label>

                    <label
                        class="ios-nested-surface p-2.5 rounded-2xl space-y-1 block"
                    >
                        <span
                            class="text-[10px] font-semibold uppercase tracking-wider text-white/45 block"
                        >
                            Priority
                        </span>
                        <select
                            value={task.priority}
                            onchange={(e) =>
                                dashboard.vikunja.updateTask(
                                    task.id,
                                    {
                                        priority: Number(e.currentTarget.value),
                                    },
                                    integrationId,
                                )}
                            class="w-full bg-transparent text-xs font-semibold text-white focus:outline-none cursor-pointer"
                        >
                            {#each PRIORITIES as p (p.value)}
                                <option value={p.value} class="bg-[#181920]">
                                    {p.label}
                                </option>
                            {/each}
                        </select>
                    </label>

                    <label
                        class="ios-nested-surface p-2.5 rounded-2xl space-y-1 block"
                    >
                        <span
                            class="text-[10px] font-semibold uppercase tracking-wider text-white/45 block"
                        >
                            Due Date
                        </span>
                        <input
                            type="datetime-local"
                            bind:value={dueInput}
                            onfocus={() => (dueFocused = true)}
                            onchange={commitDueDate}
                            onblur={() => (dueFocused = false)}
                            class="w-full bg-transparent text-[11px] font-semibold text-white ios-tabular-nums focus:outline-none"
                        />
                    </label>

                    <label
                        class="ios-nested-surface p-2.5 rounded-2xl space-y-1 block"
                    >
                        <span
                            class="text-[10px] font-semibold uppercase tracking-wider text-white/45 flex items-center justify-between"
                        >
                            <span>Progress</span>
                            <span class="text-white/80 ios-tabular-nums">
                                {Math.round((task.percent_done || 0) * 100)}%
                            </span>
                        </span>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.1"
                            value={task.percent_done || 0}
                            onchange={(e) =>
                                dashboard.vikunja.updateTask(
                                    task.id,
                                    {
                                        percent_done: Number(
                                            e.currentTarget.value,
                                        ),
                                    },
                                    integrationId,
                                )}
                            class="w-full accent-primary cursor-pointer"
                        />
                    </label>
                </div>

                <!-- Labels -->
                {#if accountLabels.length > 0}
                    <div class="space-y-1.5">
                        <div
                            class="text-[10.5px] font-semibold uppercase tracking-wider text-white/45 flex items-center gap-1.5"
                        >
                            <Tag class="size-3" /> Labels
                        </div>
                        <div class="flex flex-wrap gap-1.5">
                            {#each accountLabels as lbl (lbl.id)}
                                {@const attached = Boolean(
                                    task.labels?.some((l) => l.id === lbl.id),
                                )}
                                <button
                                    type="button"
                                    onclick={() =>
                                        dashboard.vikunja.toggleTaskLabel(
                                            task.id,
                                            lbl,
                                            !attached,
                                            integrationId,
                                        )}
                                    style={attached
                                        ? `background: ${lbl.hex_color || "#0A84FF"}; color: #fff;`
                                        : ""}
                                    class="px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all cursor-pointer {attached
                                        ? 'shadow-xs'
                                        : 'bg-white/8 text-white/60 hover:bg-white/15 hover:text-white'}"
                                >
                                    {lbl.title}
                                </button>
                            {/each}
                        </div>
                    </div>
                {/if}

                <!-- Markdown & Multi-Line Description -->
                <div class="space-y-2">
                    <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-2">
                            <span
                                class="text-[10.5px] font-semibold uppercase tracking-wider text-white/45"
                            >
                                Description (Markdown)
                            </span>
                            {#if isSavingDesc}
                                <span class="text-[10px] text-primary">
                                    Saving…
                                </span>
                            {:else if descDirty}
                                <span class="text-[10px] text-[#FF9F0A]">
                                    Unsaved changes
                                </span>
                            {/if}
                        </div>

                        <div class="flex items-center gap-1.5">
                            {#if isEditingDesc}
                                <button
                                    type="button"
                                    onpointerdown={(e) => e.preventDefault()}
                                    onclick={() => void commitDescription(true)}
                                    class="px-2.5 py-1 rounded-full bg-primary text-white text-[10.5px] font-semibold flex items-center gap-1 hover:brightness-110 cursor-pointer"
                                >
                                    <Check class="size-3 stroke-[2.5]" />
                                    <span>Save</span>
                                </button>
                                <button
                                    type="button"
                                    onpointerdown={(e) => e.preventDefault()}
                                    onclick={cancelDescEdit}
                                    class="px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/18 text-white/75 text-[10.5px] font-semibold cursor-pointer"
                                >
                                    Cancel
                                </button>
                            {:else}
                                <button
                                    type="button"
                                    onclick={enterDescEdit}
                                    class="px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/18 text-white/80 hover:text-white text-[10.5px] font-semibold flex items-center gap-1 cursor-pointer"
                                >
                                    <Pencil class="size-2.5" />
                                    <span>Edit</span>
                                </button>
                            {/if}
                        </div>
                    </div>

                    {#if isEditingDesc}
                        <div class="space-y-1.5">
                            <textarea
                                bind:this={descTextareaEl}
                                rows="7"
                                bind:value={descDraft}
                                onfocus={() => (descFocused = true)}
                                oninput={() => (descDirty = true)}
                                onblur={() => {
                                    descFocused = false;
                                    if (descDirty) {
                                        void commitDescription(false);
                                    }
                                }}
                                onkeydown={handleDescKeydown}
                                placeholder="Write multi-line Markdown notes... (# Heading, **bold**, - [ ] checklist, ```code```)"
                                class="w-full ios-input p-3 text-xs font-mono text-white/95 placeholder:text-white/35 leading-relaxed resize-y min-h-[150px]"
                            ></textarea>
                            <div
                                class="flex items-center justify-between text-[10px] text-white/45 px-1"
                            >
                                <span>
                                    Supports # Headings, **bold**, *italic*, - [
                                    ] tasks, ```code```, links & multi-line
                                    paragraphs
                                </span>
                                <span class="flex items-center gap-2 shrink-0">
                                    <button
                                        type="button"
                                        onpointerdown={(e) =>
                                            e.preventDefault()}
                                        onclick={() =>
                                            void commitDescription(true)}
                                        class="text-primary hover:underline flex items-center gap-1 cursor-pointer"
                                    >
                                        <Eye class="size-3" />
                                        <span>Save & Preview (⌘↵)</span>
                                    </button>
                                </span>
                            </div>
                        </div>
                    {:else if renderedDescriptionHtml}
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <div
                            bind:this={markdownPreviewEl}
                            onclick={handlePreviewClick}
                            ondblclick={enterDescEdit}
                            title="Double-click to edit Markdown"
                            class="ios-nested-surface p-3.5 rounded-2xl ios-markdown min-h-[72px]"
                        >
                            {@html renderedDescriptionHtml}
                        </div>
                    {:else}
                        <button
                            type="button"
                            onclick={enterDescEdit}
                            class="w-full text-left ios-nested-surface p-3.5 rounded-2xl text-xs text-white/40 hover:text-white/70 hover:bg-white/8 transition-colors cursor-pointer"
                        >
                            Click to add a Markdown description...
                        </button>
                    {/if}
                </div>

                <!-- Comments -->
                <div class="space-y-2.5 pt-2 border-t border-white/10">
                    <div
                        class="text-[10.5px] font-semibold uppercase tracking-wider text-white/45 flex items-center gap-1.5"
                    >
                        <MessageSquare class="size-3" />
                        <span>Comments ({comments.length})</span>
                    </div>

                    {#if loadingComments}
                        <p class="text-xs text-white/40">Loading comments...</p>
                    {:else}
                        <div class="space-y-2">
                            {#each comments as c (c.id)}
                                <div
                                    class="ios-nested-surface p-2.5 rounded-2xl space-y-1"
                                >
                                    <div
                                        class="flex items-center justify-between text-[10px] text-white/50"
                                    >
                                        <span
                                            class="font-semibold text-white/80"
                                        >
                                            {c.author?.name ||
                                                c.author?.username ||
                                                "User"}
                                        </span>
                                        {#if c.created}
                                            <span class="ios-tabular-nums">
                                                {new Date(
                                                    c.created,
                                                ).toLocaleString()}
                                            </span>
                                        {/if}
                                    </div>
                                    <div class="ios-markdown text-xs">
                                        {@html renderMarkdownSafeHtml(
                                            c.comment,
                                        )}
                                    </div>
                                </div>
                            {/each}
                        </div>
                    {/if}

                    <form
                        onsubmit={handlePostComment}
                        class="flex items-end gap-2"
                    >
                        <textarea
                            rows="2"
                            bind:value={commentDraft}
                            onkeydown={(e) => {
                                if (
                                    (e.metaKey || e.ctrlKey) &&
                                    e.key === "Enter"
                                ) {
                                    e.preventDefault();
                                    e.currentTarget.form?.requestSubmit();
                                }
                            }}
                            placeholder="Write a Markdown comment... (⌘↵ to send)"
                            class="flex-1 ios-input px-3 py-2 text-xs text-white placeholder:text-white/35 resize-none"
                        ></textarea>
                        <button
                            type="submit"
                            class="size-8 rounded-full bg-primary text-white flex items-center justify-center shrink-0 hover:brightness-110 cursor-pointer"
                        >
                            <Send class="size-3.5" />
                        </button>
                    </form>
                </div>
            </div>
        </div>
    </div>
{/if}
