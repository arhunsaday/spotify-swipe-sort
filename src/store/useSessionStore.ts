import { create } from "zustand";
import { toast } from "sonner";
import type { SpotifyTrack, Target } from "@/types";
import {
  addTrackToPlaylist,
  getLikedTracks,
  getPlaylistTrackIds,
  getPlaylistTracks,
  LIKED_SOURCE_ID,
  removeTrackFromLiked,
  removeTrackFromPlaylist,
  saveTrackToLiked,
} from "@/api/spotify";
import { QuotaError } from "@/api/client";
import { useLibraryStore } from "./useLibraryStore";

type Status = "idle" | "loading" | "ready" | "error";

interface Stats {
  filed: number;
  perTarget: Record<string, number>;
}

interface SessionState {
  status: Status;
  error: string | null;
  tracks: SpotifyTrack[];
  index: number;
  membership: Record<string, Set<string>>;
  stats: Stats;
  dir: 1 | -1;
  lastUndo: (() => void) | null;

  current: () => SpotifyTrack | null;
  loadSource: (sourceId: string) => Promise<void>;
  refreshMembership: () => Promise<void>;
  next: () => void;
  prev: () => void;
  goTo: (index: number) => void;
  fileToTarget: (key: string) => Promise<void>;
  undoLast: () => void;

  _setMembership: (targetId: string, trackId: string, present: boolean) => void;
  _bumpStat: (targetId: string, delta: number) => void;
  _removeCurrentFromDeck: () => void;
  _reinsertToDeck: (track: SpotifyTrack, atIndex: number) => void;
  _reAddToTarget: (target: Target, track: SpotifyTrack) => Promise<void>;
  _undoAdd: (
    target: Target,
    track: SpotifyTrack,
    prevIndex: number,
    moved: boolean,
  ) => Promise<void>;
}

function msg(e: unknown): string {
  if (e instanceof QuotaError) return "quota exceeded — slow down";
  return e instanceof Error ? e.message : String(e);
}

function persistPos(index: number) {
  const lib = useLibraryStore.getState();
  if (lib.sourceId) lib.setPosition(lib.sourceId, index);
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  status: "idle",
  error: null,
  tracks: [],
  index: 0,
  membership: {},
  stats: { filed: 0, perTarget: {} },
  dir: 1,
  lastUndo: null,

  current: () => get().tracks[get().index] ?? null,

  loadSource: async (sourceId) => {
    set({ status: "loading", error: null, tracks: [], index: 0 });
    try {
      const tracks =
        sourceId === LIKED_SOURCE_ID
          ? await getLikedTracks()
          : await getPlaylistTracks(sourceId);
      const lib = useLibraryStore.getState();
      const pos = Math.min(
        lib.positions[sourceId] ?? 0,
        Math.max(0, tracks.length - 1),
      );
      set({
        tracks,
        index: Number.isFinite(pos) ? pos : 0,
        status: "ready",
        stats: { filed: 0, perTarget: {} },
        membership: {},
      });
      const membership: Record<string, Set<string>> = {};
      await Promise.all(
        lib.targets.map(async (tg) => {
          try {
            membership[tg.id] = await getPlaylistTrackIds(tg.id);
          } catch {
            membership[tg.id] = new Set();
          }
        }),
      );
      set({ membership });
    } catch (e) {
      set({ status: "error", error: msg(e) });
    }
  },

  refreshMembership: async () => {
    const lib = useLibraryStore.getState();
    const have = get().membership;
    const missing = lib.targets.filter((tg) => !have[tg.id]);
    if (missing.length === 0) return;
    const membership = { ...get().membership };
    await Promise.all(
      missing.map(async (tg) => {
        try {
          membership[tg.id] = await getPlaylistTrackIds(tg.id);
        } catch {
          membership[tg.id] = new Set();
        }
      }),
    );
    set({ membership });
  },

  next: () => {
    const { index, tracks } = get();
    const ni = Math.min(index + 1, Math.max(0, tracks.length - 1));
    set({ index: ni, dir: 1 });
    persistPos(ni);
  },

  prev: () => {
    const ni = Math.max(get().index - 1, 0);
    set({ index: ni, dir: -1 });
    persistPos(ni);
  },

  goTo: (target) => {
    const { index, tracks } = get();
    if (tracks.length === 0) return;
    const ni = Math.max(0, Math.min(target, tracks.length - 1));
    set({ index: ni, dir: ni >= index ? 1 : -1 });
    persistPos(ni);
  },

  fileToTarget: async (key) => {
    const t = get().current();
    if (!t) return;
    const lib = useLibraryStore.getState();
    const target = lib.targets.find((x) => x.key === key);
    if (!target) return;

    const set0 = get().membership[target.id] ?? new Set<string>();
    const inTarget = set0.has(t.id);
    const prevIndex = get().index;

    if (inTarget) {
      get()._setMembership(target.id, t.id, false);
      get()._bumpStat(target.id, -1);
      const undo = () => void get()._reAddToTarget(target, t);
      set({ lastUndo: undo });
      toast(`Removed from ${target.name}`, {
        action: { label: "Undo", onClick: undo },
      });
      try {
        await removeTrackFromPlaylist(target.id, t.uri);
      } catch (e) {
        get()._setMembership(target.id, t.id, true);
        get()._bumpStat(target.id, +1);
        toast.error(`Couldn't remove: ${msg(e)}`);
      }
      return;
    }

    const doMove =
      lib.settings.moveMode && !!lib.sourceId && lib.sourceId !== target.id;
    get()._setMembership(target.id, t.id, true);
    get()._bumpStat(target.id, +1);

    if (doMove) get()._removeCurrentFromDeck();
    else if (lib.settings.autoAdvance) get().next();

    const undo = () => void get()._undoAdd(target, t, prevIndex, doMove);
    set({ lastUndo: undo });
    toast.success(`Added to ${target.name}`, {
      description: doMove ? "moved out of source" : undefined,
      action: { label: "Undo", onClick: undo },
    });

    try {
      await addTrackToPlaylist(target.id, t.uri);
      if (doMove) {
        if (lib.sourceId === LIKED_SOURCE_ID) await removeTrackFromLiked(t.id);
        else if (lib.sourceId)
          await removeTrackFromPlaylist(lib.sourceId, t.uri);
      }
    } catch (e) {
      get()._setMembership(target.id, t.id, false);
      get()._bumpStat(target.id, -1);
      if (doMove) get()._reinsertToDeck(t, prevIndex);
      toast.error(`Couldn't add: ${msg(e)}`);
    }
  },

  undoLast: () => {
    const u = get().lastUndo;
    if (u) {
      u();
      set({ lastUndo: null });
    }
  },

  _setMembership: (targetId, trackId, present) => {
    const membership = { ...get().membership };
    const s = new Set(membership[targetId] ?? []);
    if (present) s.add(trackId);
    else s.delete(trackId);
    membership[targetId] = s;
    set({ membership });
  },

  _bumpStat: (targetId, delta) => {
    const stats = get().stats;
    const perTarget = { ...stats.perTarget };
    perTarget[targetId] = Math.max(0, (perTarget[targetId] ?? 0) + delta);
    set({ stats: { filed: Math.max(0, stats.filed + delta), perTarget } });
  },

  _removeCurrentFromDeck: () => {
    const { tracks, index } = get();
    const nextTracks = tracks.slice(0, index).concat(tracks.slice(index + 1));
    const ni = Math.min(index, Math.max(0, nextTracks.length - 1));
    set({ tracks: nextTracks, index: ni, dir: 1 });
    persistPos(ni);
  },

  _reinsertToDeck: (track, atIndex) => {
    const { tracks } = get();
    const clamped = Math.max(0, Math.min(atIndex, tracks.length));
    const nextTracks = [
      ...tracks.slice(0, clamped),
      track,
      ...tracks.slice(clamped),
    ];
    set({ tracks: nextTracks, index: clamped, dir: -1 });
  },

  _reAddToTarget: async (target, track) => {
    get()._setMembership(target.id, track.id, true);
    get()._bumpStat(target.id, +1);
    try {
      await addTrackToPlaylist(target.id, track.uri);
    } catch (e) {
      get()._setMembership(target.id, track.id, false);
      get()._bumpStat(target.id, -1);
      toast.error(`Undo failed: ${msg(e)}`);
    }
  },

  _undoAdd: async (target, track, prevIndex, moved) => {
    const lib = useLibraryStore.getState();
    get()._setMembership(target.id, track.id, false);
    get()._bumpStat(target.id, -1);
    if (moved) get()._reinsertToDeck(track, prevIndex);
    else set({ index: prevIndex });
    try {
      await removeTrackFromPlaylist(target.id, track.uri);
      if (moved) {
        if (lib.sourceId === LIKED_SOURCE_ID) await saveTrackToLiked(track.id);
        else if (lib.sourceId) await addTrackToPlaylist(lib.sourceId, track.uri);
      }
    } catch (e) {
      toast.error(`Undo failed: ${msg(e)}`);
    }
  },
}));
