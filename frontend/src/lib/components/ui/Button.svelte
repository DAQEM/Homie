<script lang="ts">
    import type { Snippet } from "svelte";
    import type { HTMLButtonAttributes } from "svelte/elements";

    export type ButtonVariant =
        "default" | "secondary" | "outline" | "ghost" | "destructive";
    export type ButtonSize = "sm" | "md" | "lg" | "icon";

    interface Props extends HTMLButtonAttributes {
        variant?: ButtonVariant;
        size?: ButtonSize;
        children?: Snippet;
    }

    let {
        type = "button",
        variant = "default",
        size = "md",
        class: className = "",
        children,
        onclick,
        ...restProps
    }: Props = $props();

    const baseStyles =
        "inline-flex items-center justify-center gap-1.5 font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 disabled:pointer-events-none disabled:opacity-45 rounded-full active:scale-[0.96] select-none cursor-pointer";

    const variants: Record<ButtonVariant, string> = {
        default:
            "bg-primary text-primary-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.28),0_4px_12px_-2px_rgba(10,132,255,0.45)] hover:brightness-110",
        secondary:
            "bg-white/12 text-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16)] hover:bg-white/18",
        outline:
            "bg-white/6 text-foreground shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.18)] hover:bg-white/12",
        ghost: "text-foreground/80 hover:text-foreground hover:bg-white/10",
        destructive:
            "bg-destructive text-destructive-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.25),0_4px_12px_-2px_rgba(255,69,58,0.45)] hover:brightness-110",
    };

    const sizes: Record<ButtonSize, string> = {
        sm: "px-3 py-1 text-xs",
        md: "px-3.5 py-1.5 text-[13px]",
        lg: "px-5 py-2.5 text-sm",
        icon: "size-8",
    };
</script>

<button
    {type}
    {onclick}
    class="{baseStyles} {variants[variant]} {sizes[size]} {className}"
    {...restProps}
>
    {#if children}
        {@render children()}
    {/if}
</button>
