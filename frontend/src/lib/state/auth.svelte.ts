import type { AuthSessionResponse, AuthUser } from "../types";
import {
  APPEARANCE_STORAGE_KEY,
  APP_USAGE_STORAGE_KEY,
  ETAG_KEY,
  STORAGE_KEY,
  WORKSPACE_STORAGE_KEY,
} from "./constants";

const AUTH_USER_ID_KEY = "homie_cached_user_id_v1";

export function clearBoardLocalCaches(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ETAG_KEY);
    localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    localStorage.removeItem(APP_USAGE_STORAGE_KEY);
    localStorage.removeItem(APPEARANCE_STORAGE_KEY);
    localStorage.removeItem(AUTH_USER_ID_KEY);
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(WORKSPACE_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export class AuthController {
  isLoading = $state<boolean>(true);
  isLoggingOut = $state<boolean>(false);
  oidcEnabled = $state<boolean>(false);
  authenticated = $state<boolean>(false);
  providerName = $state<string>("Authentik");
  user = $state<AuthUser | null>(null);
  authError = $state<string | null>(null);

  private onRevokedCallback: (() => void) | null = null;

  constructor() {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const err = params.get("auth_error");
      if (err) {
        this.authError = err;
        params.delete("auth_error");
        const cleanQuery = params.toString();
        const nextURL =
          window.location.pathname + (cleanQuery ? `?${cleanQuery}` : "") + window.location.hash;
        window.history.replaceState({}, "", nextURL);
      }
    }
  }

  setOnRevoked(cb: () => void): void {
    this.onRevokedCallback = cb;
  }

  async checkSession(): Promise<boolean> {
    this.isLoading = true;
    try {
      const res = await fetch("/api/v1/auth/session", { cache: "no-store" });
      if (!res.ok) {
        this.authenticated = false;
        this.user = null;
        return false;
      }
      const data = (await res.json()) as AuthSessionResponse;
      this.oidcEnabled = Boolean(data.oidcEnabled);
      this.providerName = data.providerName || "Authentik";
      this.authenticated = Boolean(data.authenticated);
      this.user = data.user ?? null;

      if (this.authenticated && this.user) {
        const prevUserId = localStorage.getItem(AUTH_USER_ID_KEY);
        if (prevUserId && prevUserId !== this.user.id) {
          clearBoardLocalCaches();
        }
        localStorage.setItem(AUTH_USER_ID_KEY, this.user.id);
      } else {
        clearBoardLocalCaches();
      }
      return this.authenticated;
    } catch {
      this.authenticated = false;
      this.user = null;
      return false;
    } finally {
      this.isLoading = false;
    }
  }

  login(): void {
    this.authError = null;
    const returnTo =
      typeof window !== "undefined" ? window.location.pathname + window.location.search : "/";
    window.location.assign(`/api/v1/auth/login?return_to=${encodeURIComponent(returnTo)}`);
  }

  async logout(): Promise<void> {
    if (this.isLoggingOut) return;
    this.isLoggingOut = true;
    try {
      const res = await fetch("/api/v1/auth/logout", { method: "POST" });
      clearBoardLocalCaches();
      this.authenticated = false;
      this.user = null;
      this.onRevokedCallback?.();

      if (res.ok) {
        const body = (await res.json()) as { logoutUrl?: string };
        if (body.logoutUrl) {
          window.location.assign(body.logoutUrl);
          return;
        }
      }
    } finally {
      this.isLoggingOut = false;
    }
  }

  handleSessionRevoked(): void {
    if (!this.oidcEnabled) return;
    clearBoardLocalCaches();
    this.authenticated = false;
    this.user = null;
    this.authError = "Your session ended. Please sign in again.";
    this.onRevokedCallback?.();
  }
}
