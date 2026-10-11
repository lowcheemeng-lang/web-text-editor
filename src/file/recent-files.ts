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
 *
 * Task 7 moved the database itself into `src/storage/idb.ts` — this store shares one
 * connection, one version and one upgrade path with the session and the preferences, so a
 * browser profile written by Task 4 upgrades in place instead of needing a second database.
 */
import { idbDelete, idbGetAll, idbPut } from "../storage/idb";

const STORE = "recent-files";

/** N++ lists ten; eight keeps the File menu a menu rather than a directory. */
export const RECENT_LIMIT = 8;

export interface RecentFile {
  readonly name: string;
  readonly handle: FileSystemFileHandle;
  readonly openedAt: number;
}

/** The most recently opened files, newest first. Empty when unavailable. */
export async function listRecent(): Promise<RecentFile[]> {
  const all = await idbGetAll<RecentFile>(STORE);
  return all
    .filter((entry) => entry && typeof entry.name === "string" && entry.handle)
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(0, RECENT_LIMIT);
}

/**
 * Remember a file, newest first, keyed by name so re-opening the same file moves
 * it up the list rather than duplicating it. Older entries beyond `RECENT_LIMIT`
 * are pruned afterwards.
 */
export async function rememberRecent(handle: FileSystemFileHandle): Promise<void> {
  try {
    const written = await idbPut(STORE, { name: handle.name, handle, openedAt: Date.now() });
    if (!written) return;

    const all = await idbGetAll<RecentFile>(STORE);
    const stale = all
      .sort((a, b) => b.openedAt - a.openedAt)
      .slice(RECENT_LIMIT)
      .map((entry) => entry.name);
    for (const name of stale) await idbDelete(STORE, name);
  } catch {
    // Deliberately silent: failing to remember a file must not interrupt the user.
  }
}

/** Drop one entry — used when its handle turns out to be dead. */
export async function forgetRecent(name: string): Promise<void> {
  await idbDelete(STORE, name);
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

/**
 * Whether a stored handle may be read *without* a user gesture — the question the session
 * restore has to ask, because a restore is not a click and the browser will not let a page
 * request permission outside one. `"prompt"` is therefore not a yes, and N++'s rule applies:
 * the file is inaccessible this time round (dropped, or offered as a placeholder).
 */
export async function hasAccessWithoutAsking(handle: FileSystemHandle): Promise<boolean> {
  const mode = { mode: "readwrite" } as const;
  try {
    return (await handle.queryPermission?.(mode)) === "granted";
  } catch {
    return false;
  }
}
