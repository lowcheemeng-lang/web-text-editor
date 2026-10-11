/**
 * Whether the browser will keep what we stored — risk R6 in `docs/scope.md`, whose recorded
 * mitigation is exactly this call: "Auto-export reminder + `navigator.storage.persist()`
 * request + explicit backup action".
 *
 * A browser may evict an origin's storage (IndexedDB *and* OPFS) under storage pressure, and the
 * risk is real for *this* app in a way it is not for most: the session and the `backup/` bodies
 * are the only copy of unsaved work, because there is no disk behind them (D1).
 * `navigator.storage.persist()` asks the browser to exempt the origin from eviction; Chrome
 * answers without a prompt, using its own heuristics (engagement, installed-PWA status, …), so
 * the answer is reported rather than assumed — `inspect().persistence` carries it, and the
 * acceptance check reads it there.
 *
 * Only browsers that do not need the protection (or that refuse it) are affected; nothing here
 * gates editing, opening or saving.
 */

export interface PersistenceStatus {
  /** `navigator.storage.persist` exists — Chrome, Edge, Firefox; not Safari ≤ 15. */
  supported: boolean;
  /** The origin is exempt from eviction, now or from an earlier grant. */
  persisted: boolean;
  /** Bytes currently used by this origin, when the browser will say. */
  usage: number | null;
  /** The origin's quota, when the browser will say. */
  quota: number | null;
}

const UNKNOWN: PersistenceStatus = Object.freeze({
  supported: false,
  persisted: false,
  usage: null,
  quota: null,
});

function storageManager(): StorageManager | null {
  try {
    return typeof navigator === "undefined" ? null : (navigator.storage ?? null);
  } catch {
    return null;
  }
}

/** Ask for a persistent origin, then report the whole picture (including usage and quota). */
export async function requestPersistentStorage(): Promise<PersistenceStatus> {
  const storage = storageManager();
  if (!storage) return { ...UNKNOWN };

  const supported = typeof storage.persist === "function";
  let persisted = false;
  if (supported) {
    try {
      // `persisted()` first: a grant from an earlier visit is not re-asked for.
      persisted = (await storage.persisted()) || (await storage.persist());
    } catch {
      persisted = false;
    }
  }

  let usage: number | null = null;
  let quota: number | null = null;
  if (typeof storage.estimate === "function") {
    try {
      const estimate = await storage.estimate();
      usage = typeof estimate.usage === "number" ? estimate.usage : null;
      quota = typeof estimate.quota === "number" ? estimate.quota : null;
    } catch {
      usage = null;
      quota = null;
    }
  }

  return { supported, persisted, usage, quota };
}
