/**
 * Unsaved work that outlives the tab — Notepad++'s `backup/` directory, on OPFS (the
 * document-body half of decision D8).
 *
 * N++ writes the whole specification of this system into a comment above its implementation
 * (`Buffer.cpp:1231-1272`), and this module is that specification with a browser's storage
 * underneath. Quoting it, because every rule below is one of these lines:
 *
 *   For existing file (c:\tmp\foo.h)
 *     - Open: "load backup\FILENAME@CREATION_TIMESTAMP (backup\foo.h@198776) if exist,
 *       otherwise load FILENAME"; "if … is loaded, set it dirty"; "last modif timestamp of
 *       FILENAME … compare with tracked timestamp (in session.xml). in the case of unequal
 *       result, tell user the FILENAME was modified. ask user if he want to reload FILENAME".
 *     - Editing: "when a file starts being modified, a file will be created with name:
 *       FILENAME@CREATION_TIMESTAMP"; "sync: (every N seconds) the backup file will be saved if
 *       the buffer is dirty and modifications are present"; "each save file, or close file, the
 *       backup file will be deleted (if buffer is not dirty)"; "before switch off to another tab
 *       (or close files on exit), check 1 & 2".
 *   For untitled document (new 4)
 *     - Open: "open file UNTITLED_NAME@CREATION_TIMESTAMP (backup\new 4@198776)"; "set label as
 *       UNTITLED_NAME (new 4) and disk icon as red".
 *     - Editing: same sync rules; the backup is deleted when the document is saved or closed.
 *
 * The name is N++'s: the document's own name, `@`, and `wcsftime(…, "%Y-%m-%d_%H%M%S")`
 * (`Buffer.cpp:1312-1324`). The timestamp is fixed when the backup is *created* and reused on
 * every later write — N++ caches it in the buffer (`setBackupFileName`).
 *
 * Two differences, recorded rather than blurred:
 *
 *   - N++ writes untitled buffers to `fullpath.tmp` and then renames it over the target
 *     (`Buffer.cpp:1345`, `1379`). OPFS's `createWritable()` already is that: writes go to a
 *     temporary file and the file is only replaced when the stream is closed, so the port gets
 *     the atomicity without doing the dance by hand.
 *   - N++ stores the buffer's own bytes; this port's buffer is LF-normalised (risk R3), so a
 *     backup holds the editor's text and the document's real line endings come back from the
 *     session record.
 *
 * Failing to write a backup must never break editing: every function here fails soft, and the
 * caller says so rather than pretending.
 */
export const BACKUP_DIRECTORY = "backup";

/** `wcsftime(…, L"%Y-%m-%d_%H%M%S")` — local time, exactly as N++ names it. */
export function timestampForBackup(when: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return (
    `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}` +
    `_${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}`
  );
}

/** A document name is a base name in N++ and must stay one here: `/` would make a subdirectory. */
function leafName(name: string): string {
  return name.replace(/[\\/]+/g, "_").replace(/^\.+/, "_") || "untitled";
}

/** `backup/foo.h@2026-10-11_223401` — N++'s `backup\foo.h@198776`, with a readable stamp. */
export function backupFilePath(name: string, when: Date = new Date()): string {
  return `${BACKUP_DIRECTORY}/${leafName(name)}@${timestampForBackup(when)}`;
}

/** The file-name part of a backup path, or `null` when the path is not one. */
export function backupLeaf(path: string): string | null {
  if (!path.startsWith(`${BACKUP_DIRECTORY}/`)) return null;
  const leaf = path.slice(BACKUP_DIRECTORY.length + 1);
  return leaf.length > 0 && !leaf.includes("/") ? leaf : null;
}

/** True when this is a path this module can read back. */
export function isBackupPath(path: unknown): path is string {
  return typeof path === "string" && backupLeaf(path) !== null;
}

async function backupDirectory(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (typeof navigator === "undefined" || typeof navigator.storage?.getDirectory !== "function") {
      return null;
    }
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(BACKUP_DIRECTORY, { create });
  } catch {
    return null; // no OPFS, or the directory was removed under us
  }
}

/**
 * Write a document's body to `backup/`, reusing `path` when it already has one (N++ keeps the
 * file it created and rewrites it in place). Returns the path written, or `null` when nothing
 * was written — which the caller must treat as "this document is not protected yet".
 */
export async function writeBackup(
  name: string,
  text: string,
  options: { path?: string | null; when?: Date } = {},
): Promise<string | null> {
  const directory = await backupDirectory(true);
  if (!directory) return null;

  const path = isBackupPath(options.path)
    ? options.path
    : backupFilePath(name, options.when ?? new Date());
  const leaf = backupLeaf(path);
  if (!leaf) return null;

  try {
    const handle = await directory.getFileHandle(leaf, { create: true });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return path;
  } catch {
    return null;
  }
}

/** A backup's body, or `null` when it is gone (deleted, or storage was cleared). */
export async function readBackup(path: string): Promise<string | null> {
  const leaf = backupLeaf(path);
  if (!leaf) return null;
  const directory = await backupDirectory(false);
  if (!directory) return null;
  try {
    const handle = await directory.getFileHandle(leaf);
    const file = await handle.getFile();
    return await file.text();
  } catch {
    return null;
  }
}

/** N++ deletes the backup on a save and on closing a document (when it is not dirty). */
export async function deleteBackup(path: string): Promise<boolean> {
  const leaf = backupLeaf(path);
  if (!leaf) return false;
  const directory = await backupDirectory(false);
  if (!directory) return false;
  try {
    await directory.removeEntry(leaf);
    return true;
  } catch {
    return false; // already gone is a success in every sense that matters
  }
}

/** Every backup file currently in `backup/`, as full paths. */
export async function listBackups(): Promise<string[]> {
  const directory = await backupDirectory(false);
  if (!directory) return [];
  const names: string[] = [];
  try {
    // `values()` is the OPFS async iterator; older typings do not declare it (fs-access.d.ts).
    const entries = (directory as unknown as { values(): AsyncIterable<{ name: string }> }).values();
    for await (const entry of entries) names.push(entry.name);
  } catch {
    return names;
  }
  return names.map((name) => `${BACKUP_DIRECTORY}/${name}`).sort();
}

/** Delete the given backups, returning the paths that are gone. */
export async function deleteBackups(paths: readonly string[]): Promise<string[]> {
  const deleted: string[] = [];
  for (const path of paths) {
    if (await deleteBackup(path)) deleted.push(path);
  }
  return deleted;
}

/**
 * Delete every backup that no live document claims. Only safe at a quiet moment — after a
 * restore has adopted everything it is going to adopt — because a backup written but not yet
 * recorded in a session would otherwise look like an orphan.
 */
export async function pruneBackups(keep: readonly string[]): Promise<string[]> {
  const keepSet = new Set(keep.filter(isBackupPath));
  const orphans = (await listBackups()).filter((path) => !keepSet.has(path));
  return deleteBackups(orphans);
}

/** Remove the whole `backup/` directory — the acceptance check's clean slate. */
export async function clearBackups(): Promise<number> {
  const all = await listBackups();
  const deleted = await deleteBackups(all);
  return deleted.length;
}
