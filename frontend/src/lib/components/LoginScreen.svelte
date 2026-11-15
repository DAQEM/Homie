<script lang="ts">
    import { AlertCircle, LogIn, ShieldCheck } from "@lucide/svelte";
    import { dashboard } from "../state/dashboard.svelte";

    let timeText = $derived(
        new Intl.DateTimeFormat("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        }).format(dashboard.now),
    );

    let dateText = $derived(
        new Intl.DateTimeFormat("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
        }).format(dashboard.now),
    );
</script>

<div
    class="relative min-h-screen flex flex-col items-center justify-center p-6 select-none"
>
    <div class="mb-8 text-center space-y-1">
        <div
            class="text-sm font-medium text-white/75 ios-label-shadow tracking-tight"
        >
            {dateText}
        </div>
        <div
            class="text-6xl font-semibold text-white ios-tabular-nums ios-tight-tracking ios-label-shadow"
        >
            {timeText}
        </div>
    </div>

    <div
        class="w-full max-w-[380px] ios-modal-surface rounded-[32px] p-7 text-center space-y-5 shadow-2xl"
    >
        <div
            class="mx-auto size-14 rounded-[18px] bg-primary/20 border border-primary/40 text-primary flex items-center justify-center shadow-inner"
        >
            <ShieldCheck class="size-7" />
        </div>

        <div class="space-y-1.5">
            <h1 class="text-xl font-bold text-white ios-tight-tracking">
                Homie
            </h1>
            <p class="text-xs text-white/60 leading-relaxed">
                Sign in with {dashboard.auth.providerName} to unlock your personal
                Home Screen, widgets, and integrations.
            </p>
        </div>

        {#if dashboard.auth.authError}
            <div
                class="flex items-start gap-2 text-left text-xs bg-destructive/15 border border-destructive/40 text-destructive rounded-2xl p-3"
            >
                <AlertCircle class="size-4 shrink-0 mt-0.5" />
                <span>{dashboard.auth.authError}</span>
            </div>
        {/if}

        <button
            type="button"
            onclick={() => dashboard.auth.login()}
            class="w-full py-3 px-5 rounded-full bg-primary text-white text-sm font-semibold shadow-[inset_0_1px_0_0_rgba(255,255,255,0.3),0_8px_22px_-4px_rgba(10,132,255,0.55)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
        >
            <LogIn class="size-4" />
            <span>Sign in with {dashboard.auth.providerName}</span>
        </button>
    </div>
</div>
