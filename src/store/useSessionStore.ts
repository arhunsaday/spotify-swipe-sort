import { create } from "zustand";
import { toast } from "sonner";
import type { ListStamp, SpotifyTrack, Target } from "@/types";
import {
  addTracksToTarget,
  getSourceTracks,
  getStamp,
  getTargetTrackIds,
  isLikedId,
  LIKED_SOURCE_ID,
  removeTracksFromTarget,
  stampFromPlaylist,
  writeBatchSize,
} from "@/api/spotify";
import { QuotaError } from "@/api/client";
import {
  dropList,
  isTrusted,
  patchList,
  patchMembers,
  readList,
  readMembers,
  stampsMatch,
  writeList,
  writeMembers,
  type Entry,
} from "@/lib/cache";
import { chunk, mapLimit } from "@/lib/utils";
import { warmPreviews } from "@/lib/preview";
import { useLibraryStore, type Pending } from "./useLibraryStore";

type Membership = Record<string, Set<string>>;

function cloneMembership(m: Membership): Membership {
  const out: Membership = {};
  for (const k of Object.keys(m)) out[k] = new Set(m[k]);
  return out;
}

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
  /** a cached list is on screen while we check it against Spotify */
  syncing: boolean;
  /** paging progress for a list we're fetching for the first time */
  loaded: number;
  total: number;
  /** saved position we still owe the user — a big source resumes at 2400/3000
   *  only once that page has actually streamed in. Cleared on any manual move. */
  _wantIndex: number | null;

  current: () => SpotifyTrack | null;
  loadSource: (sourceId: string, opts?: { force?: boolean }) => Promise<void>;
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
function buildDeck(all: SpotifyTrack[], membership: Membership): SpotifyTrack[] {
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

/** Only one load generation is live at a time; everything else checks `alive`. */
let loadSeq = 0;
/** A source load in flight. `refreshMembership` waits on it so the two don't
 *  both fetch every target's contents on mount. */
let loadInFlight: Promise<void> | null = null;

/* Writes we've confirmed this session. A membership refetch that was already
 * in flight when the user filed a track would otherwise land as server truth
 * and silently undo the toggle on screen, so every fetched id set gets our own
 * writes replayed on top of it. */
const writeLog = new Map<string, { add: Set<string>; remove: Set<string> }>();

function noteWrite(targetId: string, op: "add" | "remove", ids: string[]) {
  const log = writeLog.get(targetId) ?? { add: new Set(), remove: new Set() };
  const [into, outof] = op === "add" ? [log.add, log.remove] : [log.remove, log.add];
  for (const id of ids) {
    into.add(id);
    outof.delete(id);
  }
  writeLog.set(targetId, log);
}

function replayWrites(targetId: string, ids: string[]): Set<string> {
  const s = new Set(ids);
  const log = writeLog.get(targetId);
  if (log) {
    log.add.forEach((id) => s.add(id));
    log.remove.forEach((id) => s.delete(id));
  }
  return s;
}

/** A playlist index fetched moments ago carries every playlist's snapshot_id,
 *  so validating N targets costs zero extra requests. Anything older than this
 *  we re-stamp per list instead of trusting. */
const INDEX_STAMP_MAX_AGE = 120_000;

async function stampFor(id: string): Promise<ListStamp> {
  if (!isLikedId(id)) {
    const lib = useLibraryStore.getState();
    await lib.ensurePlaylists().catch(() => {});
    const now = useLibraryStore.getState();
    const p = now.playlistById(id);
    if (p?.snapshot_id && Date.now() - now.playlistsSyncedAt < INDEX_STAMP_MAX_AGE)
      return stampFromPlaylist(p);
  }
  return getStamp(id);
}

export const useSessionStore = create<SessionState>()((set, get) => {
  /* ------------------------------------------------------------- helpers */

  const alive = (seq: number) => loadSeq === seq;

  const targetsNow = () => useLibraryStore.getState().targets;

  /** base (server truth) + the batch queue laid over it. */
  const overlayOne = (targetId: string, baseSet: Set<string>): Set<string> => {
    const p = useLibraryStore.getState().pending[targetId];
    const s = new Set(baseSet);
    if (p) {
      p.add.forEach((id) => s.add(id));
      p.remove.forEach((id) => s.delete(id));
    }
    return s;
  };

  const overlay = (base: Membership): Membership => {
    const out: Membership = {};
    for (const id of Object.keys(base)) out[id] = overlayOne(id, base[id]);
    return out;
  };

  /** In batch mode the counters *are* the queue, so they're derived. Outside
   *  batch mode they count what this session wrote, so leave them alone. */
  const recomputeStats = () => {
    if (!useLibraryStore.getState().settings.batchMode) return;
    set({
      stats: pendingStats(get().baseMembership, get().membership, targetsNow()),
    });
  };

  const clampIndex = (i: number, len: number) =>
    Math.max(0, Math.min(i, Math.max(0, len - 1)));

  /** Pick the index for a freshly built deck: honour a not-yet-reachable saved
   *  position first, otherwise stay on the track the user is looking at. */
  const resolveIndex = (deck: SpotifyTrack[]): number => {
    const want = get()._wantIndex;
    if (want != null) return clampIndex(want, deck.length);
    const keepId = get().tracks[get().index]?.id;
    if (keepId) {
      const found = deck.findIndex((t) => t.id === keepId);
      if (found >= 0) return found;
    }
    return clampIndex(get().index, deck.length);
  };

  const rebuild = (
    tracks: SpotifyTrack[],
    base: Membership,
    extra: Partial<SessionState> = {},
  ) => {
    const membership = overlay(base);
    const deck = buildDeck(tracks, membership);
    set({
      allTracks: tracks,
      tracks: deck,
      membership,
      baseMembership: base,
      index: resolveIndex(deck),
      ...extra,
    });
    recomputeStats();
    warmDeck();
  };

  /** Pull the preview cache for the window around the cursor into memory. */
  const warmDeck = () => {
    const { tracks, index } = get();
    if (tracks.length === 0) return;
    void warmPreviews(
      tracks.slice(Math.max(0, index - 1), index + 6).map((t) => t.id),
    );
  };

  /** Fold a freshly fetched target id set into base + membership. */
  const applyMembers = (targetId: string, ids: string[]) => {
    const merged = replayWrites(targetId, ids);
    set({
      baseMembership: { ...get().baseMembership, [targetId]: merged },
      membership: { ...get().membership, [targetId]: overlayOne(targetId, merged) },
    });
    recomputeStats();
    get().applyView();
  };

  /* --------------------------------------------------------------- sync */

  const syncSource = async (
    seq: number,
    sourceId: string,
    known: Entry<SpotifyTrack[]> | null,
    force: boolean,
    progressive: boolean,
  ) => {
    if (known && !force && isTrusted(known)) return;
    const stamp = await stampFor(sourceId);
    if (!alive(seq)) return;
    if (known && !force && stampsMatch(known.stamp, stamp)) return;

    const { tracks } = await getSourceTracks(sourceId, {
      alive: () => alive(seq),
      onProgress: (loaded, total) => {
        if (alive(seq)) set({ loaded, total });
      },
      onPage: progressive
        ? (soFar) => {
            if (!alive(seq)) return;
            rebuild(soFar.slice(), get().baseMembership, { status: "ready" });
          }
        : undefined,
    });
    if (!alive(seq)) return;
    // the full list is in hand, so a saved position past the last page is
    // finally reachable — honour it, then stop owing it
    rebuild(tracks, get().baseMembership, { status: "ready" });
    set({ _wantIndex: null });
    void writeList(sourceId, tracks, stamp);
  };

  const syncTargets = async (
    seq: number,
    targets: Target[],
    known: (Entry<string[]> | null)[],
    force: boolean,
  ) => {
    await mapLimit(targets, 3, async (tg, i) => {
      const have = known[i];
      if (have && !force && isTrusted(have)) return;
      try {
        const stamp = await stampFor(tg.id);
        if (!alive(seq)) return;
        if (have && !force && stampsMatch(have.stamp, stamp)) return;
        const ids = await getTargetTrackIds(tg.id, () => alive(seq));
        if (!alive(seq)) return;
        applyMembers(tg.id, ids);
        void writeMembers(tg.id, ids, stamp);
      } catch (e) {
        // a target we can't read shouldn't break the session — the toggle just
        // starts empty for it
        if (!have) applyMembers(tg.id, []);
        if (e instanceof QuotaError) throw e;
      }
    });
  };

  /* -------------------------------------------------------------- writes */

  /** Single funnel for every write: performs it, records it for in-flight
   *  refetches, and keeps the on-disk membership cache valid. */
  const writeTarget = async (
    targetId: string,
    op: "add" | "remove",
    trackIds: string[],
  ) => {
    const snapshot =
      op === "add"
        ? await addTracksToTarget(targetId, trackIds)
        : await removeTracksFromTarget(targetId, trackIds);
    noteWrite(targetId, op, trackIds);
    void patchMembers(
      targetId,
      op === "add" ? trackIds : [],
      op === "remove" ? trackIds : [],
      snapshot,
    );
  };

  /** The source can itself be one of the targets, in which case moving a track
   *  out of it has to show up on that target's row too. */
  const mirrorSourceAsTarget = (
    sourceId: string,
    trackId: string,
    present: boolean,
    snapshot: string | null,
  ) => {
    if (!useLibraryStore.getState().isTarget(sourceId)) return;
    noteWrite(sourceId, present ? "add" : "remove", [trackId]);
    get()._setMembership(sourceId, trackId, present, true);
    void patchMembers(
      sourceId,
      present ? [trackId] : [],
      present ? [] : [trackId],
      snapshot,
    );
  };

  /** Move mode: drop the track out of the source itself. */
  const removeFromSource = async (sourceId: string, trackId: string) => {
    const snapshot = await removeTracksFromTarget(sourceId, [trackId]);
    void patchList(sourceId, [trackId], snapshot);
    mirrorSourceAsTarget(sourceId, trackId, false, snapshot);
  };

  const restoreToSource = async (sourceId: string, trackId: string) => {
    await addTracksToTarget(sourceId, [trackId]);
    // a re-add lands at the end of a playlist, so the cached order is wrong —
    // cheaper to drop the entry than to guess where it went
    void dropList(sourceId);
    mirrorSourceAsTarget(sourceId, trackId, true, null);
  };

  /* ---------------------------------------------------------- load flow */

  const doLoadSource = async (
    sourceId: string,
    opts: { force?: boolean } = {},
  ) => {
    const seq = ++loadSeq;
    const force = !!opts.force;
    writeLog.clear();
    const lib = useLibraryStore.getState();
    const targets = lib.targets;

    set({
      status: "loading",
      error: null,
      allTracks: [],
      tracks: [],
      index: 0,
      membership: {},
      baseMembership: {},
      stats: { filed: 0, perTarget: {} },
      lastUndo: null,
      syncing: false,
      loaded: 0,
      total: 0,
      _wantIndex: lib.positions[sourceId] ?? 0,
    });

    try {
      // 1. paint whatever we already have — the common case is a full hit, so
      //    the deck is on screen before a single request goes out
      const [srcEntry, memberEntries] = await Promise.all([
        force ? null : readList(sourceId),
        Promise.all(targets.map((t) => (force ? null : readMembers(t.id)))),
      ]);
      if (!alive(seq)) return;

      const base: Membership = {};
      targets.forEach((t, i) => {
        base[t.id] = new Set(memberEntries[i]?.data ?? []);
      });

      if (srcEntry) {
        rebuild(srcEntry.data, base, { status: "ready" });
        set({ _wantIndex: null });
      } else {
        set({ baseMembership: base, membership: overlay(base) });
      }

      // 2. validate against Spotify; only what actually moved gets re-paged.
      //    Reverse order can't paint progressively — the deck would reshuffle
      //    under the cursor as pages land — so it waits for the full list.
      set({ syncing: true });
      const progressive = !srcEntry && !lib.settings.reverse;
      await Promise.all([
        syncSource(seq, sourceId, srcEntry, force, progressive),
        syncTargets(seq, targets, memberEntries, force),
      ]);
      if (!alive(seq)) return;
      set({ syncing: false, status: "ready", _wantIndex: null });
    } catch (e) {
      if (!alive(seq)) return;
      set({ syncing: false, _wantIndex: null });
      if (get().allTracks.length > 0) {
        // a cached copy is on screen — usable, just possibly behind
        set({ status: "ready" });
        toast.warning(`Couldn't refresh from Spotify: ${msg(e)}`, {
          description: "Showing the last cached copy.",
        });
      } else {
        set({ status: "error", error: msg(e) });
      }
    }
  };

  /* --------------------------------------------------------------- store */

  return {
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
    syncing: false,
    loaded: 0,
    total: 0,
    _wantIndex: null,

    current: () => get().tracks[get().index] ?? null,

    loadSource: (sourceId, opts = {}) => {
      const p = doLoadSource(sourceId, opts).finally(() => {
        if (loadInFlight === p) loadInFlight = null;
      });
      loadInFlight = p;
      return p;
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
        const size = writeBatchSize(tg.id);
        for (const part of chunk(adds, size))
          jobs.push({ playlistId: tg.id, op: "add", ids: part });
        for (const part of chunk(removes, size))
          jobs.push({ playlistId: tg.id, op: "remove", ids: part });
      }
      if (jobs.length === 0) return;

      const done: Pending = {};
      let failure: unknown = null;
      set({ applying: true });
      try {
        await mapLimit(jobs, 2, async (job) => {
          try {
            await writeTarget(job.playlistId, job.op, job.ids);
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
      const { allTracks, membership } = get();
      const deck = buildDeck(allTracks, membership);
      set({ tracks: deck, index: resolveIndex(deck) });
      warmDeck();
    },

    refreshMembership: async () => {
      // a source load already syncs every target it started with; racing it
      // here would fetch each one twice on mount
      if (loadInFlight) await loadInFlight;
      const lib = useLibraryStore.getState();
      const missing = lib.targets.filter((tg) => !get().membership[tg.id]);
      if (missing.length === 0) return;
      const seq = loadSeq;
      const entries = await Promise.all(missing.map((t) => readMembers(t.id)));
      if (!alive(seq)) return;
      missing.forEach((tg, i) => {
        applyMembers(tg.id, entries[i]?.data ?? []);
      });
      set({ syncing: true });
      try {
        await syncTargets(seq, missing, entries, false);
      } catch {
        /* handled per target */
      } finally {
        if (alive(seq)) set({ syncing: false });
      }
    },

    next: () => {
      const { index, tracks } = get();
      const ni = Math.min(index + 1, Math.max(0, tracks.length - 1));
      set({ index: ni, dir: 1, _wantIndex: null });
      persistPos(ni);
      warmDeck();
    },

    prev: () => {
      const ni = Math.max(get().index - 1, 0);
      set({ index: ni, dir: -1, _wantIndex: null });
      persistPos(ni);
      warmDeck();
    },

    goTo: (target) => {
      const { index, tracks } = get();
      if (tracks.length === 0) return;
      const ni = Math.max(0, Math.min(target, tracks.length - 1));
      set({ index: ni, dir: ni >= index ? 1 : -1, _wantIndex: null });
      persistPos(ni);
      warmDeck();
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
          await writeTarget(target.id, "remove", [t.id]);
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
        await writeTarget(target.id, "add", [t.id]);
        if (doMove && lib.sourceId) await removeFromSource(lib.sourceId, t.id);
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
      warmDeck();
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
        await writeTarget(target.id, "add", [track.id]);
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
        await writeTarget(target.id, "remove", [track.id]);
        if (moved && lib.sourceId) await restoreToSource(lib.sourceId, track.id);
      } catch (e) {
        toast.error(`Undo failed: ${msg(e)}`);
      }
    },
  };
});

export { LIKED_SOURCE_ID };
