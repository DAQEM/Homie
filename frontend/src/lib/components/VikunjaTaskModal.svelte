<script lang="ts">
    import {
        Check,
        ExternalLink,
        Folder,
        MessageSquare,
        Send,
        Star,
        Tag,
        Trash2,
        X,
    } from "@lucide/svelte";
    import { dashboard } from "../state/dashboard.svelte";
    import {
        htmlToPlainText,
        plainTextToTipTapHTML,
        VIKUNJA_ZERO_DATE,
    } from "../state/vikunja.svelte";
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

    let titleDraft = $state("");
    let descDraft = $state("");
    let dueInput = $state("");
    let comments = $state<VikunjaComment[]>([]);
    let commentDraft = $state("");
    let loadingComments = $state(false);

    $effect(() => {
        if (task) {
            titleDraft = task.title;
            descDraft = htmlToPlainText(task.description);
            dueInput = task.due_date ? task.due_date.slice(0, 16) : "";
            loadingComments = true;
            void dashboard.vikunja
                .fetchComments(task.id, integrationId)
                .then((list) => {
                    comments = list;
                    loadingComments = false;
                });
        } else {
            comments = [];
            commentDraft = "";
        }
    });

    async function commitTitle() {
        if (!task) return;
        const trimmed = titleDraft.trim();
        if (!trimmed) {
            titleDraft = task.title;
            return;
        }
        if (trimmed !== task.title) {
            await dashboard.vikunja.updateTask(
                task.id,
                { title: trimmed },
                integrationId,
            );
        }
    }

    async function commitDescription() {
        if (!task) return;
        const currentPlain = htmlToPlainText(task.description);
        if (descDraft.trim() !== currentPlain.trim()) {
            await dashboard.vikunja.updateTask(
                task.id,
                {
                    description: plainTextToTipTapHTML(descDraft),
                },
                integrationId,
            );
        }
    }

    async function commitDueDate() {
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
        onclick={(e) =>
            e.target === e.currentTarget && dashboard.closeVikunjaModal()}
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
                        onclick={() => dashboard.closeVikunjaModal()}
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
                            onchange={commitDueDate}
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

                <!-- Description -->
                <div class="space-y-1.5">
                    <div
                        class="text-[10.5px] font-semibold uppercase tracking-wider text-white/45"
                    >
                        Notes / Description
                    </div>
                    <textarea
                        rows="4"
                        bind:value={descDraft}
                        onblur={commitDescription}
                        placeholder="Add notes..."
                        class="w-full ios-input p-3 text-xs text-white/90 placeholder:text-white/35 leading-relaxed resize-y"
                    ></textarea>
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
                                    <p
                                        class="text-xs text-white/88 whitespace-pre-line"
                                    >
                                        {htmlToPlainText(c.comment)}
                                    </p>
                                </div>
                            {/each}
                        </div>
                    {/if}

                    <form
                        onsubmit={handlePostComment}
                        class="flex items-center gap-2"
                    >
                        <input
                            type="text"
                            bind:value={commentDraft}
                            placeholder="Write a comment..."
                            class="flex-1 ios-input px-3 py-2 text-xs text-white placeholder:text-white/35"
                        />
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
