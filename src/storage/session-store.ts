/**
 * The session — the browser half of Notepad++'s `session.xml`.
 *
 * N++'s file is written by `NppParameters::writeSession` (`Parameters.cpp:4818`) and read by
 * `NppParameters::getSessionFromXmlTree` (`Parameters.cpp:3408`). Every field below is one of
 * its attributes or child elements, with the source noted — the port keeps N++'s *shape* so the
 * behaviour that depends on it (which tab was on top, where the caret was, which lines were
 * bookmarked, which folds were closed, whether the document was dirty) restores the way N++'s
 * does:
 *
 *   <Session activeView="0">
 *     <mainView activeIndex="0">
 *       <File filename="…" lang="…" encoding="…" firstVisibleLine="…" xOffset="…"
 *             startPos="…" endPos="…" selMode="…" wrapCount="…" userReadOnly="…"
 *             backupFilePath="…" originalFileLastModifTimestamp="…">
 *         <Mark line="12"/> <Fold line="34"/>
 *
 * Where this port's material forces a difference, it is recorded rather than blurred:
 *
 *   - `filename` is a *path* in N++ and a `FileSystemFileHandle` here. The handle is the
 *     capability, which is why the session can reopen a file at all (D8/D3) — and why a handle
 *     whose permission was not re-granted reads as "inaccessible" on restore, exactly like a
 *     file that has been deleted.
 *   - `encoding` is a codepage number in N++ and a WHATWG label here (D4).
 *   - `lang` is a language *name* in N++ ("C++ source file") and the registry id here, because
 *     ids are stable and the label is copy.
 *   - the sub view is always empty: S5's split shows the *active document* in both panes, so
 *     there is no second tab set to record. A session with a non-empty sub view is how a
 *     restored split is remembered.
 *   - the map/document-map attributes are not written: this port has no minimap (`S8`).
 *
 * Bodies are not here. They are N++'s `backup/` directory, implemented on OPFS in
 * `backup-store.ts` — see that file's header for the algorithm, quoted from N++.
 */
import type { DocumentFormat } from "../file/types.ts";

import { idbDelete, idbGet, idbPut } from "./idb.ts";

/** One record per origin, like the one `session.xml` per installation. */
export const SESSION_KEY = "session";

export interface SessionPosition {
  /** N++ `firstVisibleLine` — the top line of the viewport, 1-based. */
  firstVisibleLine: number;
  /** N++ `xOffset` — horizontal scroll in pixels; 0 while the document is wrapped. */
  xOffset: number;
}

export interface SessionSelection {
  /** N++ `startPos` — the anchor, as a document offset. */
  anchor: number;
  /** N++ `endPos` — the caret end. Equal to `anchor` when the selection is empty. */
  head: number;
  /** N++ `selMode`. */
  mode: "stream" | "column";
}

export interface SessionFile {
  /** Tab caption: the file's name, or N++'s `new N` label for a scratch buffer. */
  name: string;
  /** The file behind the tab — this port's `filename`. Absent for a scratch buffer. */
  handle?: FileSystemFileHandle;
  /** N++ `backupFilePath`: set exactly while a dirty document has a body in `backup/`. */
  backupPath?: string;
  /** N++ `originalFileLastModifTimestamp`: the file's mtime when it was last read or written. */
  originalFileLastModifTimestamp?: number;
  /** N++ `encoding`, plus the BOM and line endings the §6 round-trip rule needs back. */
  format: DocumentFormat;
  /** D4: the encoding was assumed, not identified — the status bar says so on restore too. */
  assumedEncoding: boolean;
  /** N++ `lang`. `null` is "Normal text file", not an error. */
  language: string | null;
  selection: SessionSelection;
  position: SessionPosition;
  /** N++ carries the document's wrap state in the session (`wrapCount`). */
  wordWrap: boolean;
  /** N++ `userReadOnly` — set for a placeholder for an inaccessible file. */
  readOnly: boolean;
  /** N++'s `<Mark line="…"/>` children: bookmarks by line, 1-based. */
  marks: number[];
  /** N++'s `<Fold line="…"/>` children: the lines whose fold starts were folded. */
  folds: number[];
  /** N++'s modified state — the "red" icon it restores a snapshot as. */
  dirty: boolean;
  /** True for N++'s `new N` buffers, which have no file of their own. */
  untitled: boolean;
}

export interface SessionView {
  /** N++ `activeIndex` — which tab of this view was in front. */
  activeIndex: number;
  files: SessionFile[];
}

export interface SessionRecord {
  /** N++ `Session activeView`: 0 = main, 1 = the second view. */
  activeView: 0 | 1;
  mainView: SessionView;
  /** See the header: non-empty only in the sense that a restored session may open a split. */
  subView: SessionView;
  /**
   * Not in N++'s file: when this record was written. Used by the acceptance check and by
   * nothing else — a session that was never written must not read as an empty one.
   */
  writtenAt: number;
}

/**
 * The part of a CodeMirror `Text` that position helpers need. Taking this instead of the `Text`
 * class itself is what lets the same code run in Node (`scripts/test-session.mjs`) and in the
 * browser (restore), rather than two implementations drifting apart.
 */
export interface LineSource {
  readonly lines: number;
  line(number: number): { readonly from: number };
  lineAt(position: number): { readonly number: number };
}

export function emptySession(now: number = Date.now()): SessionRecord {
  return {
    activeView: 0,
    mainView: { activeIndex: 0, files: [] },
    subView: { activeIndex: 0, files: [] },
    writtenAt: now,
  };
}

/* ------------------------------------------------------------------ positions */

/**
 * The document offset of a line's start, clamped into the document. Line numbers in the session
 * are 1-based (N++ counts lines from 1) and are clamped for the same reason N++ clamps: a file
 * that shrank while the app was closed must not send the caret off the end.
 */
export function lineStartOffset(source: LineSource, line: number): number {
  const wanted = Math.min(Math.max(1, Math.round(line)), Math.max(1, source.lines));
  return source.line(wanted).from;
}

/** The 1-based line number a document offset falls on, clamped into the document. */
export function offsetToLine(source: LineSource, offset: number): number {
  const clamped = Math.min(Math.max(0, Math.round(offset)), source.line(source.lines).from);
  return source.lineAt(clamped).number;
}

/** N++'s `<Mark line="…"/>` / `<Fold line="…"/>` children → document offsets. */
export function lineNumbersToOffsets(source: LineSource, lines: readonly number[]): number[] {
  return [...new Set(lines.filter((line) => Number.isFinite(line)).map((line) => lineStartOffset(source, line)))].sort(
    (left, right) => left - right,
  );
}

/** Document offsets → line numbers, for writing the session back out. */
export function offsetsToLineNumbers(source: LineSource, offsets: readonly number[]): number[] {
  return [
    ...new Set(
      offsets.filter((offset) => Number.isFinite(offset)).map((offset) => offsetToLine(source, offset)),
    ),
  ].sort((left, right) => left - right);
}

/**
 * The next N++ "new N" number: one past the highest number any restored scratch buffer uses.
 * N++ does the same thing from the buffer list (`nextUntitledNewNumber`), which is what stops a
 * restored `new 3` from colliding with the next document the user creates.
 */
export function nextUntitledNumber(names: readonly string[]): number {
  let highest = 0;
  for (const name of names) {
    const match = /^new\s+(\d+)$/.exec(name.trim());
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest + 1;
}

/* -------------------------------------------------------------- restore rules */

export type RestoreOutcome = "restore" | "placeholder" | "drop";

export interface RestoreInput {
  /** A scratch buffer (N++'s `new N`) — it has no file that could be inaccessible. */
  untitled: boolean;
  /** The file was read: the handle is there and permission was already granted. */
  accessible: boolean;
  /** A body for this document exists in `backup/`. */
  hasBackup: boolean;
  /** `Preferences.keepSessionAbsentFileEntries`. */
  keepAbsentFileEntries: boolean;
}

/**
 * N++'s restore decision, ported from `Notepad_plus::loadSession` (`NppIO.cpp:2538-2553`).
 *
 *   - a backup body wins over the file itself (`Buffer.cpp:1239`: "load
 *     backup\FILENAME@CREATION_TIMESTAMP if exist, otherwise load FILENAME") — a backup exists
 *     only for a document that was dirty, and it holds edits the file does not;
 *   - otherwise the file is opened normally;
 *   - a file that cannot be read (deleted, moved, or a permission the page may not re-ask for
 *     outside a click) is either dropped silently or kept as an empty, read-only placeholder,
 *     depending on `keepSessionAbsentFileEntries`. N++ asks once before making placeholders
 *     (`FileManager::newPlaceholderDocument`, `Buffer.cpp:1723-1749`); this port asks with the
 *     same wording at restore time.
 */
export function restoreOutcome(input: RestoreInput): RestoreOutcome {
  if (input.hasBackup) return "restore";
  if (input.accessible) return "restore";
  return !input.untitled && input.keepAbsentFileEntries ? "placeholder" : "drop";
}

/* ------------------------------------------------------------------- storage */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((entry): entry is number => Number.isFinite(entry)) : [];
}

function normaliseFile(raw: unknown): SessionFile | null {
  if (!isRecord(raw)) return null;
  const name = typeof raw.name === "string" ? raw.name : null;
  if (!name) return null;

  const format = isRecord(raw.format) ? raw.format : {};
  const selection = isRecord(raw.selection) ? raw.selection : {};
  const position = isRecord(raw.position) ? raw.position : {};

  return {
    name,
    // A handle is structured-cloneable but not inspectable, so its presence is all that is
    // checked — the restore path finds out whether it still points at anything.
    handle: (raw.handle as FileSystemFileHandle | undefined) ?? undefined,
    backupPath: typeof raw.backupPath === "string" ? raw.backupPath : undefined,
    originalFileLastModifTimestamp:
      typeof raw.originalFileLastModifTimestamp === "number"
        ? raw.originalFileLastModifTimestamp
        : undefined,
    format: {
      encoding: typeof format.encoding === "string" ? format.encoding : "utf-8",
      bom: (typeof format.bom === "string" ? format.bom : "none") as DocumentFormat["bom"],
      eol: (typeof format.eol === "string" ? format.eol : "LF") as DocumentFormat["eol"],
    },
    assumedEncoding: raw.assumedEncoding === true,
    language: typeof raw.language === "string" ? raw.language : null,
    selection: {
      anchor: Math.max(0, Math.round(finite(selection.anchor, 0))),
      head: Math.max(0, Math.round(finite(selection.head, 0))),
      mode: selection.mode === "column" ? "column" : "stream",
    },
    position: {
      firstVisibleLine: Math.max(1, Math.round(finite(position.firstVisibleLine, 1))),
      xOffset: Math.max(0, Math.round(finite(position.xOffset, 0))),
    },
    wordWrap: raw.wordWrap === true,
    readOnly: raw.readOnly === true,
    marks: numberArray(raw.marks),
    folds: numberArray(raw.folds),
    dirty: raw.dirty === true,
    untitled: raw.untitled === true,
  };
}

function normaliseView(raw: unknown): SessionView {
  if (!isRecord(raw)) return { activeIndex: 0, files: [] };
  const files = Array.isArray(raw.files)
    ? raw.files.map(normaliseFile).filter((file): file is SessionFile => file !== null)
    : [];
  const activeIndex = Math.min(Math.max(0, Math.round(finite(raw.activeIndex, 0))), Math.max(0, files.length - 1));
  return { activeIndex, files };
}

/**
 * Whatever came out of storage, made safe to restore from: unknown shapes are dropped, numbers
 * are clamped, and a record with nothing to restore reads as `null` so startup falls through to
 * the welcome document. Storage can be edited by hand and survives version changes, so this is
 * the boundary that decides what "a session" means.
 */
export function normaliseSession(raw: unknown): SessionRecord | null {
  if (!isRecord(raw)) return null;
  const mainView = normaliseView(raw.mainView);
  const subView = normaliseView(raw.subView);
  if (mainView.files.length === 0 && subView.files.length === 0) return null;

  return {
    activeView: raw.activeView === 1 ? 1 : 0,
    mainView,
    subView,
    writtenAt: Math.round(finite(raw.writtenAt, 0)),
  };
}

export async function loadSessionRecord(): Promise<SessionRecord | null> {
  return normaliseSession(await idbGet<unknown>("session", SESSION_KEY));
}

export async function saveSessionRecord(record: SessionRecord): Promise<boolean> {
  return idbPut("session", record, SESSION_KEY);
}

export async function clearSessionRecord(): Promise<boolean> {
  return idbDelete("session", SESSION_KEY);
}
