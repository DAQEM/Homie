<script lang="ts">
    import { dashboard } from "../../state/dashboard.svelte";
    import type { WallpaperPreset } from "../../types";

    interface MeshPalette {
        bg: string;
        deep: string;
        mid: string;
        near: string;
    }

    const WALLPAPER_MESHES: Record<WallpaperPreset, MeshPalette> = {
        cupertino: {
            bg: "#06070c",
            deep: "radial-gradient(circle at center, rgba(10, 132, 255, 0.44) 0%, rgba(94, 92, 230, 0.24) 44%, transparent 72%)",
            mid: "radial-gradient(circle at center, rgba(191, 90, 242, 0.35) 0%, rgba(94, 92, 230, 0.2) 46%, transparent 72%)",
            near: "radial-gradient(circle at center, rgba(100, 210, 255, 0.34) 0%, rgba(10, 132, 255, 0.18) 48%, transparent 74%)",
        },
        aurora: {
            bg: "#05090b",
            deep: "radial-gradient(circle at center, rgba(48, 209, 88, 0.36) 0%, rgba(15, 118, 110, 0.24) 45%, transparent 72%)",
            mid: "radial-gradient(circle at center, rgba(94, 92, 230, 0.38) 0%, rgba(10, 132, 255, 0.2) 46%, transparent 72%)",
            near: "radial-gradient(circle at center, rgba(100, 210, 255, 0.34) 0%, rgba(48, 209, 88, 0.16) 48%, transparent 74%)",
        },
        solar: {
            bg: "#0a0607",
            deep: "radial-gradient(circle at center, rgba(255, 159, 10, 0.38) 0%, rgba(255, 69, 58, 0.22) 44%, transparent 72%)",
            mid: "radial-gradient(circle at center, rgba(191, 90, 242, 0.32) 0%, rgba(153, 27, 27, 0.22) 46%, transparent 72%)",
            near: "radial-gradient(circle at center, rgba(255, 69, 58, 0.3) 0%, rgba(255, 159, 10, 0.16) 48%, transparent 74%)",
        },
        titanium: {
            bg: "#08090c",
            deep: "radial-gradient(circle at center, rgba(148, 163, 184, 0.28) 0%, rgba(71, 85, 105, 0.18) 45%, transparent 72%)",
            mid: "radial-gradient(circle at center, rgba(100, 116, 139, 0.26) 0%, rgba(30, 41, 59, 0.2) 46%, transparent 72%)",
            near: "radial-gradient(circle at center, rgba(203, 213, 225, 0.22) 0%, rgba(71, 85, 105, 0.14) 48%, transparent 74%)",
        },
    };

    let activePalette = $derived(
        WALLPAPER_MESHES[dashboard.wallpaperPreset] ??
            WALLPAPER_MESHES.cupertino,
    );

    let parallaxMultiplier = $derived(dashboard.reducedParallax ? 0 : 1);
    let deepLayerOffset = $derived(
        -dashboard.pagePosition * 18 * parallaxMultiplier,
    );
    let midLayerOffset = $derived(
        -dashboard.pagePosition * 34 * parallaxMultiplier,
    );
    let nearLayerOffset = $derived(
        -dashboard.pagePosition * 52 * parallaxMultiplier,
    );
</script>

<!-- Zero-Runtime-Cost Global SVG G2 Continuous-Curvature Squircle Definitions -->
<svg
    aria-hidden="true"
    width="0"
    height="0"
    class="fixed pointer-events-none opacity-0"
>
    <defs>
        <!-- Apple G2 Continuous Curvature Superellipse (0..1 objectBoundingBox) -->
        <clipPath id="ios-g2-squircle" clipPathUnits="objectBoundingBox">
            <path
                d="M 0.5,0 C 0.82,0 0.89,0 0.945,0.055 C 1,0.11 1,0.18 1,0.5 C 1,0.82 1,0.89 0.945,0.945 C 0.89,1 0.82,1 0.5,1 C 0.18,1 0.11,1 0.055,0.945 C 0,0.89 0,0.82 0,0.5 C 0,0.18 0,0.11 0.055,0.055 C 0.11,0 0.18,0 0.5,0 Z"
            />
        </clipPath>

        <!-- Directional Specular Rim Gradient for G2 App Squircles -->
        <linearGradient id="ios-g2-rim" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="rgba(255,255,255,0.42)" />
            <stop offset="45%" stop-color="rgba(255,255,255,0.08)" />
            <stop offset="100%" stop-color="rgba(255,255,255,0.18)" />
        </linearGradient>
    </defs>
</svg>

<div
    aria-hidden="true"
    style="background-color: {activePalette.bg};"
    class="fixed inset-0 -z-10 pointer-events-none overflow-hidden select-none transform-gpu translate-z-0 transition-colors duration-700"
>
    <!-- Deep Plane -->
    <div
        class="absolute -top-[22%] -left-[12%] w-[82vw] h-[78vh] rounded-full opacity-55 will-change-transform transition-[background] duration-700"
        style="transform: translate3d({deepLayerOffset}px, 0, 0); background: {activePalette.deep}; filter: blur(60px);"
    ></div>

    <!-- Mid Plane -->
    <div
        class="absolute top-[18%] -right-[15%] w-[74vw] h-[74vh] rounded-full opacity-45 will-change-transform transition-[background] duration-700"
        style="transform: translate3d({midLayerOffset}px, 0, 0); background: {activePalette.mid}; filter: blur(64px);"
    ></div>

    <!-- Foreground Horizon Plane (Refracts through the Global Dock) -->
    <div
        class="absolute -bottom-[24%] left-[18%] w-[70vw] h-[62vh] rounded-full opacity-40 will-change-transform transition-[background] duration-700"
        style="transform: translate3d({nearLayerOffset}px, 0, 0); background: {activePalette.near}; filter: blur(60px);"
    ></div>

    <!-- Subtle Vignette & Depth Overlay for Crisp White Icon Labels -->
    <div
        class="absolute inset-0"
        style="background: radial-gradient(circle at 50% 42%, rgba(7, 8, 13, 0.12) 0%, rgba(5, 6, 10, 0.58) 100%);"
    ></div>
</div>
