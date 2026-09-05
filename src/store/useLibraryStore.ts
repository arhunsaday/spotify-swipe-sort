import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SpotifyPlaylist, Target } from "@/types";
import { getMyPlaylists, LIKED_SOURCE_ID } from "@/api/spotify";
import { PLAYLISTS_TTL, readPlaylists, writePlaylists } from "@/lib/cache";
import { HOTKEYS, MAX_TARGETS, isAllowedKey } from "@/lib/hotkeys";

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
  /** play whole tracks through the Web Playback SDK instead of 30s previews. */
  fullTracks: boolean;
}

/** Queued (not-yet-applied) batch changes per target playlist. Persisted. */
export type PendingDelta = { add: string[]; remove: string[] };
export type Pending = Record<string, PendingDelta>;

interface LibraryState {
  playlists: SpotifyPlaylist[];
  loadingPlaylists: boolean;
  /** when the index last came off the network (0 = cache-only so far) */
  playlistsSyncedAt: number;
  sourceId: string | null;
  targets: Target[];
  settings: Settings;
  /** last position per source, so a reload resumes where you left off. */
  positions: Record<string, number>;
  /** batch queue: targetId -> {add, remove} trackIds, survives reloads. */
  pending: Pending;

  loadPlaylists: (force?: boolean) => Promise<void>;
  /** resolve once the index is present and reasonably fresh — lets the session
   *  loader reuse each playlist's snapshot_id instead of asking per target. */
  ensurePlaylists: () => Promise<void>;
  playlistById: (id: string) => SpotifyPlaylist | undefined;
  setSource: (id: string) => void;
  isTarget: (id: string) => boolean;
  toggleTarget: (pl: { id: string; name: string; imageUrl?: string }) => void;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  setPosition: (sourceId: string, index: number) => void;
  queueChange: (
    targetId: string,
    trackId: string,
    op: "add" | "remove",
  ) => void;
  clearPending: () => void;
  /** drop only the ids that were successfully applied — anything queued while
   *  the flush was in flight stays queued. */
  clearApplied: (applied: Pending) => void;
  /** set the full target order (drag-and-drop reorder); keys are preserved. */
  reorderTargets: (next: Target[]) => void;
  /** rebind a target to a specific key; swaps with whoever holds it. */
  setTargetKey: (id: string, key: string) => void;
}

function firstFreeKey(targets: Target[]): string {
  const used = new Set(targets.map((t) => t.key));
  return HOTKEYS.find((k) => !used.has(k)) ?? "";
}

/** Dedupes concurrent callers (App mount + setup dialog + session loader). */
let playlistsInFlight: Promise<void> | null = null;

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set, get) => ({
      playlists: [],
      loadingPlaylists: false,
      playlistsSyncedAt: 0,
      sourceId: null,
      targets: [],
      settings: {
        autoAdvance: false,
        moveMode: false,
        previewAutoplay: true,
        reverse: true,
        onlyUnfiled: false,
        batchMode: true,
        fullTracks: false,
      },
      positions: {},
      pending: {},

      loadPlaylists: (force = false) => {
        if (playlistsInFlight) return playlistsInFlight;
        playlistsInFlight = (async () => {
          set({ loadingPlaylists: true });
          try {
            // paint from cache first so the setup dialog opens instantly
            if (get().playlists.length === 0) {
              const cached = await readPlaylists();
              if (cached) set({ playlists: cached.data });
            }
            const fresh = Date.now() - get().playlistsSyncedAt < PLAYLISTS_TTL;
            if (!force && fresh && get().playlists.length > 0) return;
            const playlists = await getMyPlaylists();
            set({ playlists, playlistsSyncedAt: Date.now() });
            void writePlaylists(playlists);
          } finally {
            set({ loadingPlaylists: false });
            playlistsInFlight = null;
          }
        })();
        return playlistsInFlight;
      },

      ensurePlaylists: async () => {
        if (playlistsInFlight) return playlistsInFlight;
        const { playlists, playlistsSyncedAt } = get();
        if (
          playlists.length > 0 &&
          Date.now() - playlistsSyncedAt < PLAYLISTS_TTL
        )
          return;
        return get().loadPlaylists();
      },

      playlistById: (id) => get().playlists.find((p) => p.id === id),

      setSource: (id) => set({ sourceId: id }),

      isTarget: (id) => get().targets.some((t) => t.id === id),

      toggleTarget: (pl) => {
        const targets = get().targets;
        const idx = targets.findIndex((t) => t.id === pl.id);
        if (idx >= 0) {
          // untargeting: drop any queued changes for it too
          const pending = { ...get().pending };
          delete pending[pl.id];
          set({ targets: targets.filter((t) => t.id !== pl.id), pending });
        } else {
          if (targets.length >= MAX_TARGETS) return;
          set({
            targets: [
              ...targets,
              {
                id: pl.id,
                name: pl.name,
                imageUrl: pl.imageUrl,
                key: firstFreeKey(targets),
              },
            ],
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

      clearApplied: (applied) => {
        const pending = { ...get().pending };
        for (const [targetId, delta] of Object.entries(applied)) {
          const cur = pending[targetId];
          if (!cur) continue;
          const add = cur.add.filter((id) => !delta.add.includes(id));
          const remove = cur.remove.filter((id) => !delta.remove.includes(id));
          if (add.length === 0 && remove.length === 0) delete pending[targetId];
          else pending[targetId] = { add, remove };
        }
        set({ pending });
      },

      reorderTargets: (next) => set({ targets: next }),

      setTargetKey: (id, key) => {
        if (!isAllowedKey(key)) return;
        const targets = get().targets.map((t) => ({ ...t }));
        const target = targets.find((t) => t.id === id);
        if (!target) return;
        const other = targets.find((t) => t.key === key && t.id !== id);
        if (other) other.key = target.key; // swap so no two share a key
        target.key = key;
        set({ targets });
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
