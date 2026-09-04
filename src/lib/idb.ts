/* Minimal promise wrapper over IndexedDB.
 *
 * No dependency, and every call degrades to a no-op (resolving `null`) when
 * storage is unavailable — private windows, blocked site data, an upgrade
 * blocked by another tab. The app then simply runs without a cache instead of
 * throwing, so nothing here is ever on a critical path.
 *
 * localStorage is deliberately not used: a single 3k-track playlist is already
 * ~1.5 MB of JSON, which blows the ~5 MB origin quota after two playlists. */

const DB_NAME = "sw.cache";
const DB_VERSION = 1;

export type StoreName = "lists" | "members" | "previews" | "kv";
const STORES: StoreName[] = ["lists", "members", "previews", "kv"];

let dbp: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES)
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

function run<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest,
): Promise<T | null> {
  return open().then((db) => {
    if (!db) return null;
    return new Promise<T | null>((resolve) => {
      try {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve((req.result ?? null) as T | null);
        tx.onabort = () => resolve(null);
        tx.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  });
}

export const idbGet = <T>(store: StoreName, key: string) =>
  run<T>(store, "readonly", (s) => s.get(key));

export const idbSet = (store: StoreName, key: string, value: unknown) =>
  run(store, "readwrite", (s) => s.put(value, key));

export const idbDel = (store: StoreName, key: string) =>
  run(store, "readwrite", (s) => s.delete(key));

export const idbClear = (store: StoreName) =>
  run(store, "readwrite", (s) => s.clear());

/** Batched reads — one transaction for the whole set (used by the preview
 *  cache, which warms a window of upcoming tracks in one go). */
export async function idbGetMany<T>(
  store: StoreName,
  keys: string[],
): Promise<(T | null)[]> {
  const empty = keys.map(() => null);
  if (keys.length === 0) return empty;
  const db = await open();
  if (!db) return empty;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, "readonly");
      const os = tx.objectStore(store);
      const out: (T | null)[] = keys.map(() => null);
      keys.forEach((k, i) => {
        const r = os.get(k);
        r.onsuccess = () => {
          out[i] = (r.result ?? null) as T | null;
        };
      });
      tx.oncomplete = () => resolve(out);
      tx.onabort = () => resolve(out);
      tx.onerror = () => resolve(out);
    } catch {
      resolve(empty);
    }
  });
}

/** Batched writes — one transaction for many entries. */
export async function idbSetMany(
  store: StoreName,
  entries: [string, unknown][],
): Promise<void> {
  if (entries.length === 0) return;
  const db = await open();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, "readwrite");
      const os = tx.objectStore(store);
      for (const [k, v] of entries) os.put(v, k);
      tx.oncomplete = () => resolve();
      tx.onabort = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Wipe everything — on logout, so one browser profile can't leak another
 *  account's library. */
export async function idbClearAll(): Promise<void> {
  await Promise.all(STORES.map((s) => idbClear(s)));
}
