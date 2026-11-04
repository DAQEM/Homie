<script lang="ts">
    /**
     * GPU-composited iPadOS Ambient Wallpaper Layer.
     * Uses pre-composited radial & conic colour meshes on a fixed layer with
     * `translate3d(0,0,0)` so translucent glass widgets refract rich colour
     * with zero runtime CPU/GPU animation overhead.
     */
</script>

<div
    aria-hidden="true"
    class="fixed inset-0 -z-10 pointer-events-none overflow-hidden select-none transform-gpu translate-z-0 bg-[#06070c]"
>
    <!-- Primary Cupertino Deep Blue & Indigo Aura -->
    <div
        class="absolute -top-[22%] -left-[12%] w-[75vw] h-[75vh] rounded-full opacity-55"
        style="background: radial-gradient(circle at center, rgba(10, 132, 255, 0.42) 0%, rgba(94, 92, 230, 0.22) 42%, transparent 72%); filter: blur(60px);"
    ></div>

    <!-- Secondary Midnight Purple & Magenta Refracting Glow -->
    <div
        class="absolute top-[18%] -right-[15%] w-[68vw] h-[72vh] rounded-full opacity-45"
        style="background: radial-gradient(circle at center, rgba(191, 90, 242, 0.34) 0%, rgba(94, 92, 230, 0.2) 46%, transparent 72%); filter: blur(64px);"
    ></div>

    <!-- Bottom Teal / Cyan Horizon Glow (refracts through the Dock) -->
    <div
        class="absolute -bottom-[24%] left-[18%] w-[65vw] h-[60vh] rounded-full opacity-40"
        style="background: radial-gradient(circle at center, rgba(100, 210, 255, 0.32) 0%, rgba(10, 132, 255, 0.18) 48%, transparent 74%); filter: blur(60px);"
    ></div>

    <!-- Subtle Vignette & Depth Overlay for Crisp White Icon Labels -->
    <div
        class="absolute inset-0"
        style="background: radial-gradient(circle at 50% 42%, rgba(7, 8, 13, 0.12) 0%, rgba(5, 6, 10, 0.58) 100%);"
    ></div>
</div>
