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
import type { EditorState, Text } from "@codemirror/state";

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
  /** True when the text differs from `savedText`. */
  dirty: boolean;
  /**
   * N++ word wrap is per document/view; kept on the document so that both panes
   * showing it agree, and so Task 7 has an obvious place to persist it from.
   */
  wordWrap: boolean;
  /** Live views of this document (owner first) — see split-view.ts. */
  runtime: DocumentRuntime;
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
