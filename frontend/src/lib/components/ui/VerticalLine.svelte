<script lang="ts">
    import type { HTMLAttributes } from "svelte/elements";

    let {
        class: className = "",
        ...restProps
    }: HTMLAttributes<HTMLDivElement> = $props();
</script>

<div class="w-px bg-white/14 shrink-0 {className}" {...restProps}></div>
