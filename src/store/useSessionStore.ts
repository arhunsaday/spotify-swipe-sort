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
import { useLibraryStore, type Pending } from "./useLibraryStore";

type Membership = Record<string, Set<string>>;

function cloneMembership(m: Membership): Membership {
  const out: Membership = {};
  for (const k of Object.keys(m)) out[k] = new Set(m[k]);
  return out;
}

const uriFor = (trackId: string) => `spotify:track:${trackId}`;

/** Pending changes = symmetric diff between base and current membership. */
export function pendingStats(
  base: Membership,
  cur: Membership,
  targets: { id: string }[],
): Stats {
  const perTarget: Record<string, number> = {};
  let filed = 0;
  for (const tg of targets) {
    const b = base[tg.id] ?? new Set<string>();
    const c = cur[tg.id] ?? new Set<string>();
    let n = 0;
    for (const id of c) if (!b.has(id)) n++;
    for (const id of b) if (!c.has(id)) n++;
    if (n) {
      perTarget[tg.id] = n;
      filed += n;
    }
  }
  return { filed, perTarget };
}

/** Net pending change count = symmetric diff between base and current membership. */
export function countPending(
  base: Membership,
  cur: Membership,
  targets: { id: string }[],
): number {
  return pendingStats(base, cur, targets).filed;
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
  /** a flush is in flight — blocks re-entry so nothing gets added twice */
  applying: boolean;

  current: () => SpotifyTrack | null;
  loadSource: (sourceId: string) => Promise<void>;
  refreshMembership: () => Promise<void>;
  /** flush queued adds/removes (batch mode) as batched requests */
  applyPending: () => Promise<void>;
  /** drop all queued (unapplied) changes, reverting to server state */
  discardPending: () => void;
  /** rebuild the deck from allTracks using current order/filter settings */
  applyView: () => void;
  next: () => void;
  prev: () => void;
  goTo: (index: number) => void;
  fileToTarget: (key: string) => Promise<void>;
  undoLast: () => void;

  /** `alsoBase` = the change is already live on Spotify, so it isn't pending. */
  _setMembership: (
    targetId: string,
    trackId: string,
    present: boolean,
    alsoBase?: boolean,
  ) => void;
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
  applying: false,

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
      // server truth becomes the batch baseline…
      const base = cloneMembership(membership);
      // …then re-apply any persisted queued changes on top (survives reloads)
      const perTarget: Record<string, number> = {};
      let filed = 0;
      for (const tg of lib.targets) {
        const p = lib.pending[tg.id];
        if (!p) continue;
        const s = new Set(membership[tg.id] ?? []);
        p.add.forEach((id) => s.add(id));
        p.remove.forEach((id) => s.delete(id));
        membership[tg.id] = s;
        const n = p.add.length + p.remove.length;
        if (n) {
          perTarget[tg.id] = n;
          filed += n;
        }
      }
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
        stats: { filed, perTarget },
        membership,
        baseMembership: base,
      });
    } catch (e) {
      set({ status: "error", error: msg(e) });
    }
  },

  applyPending: async () => {
    const lib = useLibraryStore.getState();
    // outside batch mode every change is already written through on file
    if (!lib.settings.batchMode) return;
    // re-entry would recompute the same diff (the baseline only moves once the
    // requests land) and add every queued track a second time
    if (get().applying) return;

    const base = get().baseMembership;
    const cur = get().membership;
    // one job per request: chunked up front so a mid-flight failure still lets
    // us commit exactly the chunks that landed
    const jobs: { playlistId: string; op: "add" | "remove"; ids: string[] }[] =
      [];
    for (const tg of lib.targets) {
      const b = base[tg.id] ?? new Set<string>();
      const c = cur[tg.id] ?? new Set<string>();
      const adds = [...c].filter((id) => !b.has(id));
      const removes = [...b].filter((id) => !c.has(id));
      for (const part of chunk(adds, 100))
        jobs.push({ playlistId: tg.id, op: "add", ids: part });
      for (const part of chunk(removes, 100))
        jobs.push({ playlistId: tg.id, op: "remove", ids: part });
    }
    if (jobs.length === 0) return;

    const done: Pending = {};
    let failure: unknown = null;
    set({ applying: true });
    try {
      await mapLimit(jobs, 2, async (job) => {
        const uris = job.ids.map(uriFor);
        try {
          if (job.op === "add") await addTracksToPlaylist(job.playlistId, uris);
          else await removeTracksFromPlaylist(job.playlistId, uris);
          const d = (done[job.playlistId] ??= { add: [], remove: [] });
          d[job.op].push(...job.ids);
        } catch (e) {
          failure ??= e;
        }
      });

      // advance the baseline by exactly what Spotify accepted — anything
      // queued while we were in flight stays pending
      const nextBase = cloneMembership(get().baseMembership);
      for (const [targetId, delta] of Object.entries(done)) {
        const s = new Set(nextBase[targetId] ?? []);
        delta.add.forEach((id) => s.add(id));
        delta.remove.forEach((id) => s.delete(id));
        nextBase[targetId] = s;
      }
      const targets = useLibraryStore.getState().targets;
      set({
        baseMembership: nextBase,
        stats: pendingStats(nextBase, get().membership, targets),
      });
      useLibraryStore.getState().clearApplied(done);

      const addCount = Object.values(done).reduce((n, d) => n + d.add.length, 0);
      const removeCount = Object.values(done).reduce(
        (n, d) => n + d.remove.length,
        0,
      );
      const parts = [
        addCount ? `${addCount} added` : "",
        removeCount ? `${removeCount} removed` : "",
      ].filter(Boolean);
      if (failure) {
        toast.error(
          `Apply failed: ${msg(failure)}${
            parts.length ? ` — ${parts.join(", ")} went through` : ""
          }, the rest stayed queued`,
        );
      } else {
        toast.success(`Applied — ${parts.join(", ")}`);
      }
    } catch (e) {
      toast.error(`Apply failed: ${msg(e)} — changes kept, try again`);
    } finally {
      set({ applying: false });
    }
  },

  discardPending: () => {
    const n = countPending(
      get().baseMembership,
      get().membership,
      useLibraryStore.getState().targets,
    );
    set({
      membership: cloneMembership(get().baseMembership),
      stats: { filed: 0, perTarget: {} },
    });
    useLibraryStore.getState().clearPending();
    get().applyView();
    if (n > 0) toast(`Discarded ${n} queued change${n === 1 ? "" : "s"}`);
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

    // BATCH MODE: toggle locally + persist the delta; applyPending() flushes.
    // Never auto-advances — the whole point is filing one track to many targets.
    if (lib.settings.batchMode) {
      const nowIn = !inTarget;
      get()._setMembership(target.id, t.id, nowIn);
      get()._bumpStat(target.id, nowIn ? +1 : -1);
      lib.queueChange(target.id, t.id, nowIn ? "add" : "remove");
      const undo = () => {
        get()._setMembership(target.id, t.id, inTarget);
        get()._bumpStat(target.id, inTarget ? +1 : -1);
        lib.queueChange(target.id, t.id, inTarget ? "add" : "remove");
        set({ index: prevIndex });
      };
      set({ lastUndo: undo });
      return;
    }

    if (inTarget) {
      get()._setMembership(target.id, t.id, false, true);
      get()._bumpStat(target.id, -1);
      const undo = () => void get()._reAddToTarget(target, t);
      set({ lastUndo: undo });
      toast(`Removed from ${target.name}`, {
        action: { label: "Undo", onClick: undo },
      });
      try {
        await removeTrackFromPlaylist(target.id, t.uri);
      } catch (e) {
        get()._setMembership(target.id, t.id, true, true);
        get()._bumpStat(target.id, +1);
        toast.error(`Couldn't remove: ${msg(e)}`);
      }
      return;
    }

    const doMove =
      lib.settings.moveMode && !!lib.sourceId && lib.sourceId !== target.id;
    get()._setMembership(target.id, t.id, true, true);
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
      get()._setMembership(target.id, t.id, false, true);
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

  _setMembership: (targetId, trackId, present, alsoBase = false) => {
    const membership = { ...get().membership };
    const s = new Set(membership[targetId] ?? []);
    if (present) s.add(trackId);
    else s.delete(trackId);
    membership[targetId] = s;
    if (!alsoBase) return set({ membership });
    const baseMembership = { ...get().baseMembership };
    const b = new Set(baseMembership[targetId] ?? []);
    if (present) b.add(trackId);
    else b.delete(trackId);
    baseMembership[targetId] = b;
    set({ membership, baseMembership });
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
    get()._setMembership(target.id, track.id, true, true);
    get()._bumpStat(target.id, +1);
    try {
      await addTrackToPlaylist(target.id, track.uri);
    } catch (e) {
      get()._setMembership(target.id, track.id, false, true);
      get()._bumpStat(target.id, -1);
      toast.error(`Undo failed: ${msg(e)}`);
    }
  },

  _undoAdd: async (target, track, prevIndex, moved) => {
    const lib = useLibraryStore.getState();
    get()._setMembership(target.id, track.id, false, true);
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
