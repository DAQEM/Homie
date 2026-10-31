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
        "inline-flex items-center justify-center gap-2 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 rounded-xl";

    const variants: Record<ButtonVariant, string> = {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        outline: "",
        ghost: "hover:bg-primary hover:text-primary-foreground",
        destructive: "",
    };

    const sizes: Record<ButtonSize, string> = {
        sm: "px-3 py-1 text-sm",
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
