/**
 * One IndexedDB database for everything the app remembers — the metadata half of decision
 * D8 ("OPFS for document bodies, IndexedDB for metadata/preferences and handles"). Document
 * *bodies* deliberately do not live here: they belong to the N++ `backup/` analogue in
 * `backup-store.ts`, which is OPFS.
 *
 * Three stores, one version, one upgrade path:
 *
 *   recent-files    File ▸ Recent, keyed by name (Task 4)
 *   preferences     the `config.xml` GUIConfig analogue (Task 7)
 *   session         the `session.xml` analogue — one record, keyed "session" (Task 7)
 *   plugins         installed plugin records, keyed by plugin id (P2, D5)
 *   plugin-settings per-plugin key/value objects, keyed by plugin id (P2, D5)
 *
 * Two rules the whole layer keeps:
 *
 *   - **Fail soft.** Storage being unavailable (private-browsing modes, a blocked upgrade
 *     because another tab holds an older version open) must never break editing. Every
 *     function here resolves to `null` / an empty result rather than throwing, and callers
 *     say what is missing rather than pretending it worked.
 *   - **Upgrades are additive.** An existing profile sits at version 1 with `recent-files`
 *     only, so the upgrade handler creates whatever is missing instead of assuming a fresh
 *     database. Bumping `DB_VERSION` for a new store is the only migration mechanism this
 *     layer needs.
 */

export const DB_NAME = "notepadpp-web";

/** 1 → recent-files (Task 4) · 2 → preferences and session (Task 7) · 3 → plugins (P2). */
export const DB_VERSION = 3;

export type StoreName =
  | "recent-files"
  | "preferences"
  | "session"
  | "plugins"
  | "plugin-settings";

/** Resolve a request's result, for the callers that need the value before the commit. */
export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

let database: Promise<IDBDatabase | null> | null = null;

export function openDatabase(): Promise<IDBDatabase | null> {
  if (database) return database;

  database = new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null); // no IndexedDB: nothing is remembered, editing still works
      return;
    }
    let open: IDBOpenDBRequest;
    try {
      open = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("recent-files")) {
        db.createObjectStore("recent-files", { keyPath: "name" });
      }
      // preferences and session use out-of-line keys: there is exactly one of each.
      if (!db.objectStoreNames.contains("preferences")) db.createObjectStore("preferences");
      if (!db.objectStoreNames.contains("session")) db.createObjectStore("session");
      // P2 (D5): one record per plugin id, and one settings object per plugin id. Both
      // out-of-line so the store's key is the plugin id and nothing else.
      if (!db.objectStoreNames.contains("plugins")) db.createObjectStore("plugins");
      if (!db.objectStoreNames.contains("plugin-settings")) db.createObjectStore("plugin-settings");
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => resolve(null);
    // Another tab holds an older version open, so the upgrade cannot run yet. Give up
    // rather than hang: the app works, it just forgets.
    open.onblocked = () => resolve(null);
  });

  return database;
}

/**
 * Run one request inside a transaction and resolve with the request's value once the
 * transaction **commits** — a write that aborts (quota, a value that cannot be cloned) must
 * not read as success. `null` means "no storage, or it failed", never "stored nothing".
 */
export async function idbRun<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  run: (objectStore: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openDatabase();
  if (!db) return null;

  return new Promise<T | null>((resolve) => {
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction(store, mode);
    } catch {
      resolve(null);
      return;
    }

    let value: T | null = null;
    try {
      const pending = run(transaction.objectStore(store));
      pending.onsuccess = () => (value = pending.result);
    } catch {
      // A value IndexedDB refuses to clone (a function, a live object) throws here.
      try {
        transaction.abort();
      } catch {
        /* already aborting */
      }
      resolve(null);
      return;
    }

    transaction.oncomplete = () => resolve(value);
    transaction.onerror = () => resolve(null);
    transaction.onabort = () => resolve(null);
  });
}

export async function idbGet<T>(store: StoreName, key: IDBValidKey): Promise<T | null> {
  return idbRun<T>(store, "readonly", (objectStore) => objectStore.get(key));
}

export async function idbGetAll<T>(store: StoreName): Promise<T[]> {
  const all = await idbRun<T[]>(store, "readonly", (objectStore) => objectStore.getAll());
  return Array.isArray(all) ? all : [];
}

/** Write a value; `key` is only needed for a store without a `keyPath`. */
export async function idbPut(
  store: StoreName,
  value: unknown,
  key?: IDBValidKey,
): Promise<boolean> {
  const written = await idbRun<IDBValidKey>(
    store,
    "readwrite",
    (objectStore) => (key === undefined ? objectStore.put(value) : objectStore.put(value, key)),
  );
  return written !== null;
}

export async function idbDelete(store: StoreName, key: IDBValidKey): Promise<boolean> {
  const result = await idbRun<undefined>(store, "readwrite", (objectStore) =>
    objectStore.delete(key),
  );
  return result !== null;
}
