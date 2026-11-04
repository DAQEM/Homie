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
        "inline-flex items-center justify-center gap-2 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50 rounded-xl cursor-pointer";

    const variants: Record<ButtonVariant, string> = {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary:
            "bg-secondary text-secondary-foreground hover:bg-secondary/90",
        outline:
            "border border-card-border bg-card text-card-foreground hover:border-primary hover:text-primary",
        ghost: "hover:bg-primary hover:text-primary-foreground",
        destructive:
            "bg-destructive text-destructive-foreground hover:bg-destructive/90",
    };

    const sizes: Record<ButtonSize, string> = {
        sm: "px-3 py-1 text-xs",
        md: "px-4 py-2 text-sm",
        lg: "px-6 py-3 text-base",
        icon: "size-9",
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
