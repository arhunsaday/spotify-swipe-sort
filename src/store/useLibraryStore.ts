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
  /** iterate the source last-added → first instead of first → last. */
  reverse: boolean;
  /** only show source tracks that aren't in any target playlist yet. */
  onlyUnfiled: boolean;
  /** queue adds/removes locally and apply them in one batched request set. */
  batchMode: boolean;
}

/** Queued (not-yet-applied) batch changes per target playlist. Persisted. */
export type PendingDelta = { add: string[]; remove: string[] };
export type Pending = Record<string, PendingDelta>;

interface LibraryState {
  playlists: SpotifyPlaylist[];
  loadingPlaylists: boolean;
  sourceId: string | null;
  targets: Target[];
  settings: Settings;
  /** last position per source, so a reload resumes where you left off. */
  positions: Record<string, number>;
  /** batch queue: targetId -> {add, remove} trackIds, survives reloads. */
  pending: Pending;

  loadPlaylists: () => Promise<void>;
  setSource: (id: string) => void;
  isTarget: (id: string) => boolean;
  toggleTarget: (pl: { id: string; name: string; imageUrl?: string }) => void;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  setPosition: (sourceId: string, index: number) => void;
  queueChange: (targetId: string, trackId: string, op: "add" | "remove") => void;
  clearPending: () => void;
  /** move a target to a new index; keys are re-assigned by position. */
  reorderTarget: (id: string, toIndex: number) => void;
  /** rebind a target to a specific hotkey (moves it to that key's slot). */
  setTargetKey: (id: string, key: string) => void;
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
      settings: {
        autoAdvance: false,
        moveMode: false,
        previewAutoplay: true,
        reverse: false,
        onlyUnfiled: false,
        batchMode: false,
      },
      positions: {},
      pending: {},

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
          // untargeting: drop any queued changes for it too
          const pending = { ...get().pending };
          delete pending[pl.id];
          set({
            targets: renumber(targets.filter((t) => t.id !== pl.id)),
            pending,
          });
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

      queueChange: (targetId, trackId, op) => {
        const pending = { ...get().pending };
        const cur = pending[targetId] ?? { add: [], remove: [] };
        let add = cur.add.filter((id) => id !== trackId);
        let remove = cur.remove.filter((id) => id !== trackId);
        // an add cancels a queued remove and vice-versa; otherwise it's queued
        if (op === "add") {
          if (!cur.remove.includes(trackId)) add = [...add, trackId];
        } else {
          if (!cur.add.includes(trackId)) remove = [...remove, trackId];
        }
        if (add.length === 0 && remove.length === 0) delete pending[targetId];
        else pending[targetId] = { add, remove };
        set({ pending });
      },

      clearPending: () => set({ pending: {} }),

      reorderTarget: (id, toIndex) => {
        const targets = [...get().targets];
        const from = targets.findIndex((t) => t.id === id);
        if (from < 0) return;
        const to = Math.max(0, Math.min(toIndex, targets.length - 1));
        if (to === from) return;
        const [item] = targets.splice(from, 1);
        targets.splice(to, 0, item);
        set({ targets: renumber(targets) });
      },

      setTargetKey: (id, key) => {
        const i = (HOTKEYS as readonly string[]).indexOf(key);
        if (i < 0) return;
        get().reorderTarget(id, i);
      },
    }),
    {
      name: "sw.library",
      version: 2,
      migrate: (persisted, version) => {
        const s = persisted as Partial<LibraryState> | undefined;
        // auto-advance historically defaulted ON, which fights multi-filing.
        if (version < 2 && s?.settings) s.settings.autoAdvance = false;
        return s as LibraryState;
      },
      partialize: (s) => ({
        sourceId: s.sourceId,
        targets: s.targets,
        settings: s.settings,
        positions: s.positions,
        pending: s.pending,
      }),
    },
  ),
);

export { LIKED_SOURCE_ID };
