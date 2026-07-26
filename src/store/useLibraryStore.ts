import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SpotifyPlaylist, Target } from "@/types";
import { getMyPlaylists, LIKED_SOURCE_ID } from "@/api/spotify";
import { HOTKEYS, MAX_TARGETS } from "@/lib/hotkeys";

export interface Settings {
  autoAdvance: boolean;
  /** move = also remove from source after filing (destructive); copy = keep. */
  moveMode: boolean;
  previewAutoplay: boolean;
}

interface LibraryState {
  playlists: SpotifyPlaylist[];
  loadingPlaylists: boolean;
  sourceId: string | null;
  targets: Target[];
  settings: Settings;
  /** last position per source, so a reload resumes where you left off. */
  positions: Record<string, number>;

  loadPlaylists: () => Promise<void>;
  setSource: (id: string) => void;
  isTarget: (id: string) => boolean;
  toggleTarget: (pl: { id: string; name: string; imageUrl?: string }) => void;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  setPosition: (sourceId: string, index: number) => void;
}

function renumber(targets: Target[]): Target[] {
  return targets.map((t, i) => ({ ...t, key: HOTKEYS[i] ?? "" }));
}

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set, get) => ({
      playlists: [],
      loadingPlaylists: false,
      sourceId: null,
      targets: [],
      settings: { autoAdvance: false, moveMode: false, previewAutoplay: true },
      positions: {},

      loadPlaylists: async () => {
        set({ loadingPlaylists: true });
        try {
          const playlists = await getMyPlaylists();
          set({ playlists });
        } finally {
          set({ loadingPlaylists: false });
        }
      },

      setSource: (id) => set({ sourceId: id }),

      isTarget: (id) => get().targets.some((t) => t.id === id),

      toggleTarget: (pl) => {
        const targets = get().targets;
        const idx = targets.findIndex((t) => t.id === pl.id);
        if (idx >= 0) {
          set({ targets: renumber(targets.filter((t) => t.id !== pl.id)) });
        } else {
          if (targets.length >= MAX_TARGETS) return;
          set({
            targets: renumber([
              ...targets,
              { id: pl.id, name: pl.name, imageUrl: pl.imageUrl, key: "" },
            ]),
          });
        }
      },

      setSetting: (key, value) =>
        set({ settings: { ...get().settings, [key]: value } }),

      setPosition: (sourceId, index) =>
        set({ positions: { ...get().positions, [sourceId]: index } }),
    }),
    {
      name: "sw.library",
      version: 1,
      migrate: (persisted, version) => {
        const s = persisted as Partial<LibraryState> | undefined;
        // v0 defaulted auto-advance ON, which fights multi-filing — flip it off once.
        if (version < 1 && s?.settings) s.settings.autoAdvance = false;
        return s as LibraryState;
      },
      partialize: (s) => ({
        sourceId: s.sourceId,
        targets: s.targets,
        settings: s.settings,
        positions: s.positions,
      }),
    },
  ),
);

export { LIKED_SOURCE_ID };
