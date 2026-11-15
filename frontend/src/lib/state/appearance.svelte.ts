import type { AppearancePreferences, WallpaperPreset } from "../types";
import { APPEARANCE_STORAGE_KEY } from "./constants";

export class AppearanceController {
  isControlCenterOpen = $state<boolean>(false);
  wallpaperPreset = $state<WallpaperPreset>("cupertino");
  showIconLabels = $state<boolean>(true);
  reducedParallax = $state<boolean>(false);

  constructor() {
    const appearanceRaw = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (appearanceRaw) {
      try {
        const prefs = JSON.parse(appearanceRaw) as Partial<AppearancePreferences>;
        if (prefs.wallpaper) this.wallpaperPreset = prefs.wallpaper;
        if (typeof prefs.showIconLabels === "boolean") {
          this.showIconLabels = prefs.showIconLabels;
        }
        if (typeof prefs.reducedParallax === "boolean") {
          this.reducedParallax = prefs.reducedParallax;
        }
      } catch {
        // Ignore invalid appearance cache
      }
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(
        APPEARANCE_STORAGE_KEY,
        JSON.stringify({
          wallpaper: this.wallpaperPreset,
          showIconLabels: this.showIconLabels,
          reducedParallax: this.reducedParallax,
        }),
      );
    } catch {
      // Ignore storage quota errors
    }
  }

  setWallpaperPreset(preset: WallpaperPreset): void {
    this.wallpaperPreset = preset;
    this.persist();
  }

  toggleIconLabels(): void {
    this.showIconLabels = !this.showIconLabels;
    this.persist();
  }

  toggleReducedParallax(): void {
    this.reducedParallax = !this.reducedParallax;
    this.persist();
  }
}
