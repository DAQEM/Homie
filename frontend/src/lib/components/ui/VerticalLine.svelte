<script lang="ts">
    import type { HTMLAttributes } from "svelte/elements";

    let {
        class: className = "",
        ...restProps
    }: HTMLAttributes<HTMLDivElement> = $props();
</script>

<div class="w-px bg-foreground/20 {className}" {...restProps}></div>
