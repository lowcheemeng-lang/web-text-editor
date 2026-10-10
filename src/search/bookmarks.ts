/**
 * Bookmarks — N++'s Search ▸ Bookmark family (Task 5 step 3).
 *
 * Notepad++ keeps bookmarks as Scintilla markers on the document, draws them in a
 * margin of their own and lets a click in that margin toggle one:
 *
 *   Parameters.h:902      `bool _bookMarkMarginShow = true;`  — the margin is ON by default
 *   ScintillaEditView.cpp `SCI_SETMARGINMASKN(_SC_MARGE_SYMBOL, …)` + `SCI_MARKERSETALPHA(MARK_BOOKMARK, 70)`
 *   rgba_icons.h          `bookmark14` — a 14×14 blue dot (centre pixel #5f7bd7)
 *   Notepad_plus.h:555    `bookmarkToggle(lineno)` — add if absent, delete if present
 *   Notepad_plus.h:566    `bookmarkClearAll()` — `SCI_MARKERDELETEALL`
 *   Notepad_plus.cpp:5265 `bookmarkNext(forwardScan)` — scans out from the caret line and
 *                         **wraps around**; lands the caret at the start of the line (`SCI_GOTOLINE`)
 *
 * The web equivalent of a Scintilla marker is a `StateField<RangeSet<GutterMarker>>` — the
 * shape CodeMirror's own gutter example uses for breakpoints, and it is the right one here
 * for a reason worth stating: `RangeSet.map(changes)` moves the marks through every edit, so
 * a bookmark stays on its line when text is inserted above it, exactly as a Scintilla marker
 * does. A remembered *line number* could not do that.
 *
 * Because the field lives in a view's state and not in the document, every view of a document
 * has to be told about a change: the commands here take the *list of views* to apply to, and
 * `workspace.ts` passes `document.runtime.views` (`bookmarks.ts` never reaches for a view it
 * was not handed — the same rule that keeps `tabs.ts` free of DOM).
 */
import {
  Compartment,
  EditorSelection,
  RangeSet,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";

/** N++'s marker: `bookmark14`, a blue dot drawn with `SCI_MARKERSETALPHA 70`. */
class BookmarkMarker extends GutterMarker {
  override toDOM(): HTMLElement {
    const dot = document.createElement("div");
    dot.className = "npp-bookmark-dot";
    return dot;
  }
}

const bookmarkMarker = new BookmarkMarker();

/** Add or remove one bookmark, at a document position (a line start). */
export const toggleBookmarkEffect = StateEffect.define<number>();

/** Remove every bookmark (Search ▸ Clear All Bookmarks). */
export const clearBookmarksEffect = StateEffect.define<null>();

/** Replace the whole set — how a peer view or a freshly mounted clone is brought in line. */
export const setBookmarksEffect = StateEffect.define<readonly number[]>();

export const bookmarkField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(marks, transaction) {
    let next = marks.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(toggleBookmarkEffect)) {
        const at = effect.value;
        let present = false;
        next.between(at, at, () => {
          present = true;
          return false;
        });
        next = present
          ? next.update({ filter: (from) => from !== at })
          : next.update({ add: [bookmarkMarker.range(at)] });
      } else if (effect.is(clearBookmarksEffect)) {
        next = RangeSet.empty;
      } else if (effect.is(setBookmarksEffect)) {
        next = RangeSet.of(effect.value.map((pos) => bookmarkMarker.range(pos)));
      }
    }
    return next;
  },
});

/**
 * The bookmark margin. N++ makes it mouse-sensitive (`SCI_SETMARGINSENSITIVEN`), which is
 * what a click here reproduces; the click dispatches one `toggleBookmarkEffect` on the
 * clicked view and `workspace.ts` mirrors the result to the document's other views.
 */
export function bookmarkMargin(): Extension {
  return gutter({
    class: "cm-bookmarkGutter",
    markers: (view) => view.state.field(bookmarkField),
    initialSpacer: () => bookmarkMarker,
    domEventHandlers: {
      mousedown(view, line) {
        view.dispatch({ effects: toggleBookmarkEffect.of(line.from) });
        return true;
      },
    },
  });
}

/** View ▸ Bookmark Margin: the N++ preference, as a toggle. */
export const bookmarkMarginCompartment = new Compartment();

export function bookmarkMarginExtension(visible: boolean): Extension {
  return visible ? bookmarkMargin() : [];
}

/* ------------------------------------------------------------------ reading */

/** Every bookmark position in a state, ascending. */
export function bookmarkPositions(state: EditorState): number[] {
  const positions: number[] = [];
  const marks = state.field(bookmarkField, false);
  if (!marks) return positions;
  const iterator = marks.iter();
  while (iterator.value) {
    positions.push(iterator.from);
    iterator.next();
  }
  return positions;
}

/** The bookmarked line numbers (1-based), which is what N++'s margin marks. */
export function bookmarkedLines(state: EditorState): number[] {
  return bookmarkPositions(state).map((pos) => state.doc.lineAt(pos).number);
}

export function isLineBookmarked(state: EditorState, line: number): boolean {
  if (line < 1 || line > state.doc.lines) return false;
  const from = state.doc.line(line).from;
  let present = false;
  state.field(bookmarkField, false)?.between(from, from, () => {
    present = true;
    return false;
  });
  return present;
}

/* ----------------------------------------------------------------- commands */

/** Every view of one document gets the same effect, so both panes agree. */
function dispatchToAll(views: readonly EditorView[], effect: StateEffect<unknown>): void {
  for (const view of views) view.dispatch({ effects: effect });
}

/** Search ▸ Toggle Bookmark (N++ Ctrl+F2), on the caret's line. */
export function toggleBookmark(view: EditorView, views: readonly EditorView[] = [view]): boolean {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  dispatchToAll(views, toggleBookmarkEffect.of(line.from));
  return true;
}

/** Search ▸ Clear All Bookmarks. */
export function clearBookmarks(view: EditorView, views: readonly EditorView[] = [view]): void {
  dispatchToAll(views, clearBookmarksEffect.of(null));
}

/** Bring a view in line with a document's bookmarks — used for a clone and for a remount. */
export function copyBookmarks(from: EditorState, to: EditorView): void {
  const positions = bookmarkPositions(from);
  if (positions.length === 0) return;
  to.dispatch({ effects: setBookmarksEffect.of(positions) });
}

/** Mark every line in `lines` as bookmarked — the Mark tab's "Bookmark line" option. */
export function bookmarkLines(state: EditorState, lines: readonly number[]): number[] {
  const unique = new Set(lines);
  return [...unique]
    .map((line) => state.doc.line(Math.min(Math.max(line, 1), state.doc.lines)).from)
    .sort((a, b) => a - b);
}

/**
 * Search ▸ Next / Previous Bookmark (N++ F2 / Shift+F2).
 *
 * N++ scans outward from the caret's line and wraps around to the far end when it runs
 * out, then puts the caret at the start of the line (Notepad_plus.cpp:5265). Return the
 * line it landed on, or null when the document has no bookmarks at all.
 */
export function gotoBookmark(view: EditorView, forward: boolean): number | null {
  const lines = bookmarkedLines(view.state);
  if (lines.length === 0) return null;
  const from = view.state.doc.lineAt(view.state.selection.main.head).number;

  const found = forward
    ? (lines.find((line) => line > from) ?? lines[0])
    : ([...lines].reverse().find((line) => line < from) ?? lines[lines.length - 1]);
  if (found === undefined) return null;

  const target = view.state.doc.line(found);
  view.dispatch({
    selection: EditorSelection.cursor(target.from),
    effects: EditorView.scrollIntoView(target.from, { y: "center" }),
    scrollIntoView: true,
  });
  view.focus();
  return found;
}
