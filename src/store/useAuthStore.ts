import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SpotifyUser, Tokens } from "@/types";
import {
  beginLogin,
  completeLoginFromRedirect,
  refreshTokens,
} from "@/auth/pkce";
import { getMe } from "@/api/spotify";
import { registerTokenProvider } from "@/api/client";
import { clearAllCaches } from "@/lib/cache";

type Status = "idle" | "loading" | "authed" | "error";

interface AuthState {
  tokens: Tokens | null;
  user: SpotifyUser | null;
  status: Status;
  error: string | null;
  init: () => Promise<void>;
  login: () => Promise<void>;
  logout: () => void;
  getValidAccessToken: () => Promise<string | null>;
}

let refreshInFlight: Promise<string | null> | null = null;

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      tokens: null,
      user: null,
      status: "idle",
      error: null,

      init: async () => {
        set({ status: "loading", error: null });
        try {
          const fromRedirect = await completeLoginFromRedirect();
          if (fromRedirect) set({ tokens: fromRedirect });
        } catch (e) {
          set({ status: "error", error: String(e) });
          return;
        }
        if (!get().tokens) {
          set({ status: "idle" });
          return;
        }
        try {
          const user = await getMe();
          set({ user, status: "authed" });
        } catch {
          get().logout();
        }
      },

      login: async () => {
        try {
          await beginLogin();
        } catch (e) {
          set({ status: "error", error: String(e) });
        }
      },

      logout: () => {
        // cached playlists belong to the account that just left
        void clearAllCaches();
        set({ tokens: null, user: null, status: "idle", error: null });
      },

      getValidAccessToken: async () => {
        const t = get().tokens;
        if (!t) return null;
        if (Date.now() < t.expires_at - 30_000) return t.access_token;
        if (!refreshInFlight) {
          refreshInFlight = (async () => {
            try {
              const next = await refreshTokens(t);
              set({ tokens: next });
              return next.access_token;
            } catch {
              get().logout();
              return null;
            } finally {
              refreshInFlight = null;
            }
          })();
        }
        return refreshInFlight;
      },
    }),
    {
      name: "sw.auth",
      partialize: (s) => ({ tokens: s.tokens }),
    },
  ),
);

// Wire the API client to the auth store (module load, before any request).
registerTokenProvider(() => useAuthStore.getState().getValidAccessToken());
