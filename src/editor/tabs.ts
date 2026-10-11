/**
 * Multi-document state — the plan's Task 3 step 2: "one `EditorState` per document".
 *
 * A document outlives any single view: it can be shown in both panes at once (clone
 * to other view), it owns the undo history, and it carries the save-point snapshot the
 * dirty indicator is computed from.
 *
 * Two different notions of "the document's text" live here, and they are not
 * interchangeable:
 *
 *   - `state` is the live editor state. The workspace refreshes it from the owner
 *     view on every transaction, and it is what a tab switch remounts. It holds the
 *     undo history, so the history must survive a pane or tab being closed.
 *   - `savedText` is a *snapshot* taken at the last save point — deliberately a
 *     frozen copy, because the dirty flag is meaningless unless one side never
 *     moves. This is the only cached text in the file, and it is replaced, not
 *     mutated, when a save happens (Task 4).
 *
 * While a view is mounted, the owner view (`split-view.ts` → `ownerView`) is the
 * authority and `state` trails it by one transaction; the workspace never reads
 * text from anywhere else.
 */
import type { EditorState, Extension, Text } from "@codemirror/state";

import type { DocumentFormat } from "../file/types";
import type { LanguageDefinition } from "../languages/registry";
import type { SessionPosition, SessionSelection } from "../storage/session-store";
import type { DocumentRuntime } from "./split-view";

export interface OpenDocument {
  readonly id: string;
  /** Tab label. N++ names files "new 1", "new 2", … until they have a path. */
  name: string;
  /**
   * The live editor state — history, settings and text while no view is mounted.
   * Refreshed from the owner view on every transaction (see the file header).
   */
  state: EditorState;
  /** Document text at the last save point — the baseline for the dirty flag. */
  savedText: Text;
  /**
   * The file on disk, once this document has one. Absent for a scratch buffer, and
   * what tells Save to write in place versus Save As to ask for a destination.
   */
  handle?: FileSystemFileHandle;
  /**
   * Encoding, BOM and line ending the file was read with — the three things a save
   * must reproduce (`docs/scope.md` §6 round-trip rule). A scratch buffer carries
   * the defaults until it is given a file.
   */
  format: DocumentFormat;
  /**
   * True when nothing identified the encoding (no BOM, not valid UTF-8) so D4's
   * no-autodetection rule means we must say the encoding was assumed.
   */
  assumedEncoding?: boolean;
  /** True when the text differs from `savedText`. */
  dirty: boolean;
  /**
   * N++ word wrap is per document/view; kept on the document so that both panes
   * showing it agree, and so Task 7 has an obvious place to persist it from.
   */
  wordWrap: boolean;
  /**
   * The language this document was opened as, from the name and (when that failed) the
   * content — Task 6. `null` is N++'s "Normal text file", not an error.
   */
  language: LanguageDefinition | null;
  /**
   * Its loaded CodeMirror extension, once the lazy import has resolved. Absent while the
   * load is in flight, and what `languageCompartment` is reconfigured with.
   */
  languageExtension?: Extension;
  /** Live views of this document (owner first) — see split-view.ts. */
  runtime: DocumentRuntime;
  /**
   * Task 7 — where the caret and the viewport were, so a reload can put them back. Kept on the
   * document rather than read from a view because a document that is not mounted has no view,
   * and N++ records the position of every file in the session, shown or not.
   */
  position: SessionPosition;
  selection: SessionSelection;
  /**
   * Task 7 — the document's body in `backup/` while it is dirty, and the file's mtime when it was
   * last read or written. Both are N++ session fields (`backupFilePath`,
   * `originalFileLastModifTimestamp`); both exist only for a document that can lose work.
   */
  backupPath?: string;
  originalFileLastModifTimestamp?: number;
  /** Task 7 — N++'s `userReadOnly`: the editor refuses edits. Set for an inaccessible file. */
  readOnly: boolean;
  /** Task 7 — this tab stands in for a file that could not be opened, and is empty. */
  inaccessible?: boolean;
}

/** N++ calls the first unsaved buffer "new 1". */
export function newDocumentName(index: number): string {
  return `new ${index}`;
}

/**
 * Tab caption. N++ shows the modification state in its toolbar; a browser tab has
 * nowhere else to put it, so it goes in the label and the tooltip.
 */
export function tabLabel(document: OpenDocument): string {
  return `${document.dirty ? "*" : ""}${document.name}`;
}

/**
 * True when the document is back at its save point — an undo/redo can land there, and
 * N++ clears its modified marker when it does.
 *
 * The length guard matters: `Text.eq` walks the structure, so it is only worth paying
 * for when the lengths match (the only case where equality is possible).
 */
export function backAtSavePoint(current: Text, savedText: Text): boolean {
  return current.length === savedText.length && current.eq(savedText);
}
