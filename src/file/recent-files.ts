/**
 * Recently opened files — the handle-storing half of decision D8.
 *
 * A `FileSystemFileHandle` is structured-cloneable, so IndexedDB can hold it
 * directly and the browser can re-grant access on a later visit. That is the
 * entire reason a backend-free editor can offer "Recent" at all: the handle *is*
 * the capability, and persisting it is what lets it outlive the tab.
 *
 * Two rules this module keeps to:
 *
 *   - **Recent files are a convenience, never a failure mode.** Every operation
 *     fails soft — if IndexedDB is unavailable (some private-browsing modes) the
 *     list is simply empty. Nothing here may break opening or saving a file.
 *   - **A stored handle is not a permission.** Restoring one says nothing about
 *     whether it may still be read; `queryPermission` decides, and it may answer
 *     "prompt", which is why reopening happens inside a click. Storing a handle
 *     grants no access by itself, so this is not a security boundary and does not
 *     pretend to be one.
 */
const DB_NAME = "notepadpp-web";
const DB_VERSION = 1;
const STORE = "recent-files";

/** N++ lists ten; eight keeps the File menu a menu rather than a directory. */
export const RECENT_LIMIT = 8;

export interface RecentFile {
  readonly name: string;
  readonly handle: FileSystemFileHandle;
  readonly openedAt: number;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

let database: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (database) return database;

  database = new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null); // no IndexedDB: Recent is simply unavailable
      return;
    }
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "name" });
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => resolve(null); // fail soft, never throw
  });

  return database;
}

/** The most recently opened files, newest first. Empty when unavailable. */
export async function listRecent(): Promise<RecentFile[]> {
  try {
    const db = await openDatabase();
    if (!db) return [];
    const store = db.transaction(STORE, "readonly").objectStore(STORE);
    const all = await request<RecentFile[]>(store.getAll());
    return all
      .filter((entry) => entry && typeof entry.name === "string" && entry.handle)
      .sort((a, b) => b.openedAt - a.openedAt)
      .slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

/**
 * Remember a file, newest first, keyed by name so re-opening the same file moves
 * it up the list rather than duplicating it. Older entries beyond `RECENT_LIMIT`
 * are pruned in the same transaction.
 */
export async function rememberRecent(handle: FileSystemFileHandle): Promise<void> {
  try {
    const db = await openDatabase();
    if (!db) return;
    const store = db.transaction(STORE, "readwrite").objectStore(STORE);
    await request(store.put({ name: handle.name, handle, openedAt: Date.now() }));

    const all = await request<RecentFile[]>(store.getAll());
    const stale = all
      .sort((a, b) => b.openedAt - a.openedAt)
      .slice(RECENT_LIMIT)
      .map((entry) => entry.name);
    for (const name of stale) store.delete(name);
  } catch {
    // Deliberately silent: failing to remember a file must not interrupt the user.
  }
}

/** Drop one entry — used when its handle turns out to be dead. */
export async function forgetRecent(name: string): Promise<void> {
  try {
    const db = await openDatabase();
    if (!db) return;
    await request(db.transaction(STORE, "readwrite").objectStore(STORE).delete(name));
  } catch {
    // ignore
  }
}

/**
 * Whether a restored handle can actually be used, asking for permission when the
 * browser says "prompt". Must be called from a user gesture for the prompt to be
 * allowed to appear; returns false rather than throwing when access is refused.
 */
export async function ensureAccess(handle: FileSystemHandle): Promise<boolean> {
  const mode = { mode: "readwrite" } as const;
  try {
    // Feature-detected: not every implementation has these (see fs-access.d.ts).
    const current = (await handle.queryPermission?.(mode)) ?? "granted";
    if (current === "granted") return true;
    const asked = (await handle.requestPermission?.(mode)) ?? "denied";
    return asked === "granted";
  } catch {
    return false;
  }
}
