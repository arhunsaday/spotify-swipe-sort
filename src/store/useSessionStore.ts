import { create } from "zustand";
import { toast } from "sonner";
import type { SpotifyTrack, Target } from "@/types";
import {
  addTrackToPlaylist,
  addTracksToPlaylist,
  getLikedTracks,
  getPlaylistTrackIds,
  getPlaylistTracks,
  LIKED_SOURCE_ID,
  removeTrackFromLiked,
  removeTrackFromPlaylist,
  removeTracksFromPlaylist,
  saveTrackToLiked,
} from "@/api/spotify";
import { QuotaError } from "@/api/client";
import { chunk, mapLimit } from "@/lib/utils";
import { useLibraryStore } from "./useLibraryStore";

type Membership = Record<string, Set<string>>;

function cloneMembership(m: Membership): Membership {
  const out: Membership = {};
  for (const k of Object.keys(m)) out[k] = new Set(m[k]);
  return out;
}

const uriFor = (trackId: string) => `spotify:track:${trackId}`;

/** Net pending change count = symmetric diff between base and current membership. */
export function countPending(
  base: Membership,
  cur: Membership,
  targets: { id: string }[],
): number {
  let n = 0;
  for (const tg of targets) {
    const b = base[tg.id] ?? new Set<string>();
    const c = cur[tg.id] ?? new Set<string>();
    for (const id of c) if (!b.has(id)) n++;
    for (const id of b) if (!c.has(id)) n++;
  }
  return n;
}

type Status = "idle" | "loading" | "ready" | "error";

interface Stats {
  filed: number;
  perTarget: Record<string, number>;
}

interface SessionState {
  status: Status;
  error: string | null;
  /** the full fetched source list, in original API order (before view transforms) */
  allTracks: SpotifyTrack[];
  /** the working deck = allTracks with order + filter applied */
  tracks: SpotifyTrack[];
  index: number;
  membership: Membership;
  /** target contents as they were at load / last apply — the batch baseline */
  baseMembership: Membership;
  stats: Stats;
  dir: 1 | -1;
  lastUndo: (() => void) | null;

  current: () => SpotifyTrack | null;
  loadSource: (sourceId: string) => Promise<void>;
  refreshMembership: () => Promise<void>;
  /** flush queued adds/removes (batch mode) as batched requests */
  applyPending: () => Promise<void>;
  /** rebuild the deck from allTracks using current order/filter settings */
  applyView: () => void;
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

/** Apply order + filter settings to the raw source list to produce the deck. */
function buildDeck(
  all: SpotifyTrack[],
  membership: Record<string, Set<string>>,
): SpotifyTrack[] {
  const lib = useLibraryStore.getState();
  let list = all.slice();
  if (lib.settings.onlyUnfiled) {
    list = list.filter(
      (t) => !lib.targets.some((tg) => membership[tg.id]?.has(t.id)),
    );
  }
  if (lib.settings.reverse) list.reverse();
  return list;
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  status: "idle",
  error: null,
  allTracks: [],
  tracks: [],
  index: 0,
  membership: {},
  baseMembership: {},
  stats: { filed: 0, perTarget: {} },
  dir: 1,
  lastUndo: null,

  current: () => get().tracks[get().index] ?? null,

  loadSource: async (sourceId) => {
    set({ status: "loading", error: null, allTracks: [], tracks: [], index: 0 });
    try {
      const fetched =
        sourceId === LIKED_SOURCE_ID
          ? await getLikedTracks()
          : await getPlaylistTracks(sourceId);
      const lib = useLibraryStore.getState();
      // prefetch target contents first so onlyUnfiled can filter on load.
      // bounded concurrency avoids a burst that trips the dev-mode quota.
      const membership: Membership = {};
      await mapLimit(lib.targets, 3, async (tg) => {
        try {
          membership[tg.id] = await getPlaylistTrackIds(tg.id);
        } catch {
          membership[tg.id] = new Set();
        }
      });
      const deck = buildDeck(fetched, membership);
      const pos = Math.max(
        0,
        Math.min(lib.positions[sourceId] ?? 0, deck.length - 1),
      );
      set({
        allTracks: fetched,
        tracks: deck,
        index: Number.isFinite(pos) ? pos : 0,
        status: "ready",
        stats: { filed: 0, perTarget: {} },
        membership,
        baseMembership: cloneMembership(membership),
      });
    } catch (e) {
      set({ status: "error", error: msg(e) });
    }
  },

  applyPending: async () => {
    const lib = useLibraryStore.getState();
    const base = get().baseMembership;
    const cur = get().membership;
    const jobs: { playlistId: string; op: "add" | "remove"; uris: string[] }[] =
      [];
    for (const tg of lib.targets) {
      const b = base[tg.id] ?? new Set<string>();
      const c = cur[tg.id] ?? new Set<string>();
      const adds = [...c].filter((id) => !b.has(id)).map(uriFor);
      const removes = [...b].filter((id) => !c.has(id)).map(uriFor);
      if (adds.length) jobs.push({ playlistId: tg.id, op: "add", uris: adds });
      if (removes.length)
        jobs.push({ playlistId: tg.id, op: "remove", uris: removes });
    }
    if (jobs.length === 0) return;

    const addCount = jobs
      .filter((j) => j.op === "add")
      .reduce((n, j) => n + j.uris.length, 0);
    const removeCount = jobs
      .filter((j) => j.op === "remove")
      .reduce((n, j) => n + j.uris.length, 0);

    try {
      await mapLimit(jobs, 2, async (job) => {
        for (const part of chunk(job.uris, 100)) {
          if (job.op === "add") await addTracksToPlaylist(job.playlistId, part);
          else await removeTracksFromPlaylist(job.playlistId, part);
        }
      });
      set({ baseMembership: cloneMembership(get().membership) });
      const parts = [
        addCount ? `${addCount} added` : "",
        removeCount ? `${removeCount} removed` : "",
      ].filter(Boolean);
      toast.success(`Applied — ${parts.join(", ")}`);
    } catch (e) {
      toast.error(`Apply failed: ${msg(e)} — changes kept, try again`);
    }
  },

  applyView: () => {
    const { allTracks, membership, tracks, index } = get();
    const currentId = tracks[index]?.id;
    const deck = buildDeck(allTracks, membership);
    let ni = 0;
    if (currentId) {
      const found = deck.findIndex((t) => t.id === currentId);
      ni = found >= 0 ? found : Math.min(index, Math.max(0, deck.length - 1));
    }
    set({ tracks: deck, index: Math.max(0, Math.min(ni, Math.max(0, deck.length - 1))) });
  },

  refreshMembership: async () => {
    const lib = useLibraryStore.getState();
    const have = get().membership;
    const missing = lib.targets.filter((tg) => !have[tg.id]);
    if (missing.length === 0) return;
    const membership = { ...get().membership };
    const base = { ...get().baseMembership };
    await mapLimit(missing, 3, async (tg) => {
      try {
        const s = await getPlaylistTrackIds(tg.id);
        membership[tg.id] = s;
        base[tg.id] = new Set(s); // newly-added target's existing contents aren't "pending"
      } catch {
        membership[tg.id] = new Set();
        base[tg.id] = new Set();
      }
    });
    set({ membership, baseMembership: base });
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

    // BATCH MODE: just toggle membership locally; applyPending() flushes later.
    if (lib.settings.batchMode) {
      const nowIn = !inTarget;
      get()._setMembership(target.id, t.id, nowIn);
      get()._bumpStat(target.id, nowIn ? +1 : -1);
      if (nowIn && lib.settings.autoAdvance) get().next();
      const undo = () => {
        get()._setMembership(target.id, t.id, inTarget);
        get()._bumpStat(target.id, inTarget ? +1 : -1);
        set({ index: prevIndex });
      };
      set({ lastUndo: undo });
      return;
    }

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
    const { tracks, index, allTracks } = get();
    const removed = tracks[index];
    const nextTracks = tracks.slice(0, index).concat(tracks.slice(index + 1));
    const ni = Math.min(index, Math.max(0, nextTracks.length - 1));
    const nextAll = removed
      ? allTracks.filter((t) => t.id !== removed.id)
      : allTracks;
    set({ tracks: nextTracks, allTracks: nextAll, index: ni, dir: 1 });
    persistPos(ni);
  },

  _reinsertToDeck: (track, atIndex) => {
    const { tracks, allTracks } = get();
    const clamped = Math.max(0, Math.min(atIndex, tracks.length));
    const nextTracks = [
      ...tracks.slice(0, clamped),
      track,
      ...tracks.slice(clamped),
    ];
    const nextAll = allTracks.some((t) => t.id === track.id)
      ? allTracks
      : [...allTracks, track];
    set({ tracks: nextTracks, allTracks: nextAll, index: clamped, dir: -1 });
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
