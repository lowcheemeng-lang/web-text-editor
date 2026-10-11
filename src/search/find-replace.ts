/**
 * Find / Replace / Mark / Go to — Notepad++'s Search dialog and Go To dialog (Task 5).
 *
 * Scope and division of labour (`docs/scope.md` tier 1: "Find / Replace: regex, match case,
 * whole word, wrap, replace-all | `@codemirror/search` `SearchQuery` + custom N++-style
 * dialog"): the *pattern* machinery is the library's — `SearchQuery` brings literal / regexp /
 * whole-word / case semantics and the cursor implementations — and the dialog, the commands and
 * the marks are ours, because CodeMirror's own search UI is a different thing:
 *
 *   - CM6's panel is a bar at the top or bottom of the editor; N++'s Find is a **floating
 *     dialog** that leaves the document focused. More decisively, the library's highlighting is
 *     tied to that panel: `searchHighlighter.highlight()` decorates nothing unless a panel
 *     instance exists in the state, and `findNext`/`replaceNext`/`selectMatches` all route
 *     through `searchCommand()`, which *opens the panel* when there is no valid query.
 *   - CM6's `nextMatch`/`prevMatch` always wrap around the document. N++ wraps only when "Wrap
 *     around" is checked (`FindHistory._isWrap = true` by default — Parameters.h:1169) and
 *     otherwise reports "Find: Can't find the text …".
 *
 * Sources for the dialog itself (Notepad++ master, fetched 2026-10-10 — the same standard Task 3
 * held itself to):
 *   PowerEditor/src/ScintillaComponent/FindReplaceDlg.rc      control labels, per-tab buttons
 *   PowerEditor/src/ScintillaComponent/FindReplaceDlg.cpp     option rules + status messages
 *   PowerEditor/src/Parameters.h  FindHistory                 defaults (lines 1164-1186)
 *   PowerEditor/src/localization/… english.xml                the status strings, quoted below
 *   PowerEditor/src/ScintillaComponent/GoToLineDlg.cpp        Go To behaviour
 *
 * Option rules copied from `FindReplaceDlg.cpp` (the `IDREGEXP`/`IDEXTENDED`/`IDNORMAL` handler):
 *   - regular-expression mode force-unchecks and **disables** "Match whole word only" (:2714);
 *   - ". matches newline" is enabled in regular-expression mode only;
 *   - "Backward direction" (and Find Previous) is disabled in regular-expression mode unless
 *     N++'s power-user setting is on (:2727) — the same rule is applied here.
 */
import { EditorSelection, StateEffect, StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { SearchQuery } from "@codemirror/search";

/* ------------------------------------------------------------------- options */

export type SearchMode = "normal" | "extended" | "regexp";

/** The dialog's options — one object, the shape N++'s `FindHistory` has. */
export interface SearchOptions {
  query: string;
  replace: string;
  matchCase: boolean;
  wholeWord: boolean;
  wrapAround: boolean;
  backwards: boolean;
  mode: SearchMode;
  dotMatchesNewline: boolean;
  inSelection: boolean;
}

/**
 * N++'s factory defaults: `Parameters.h` FindHistory (1164-1186) —
 * `_isMatchWord = false`, `_isMatchCase = false`, `_isWrap = true`,
 * `_isDirectionDown = true`, `_dotMatchesNewline = false`, `_searchMode = normal`.
 */
export const NPP_SEARCH_DEFAULTS: SearchOptions = {
  query: "",
  replace: "",
  matchCase: false,
  wholeWord: false,
  wrapAround: true,
  backwards: false,
  mode: "normal",
  dotMatchesNewline: false,
  inSelection: false,
};

/** Status lines, verbatim from N++'s english.xml (the `find-status-*` entries). */
export const SEARCH_STATUS = {
  cantFind: (text: string) => `Find: Can't find the text "${text}"`,
  /** Shown when the failure may be an option problem — N++'s own hint (find-status-…-pebkac-maybe). */
  cantFindHint:
    "The given occurrence cannot be found. You may have forgotten to check \"Wrap around\" " +
    "(to ON), \"Match case\" (to OFF), or \"Match whole word only\" (to OFF).",
  endReached: "Find: Reached document end, first occurrence from the top found.",
  topReached: "Find: Reached document beginning, first occurrence from the bottom found.",
  invalidRegexp: "Find: Invalid regular expression",
  countOne: "Count: 1 match",
  countMany: (n: number) => `Count: ${n} matches`,
  markOne: "Mark: 1 match",
  markMany: (n: number) => `Mark: ${n} matches`,
  replacedNext: "Replace: 1 occurrence was replaced. The next occurrence found.",
  replacedLast: "Replace: 1 occurrence was replaced. No more occurrences were found.",
  replaceNotFound: "Replace: no occurrence was found",
  replaceAllOne: "Replace All: 1 occurrence was replaced",
  replaceAllMany: (n: number) => `Replace All: ${n} occurrences were replaced`,
} as const;

/* ------------------------------------------------------------------- patterns */

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
}

/**
 * N++'s "Extended" search mode: `Searching::convertExtendedToString()` (FindReplaceDlg.cpp:131)
 * — `\r \n \0 \t \\`, plus `\b` (8 binary digits), `\o` (3 octal), `\d` (3 decimal), `\x`
 * (2 hex), `\u` (4 hex). An unknown sequence keeps its backslash, exactly as N++ does.
 *
 * The result is a *regular expression source* that matches the same literal text, because the
 * escapes decide which characters are matched — that is the whole point of the mode.
 */
export function extendedToPattern(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? "";
    if (ch !== "\\" || i + 1 >= text.length) {
      out += escapeRegExp(ch);
      continue;
    }
    const next = text[i + 1] ?? "";
    i += 1;
    switch (next) {
      case "r":
        out += "\\r";
        break;
      case "n":
        out += "\\n";
        break;
      case "t":
        out += "\\t";
        break;
      case "0":
        out += "\\x00";
        break;
      case "\\":
        out += "\\\\";
        break;
      case "b":
      case "o":
      case "d":
      case "x":
      case "u": {
        const size = next === "b" ? 8 : next === "o" ? 3 : next === "d" ? 3 : next === "x" ? 2 : 4;
        const base = next === "b" ? 2 : next === "o" ? 8 : next === "d" ? 10 : 16;
        const digits = text.slice(i + 1, i + 1 + size);
        const code = digits.length === size ? Number.parseInt(digits, base) : Number.NaN;
        if (Number.isNaN(code) || !/^[0-9a-f]+$/i.test(digits)) {
          out += escapeRegExp("\\" + next); // not enough/valid characters: N++ falls back to text
          break;
        }
        out += code < 0x100 ? `\\x${code.toString(16).padStart(2, "0")}` : `\\u${code.toString(16).padStart(4, "0")}`;
        i += size;
        break;
      }
      default:
        out += "\\" + escapeRegExp(next); // unknown escape: N++ keeps backslash + character
    }
  }
  return out;
}

/**
 * ". matches newline" (N++'s `IDREDOTMATCHNL`). `SearchQuery` cannot set RegExp flags, so the
 * dots are rewritten to `[\s\S]` instead — the same thing the flag means, and it leaves escaped
 * dots (`\.`) and dots inside character classes alone.
 */
export function dotMatchesNewline(pattern: string): string {
  let out = "";
  let inClass = false;
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === "\\") {
      out += ch + (pattern[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (inClass) {
      if (ch === "]") inClass = false;
      out += ch;
      continue;
    }
    if (ch === "[") {
      inClass = true;
      out += ch;
      continue;
    }
    out += ch === "." ? "[\\s\\S]" : ch;
  }
  return out;
}

export interface QueryResult {
  query: SearchQuery | null;
  /** Why there is no query — the dialog turns this into N++'s status message. */
  problem: "empty" | "invalid-regexp" | null;
}

export function buildQuery(options: SearchOptions): QueryResult {
  if (options.query === "") return { query: null, problem: "empty" };

  const regexp = options.mode !== "normal";
  let pattern = options.query;
  if (options.mode === "extended") pattern = extendedToPattern(options.query);
  if (regexp && options.dotMatchesNewline) pattern = dotMatchesNewline(pattern);

  const query = new SearchQuery({
    search: regexp ? pattern : options.query,
    caseSensitive: options.matchCase,
    literal: !regexp,
    regexp,
    // N++ disables whole-word matching in regular-expression mode (FindReplaceDlg.cpp:2714).
    wholeWord: options.wholeWord && options.mode !== "regexp",
    replace: options.replace,
  });
  return { query: query.valid ? query : null, problem: query.valid ? null : "invalid-regexp" };
}

/* -------------------------------------------------------------------- matches */

export interface SearchMatch {
  readonly from: number;
  readonly to: number;
}

export interface SearchScope {
  readonly from: number;
  readonly to: number;
}

/** The whole document, or the selection when N++'s "In selection" is checked. */
export function scopeFor(state: EditorState, options: SearchOptions): SearchScope {
  const selection = state.selection.main;
  if (options.inSelection && !selection.empty) return { from: selection.from, to: selection.to };
  return { from: 0, to: state.doc.length };
}

function firstIn(state: EditorState, query: SearchQuery, from: number, to: number): SearchMatch | null {
  if (to <= from) return null;
  const cursor = query.getCursor(state, from, to);
  const step = cursor.next();
  return step.done ? null : { from: step.value.from, to: step.value.to };
}

/**
 * The last match in [from, to). Walked forward rather than backwards because `SearchQuery`
 * offers no reverse cursor: the cost is linear in the matches before the caret, which is what
 * a "Find Previous" costs in a file with many occurrences either way.
 */
function lastIn(state: EditorState, query: SearchQuery, from: number, to: number): SearchMatch | null {
  if (to <= from) return null;
  let found: SearchMatch | null = null;
  const cursor = query.getCursor(state, from, to);
  for (let step = cursor.next(); !step.done; step = cursor.next()) {
    found = { from: step.value.from, to: step.value.to };
  }
  return found;
}

export interface FoundMatch {
  match: SearchMatch;
  /** True when the search had to wrap to find it — N++ says so in the status bar. */
  wrapped: boolean;
}

/**
 * N++'s Find Next / Find Previous from the current selection: search ahead of the selection
 * (`Searching::findNext`, FindReplaceDlg.cpp:3019) and, if "Wrap around" is on, search the
 * document again from the other end — which is N++'s own wording: "Reached document end, first
 * occurrence from the top found."
 */
export function findMatch(
  state: EditorState,
  query: SearchQuery,
  options: SearchOptions,
  scope: SearchScope = scopeFor(state, options),
): FoundMatch | null {
  const selection = state.selection.main;
  if (options.backwards) {
    const anchor = Math.max(scope.from, Math.min(selection.from, scope.to));
    const before = lastIn(state, query, scope.from, anchor);
    if (before) return { match: before, wrapped: false };
    if (!options.wrapAround) return null;
    const wrapped = lastIn(state, query, anchor, scope.to);
    return wrapped ? { match: wrapped, wrapped: true } : null;
  }
  const anchor = Math.max(scope.from, Math.min(selection.to, scope.to));
  const ahead = firstIn(state, query, anchor, scope.to);
  if (ahead) return { match: ahead, wrapped: false };
  if (!options.wrapAround) return null;
  const wrapped = firstIn(state, query, scope.from, anchor);
  return wrapped ? { match: wrapped, wrapped: true } : null;
}

/** Every match, ascending — `null` when the document holds more than `limit` of them. */
export function allMatches(
  state: EditorState,
  query: SearchQuery,
  scope: SearchScope,
  limit = 100_000,
): SearchMatch[] | null {
  const found: SearchMatch[] = [];
  const cursor = query.getCursor(state, scope.from, scope.to);
  for (let step = cursor.next(); !step.done; step = cursor.next()) {
    if (found.length >= limit) return null;
    found.push({ from: step.value.from, to: step.value.to });
  }
  return found;
}

/**
 * The replacement text for one match.
 *
 * Normal and Extended modes replace with the literal text (`\n` in the box means a newline in
 * Extended mode, as in N++). Regular-expression mode expands `$0`-`$99` back-references through
 * the same `String.replace` call CM6 uses, so the two engines agree on the expansion.
 */
export function replacementFor(query: SearchQuery, options: SearchOptions, matchedText: string): string {
  if (options.mode !== "regexp") {
    return options.mode === "extended" ? unescapeExtended(options.replace) : options.replace;
  }
  return matchedText.replace(new RegExp(query.search, "u"), options.replace);
}

/** The Extended mode escapes, applied to a *replacement* string (it has no pattern grammar). */
export function unescapeExtended(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? "";
    if (ch !== "\\" || i + 1 >= text.length) {
      out += ch;
      continue;
    }
    const next = text[i + 1] ?? "";
    i += 1;
    switch (next) {
      case "r":
        out += "\r";
        break;
      case "n":
        out += "\n";
        break;
      case "t":
        out += "\t";
        break;
      case "0":
        out += "\0";
        break;
      case "\\":
        out += "\\";
        break;
      case "b":
      case "o":
      case "d":
      case "x":
      case "u": {
        const size = next === "b" ? 8 : next === "o" ? 3 : next === "d" ? 3 : next === "x" ? 2 : 4;
        const base = next === "b" ? 2 : next === "o" ? 8 : next === "d" ? 10 : 16;
        const digits = text.slice(i + 1, i + 1 + size);
        const code = digits.length === size ? Number.parseInt(digits, base) : Number.NaN;
        if (Number.isNaN(code) || !/^[0-9a-f]+$/i.test(digits)) {
          out += "\\" + next;
          break;
        }
        out += String.fromCharCode(code);
        i += size;
        break;
      }
      default:
        out += "\\" + next;
    }
  }
  return out;
}

/* ---------------------------------------------------------------------- marks */

/** N++'s "Find Mark style" is Mark Style 1, `bgColor 00FFFF` (stylers.model.xml). */
const markDecoration = Decoration.mark({ class: "cm-searchMark" });

export const setMarksEffect = StateEffect.define<readonly SearchMatch[]>();
export const clearMarksEffect = StateEffect.define<null>();

/**
 * The marks N++'s Mark tab paints. A state field rather than a plugin because they must survive
 * edits the way Scintilla markers do: `DecorationSet.map(changes)` moves them with the text.
 */
export const markField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, transaction) {
    let next = marks.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setMarksEffect)) {
        next = Decoration.set(
          effect.value.map((match) => markDecoration.range(match.from, match.to)),
          true,
        );
      } else if (effect.is(clearMarksEffect)) {
        next = Decoration.none;
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** How many marks a view is painting. */
export function markCount(state: EditorState): number {
  return state.field(markField, false)?.size ?? 0;
}

/**
 * Where the marks are, as document positions — what the overview ruler (Task 6) draws ticks
 * from. A mark is a range, so its start is the tick: the ruler is a 1-pixel-per-thousand-lines
 * affair and the end position adds nothing.
 */
export function markPositions(state: EditorState): number[] {
  const positions: number[] = [];
  state.field(markField, false)?.between(0, state.doc.length, (from) => {
    positions.push(from);
  });
  return positions;
}

/** Bring a freshly mounted view of the same document in line with the marks already painted. */
export function copyMarks(from: EditorState, to: EditorView): void {
  const ranges: SearchMatch[] = [];
  from.field(markField, false)?.between(0, from.doc.length, (start, end) => {
    ranges.push({ from: start, to: end });
  });
  if (ranges.length > 0) to.dispatch({ effects: setMarksEffect.of(ranges) });
}

/** Every view of a document gets the same effect — both panes paint the same marks. */
function applyToViews(views: readonly EditorView[], effect: StateEffect<unknown>): void {
  for (const view of views) {
    view.dispatch({ effects: effect });
  }
}

export function clearMarks(views: readonly EditorView[]): void {
  applyToViews(views, clearMarksEffect.of(null));
}

/* ------------------------------------------------------------ replace / count */

export interface ReplaceOutcome {
  replaced: boolean;
  /** True when no further occurrence exists after the replacement (N++ says so verbatim). */
  moreMatches: boolean;
}

/**
 * N++'s "Replace": replace the *current* selection when it is a match of the query, otherwise
 * find and select the next occurrence (the behaviour CM6's `replaceNext` documents too — replace
 * is only ever destructive on text the user has already been shown).
 */
export function replaceCurrent(
  view: EditorView,
  query: SearchQuery,
  options: SearchOptions,
): ReplaceOutcome {
  const state = view.state;
  const scope = scopeFor(state, options);
  const selection = state.selection.main;
  if (!selectionIsMatch(state, query, options, scope)) {
    const found = findMatch(state, query, { ...options, backwards: false }, scope);
    if (!found) return { replaced: false, moreMatches: false };
    view.dispatch({
      selection: EditorSelection.single(found.match.from, found.match.to),
      effects: EditorView.scrollIntoView(found.match.from, { y: "center" }),
      scrollIntoView: true,
    });
    return { replaced: false, moreMatches: true };
  }

  const text = state.sliceDoc(selection.from, selection.to);
  const replacement = replacementFor(query, options, text);
  const delta = replacement.length - (selection.to - selection.from);
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: replacement },
    selection: EditorSelection.cursor(selection.from + replacement.length),
    userEvent: "input.replace",
  });

  // Where the next occurrence is, in the *new* document, and select it — N++ reports both.
  const after = view.state;
  const nextScope = options.inSelection
    ? { from: scope.from, to: scope.to + delta }
    : { from: 0, to: after.doc.length };
  const next = findMatch(after, query, { ...options, backwards: false }, nextScope);
  if (next) {
    view.dispatch({
      selection: EditorSelection.single(next.match.from, next.match.to),
      effects: EditorView.scrollIntoView(next.match.from, { y: "center" }),
      scrollIntoView: true,
    });
  }
  return { replaced: true, moreMatches: next !== null };
}

/**
 * True when the current selection is one whole match of the query — what N++ checks before a
 * "Replace" is allowed to overwrite anything ("Replace only ever destroys text the user has
 * already been shown").
 */
function selectionIsMatch(
  state: EditorState,
  query: SearchQuery,
  options: SearchOptions,
  scope: SearchScope,
): boolean {
  const selection = state.selection.main;
  if (selection.empty) return false;
  if (selection.from < scope.from || selection.to > scope.to) return false;
  const text = state.sliceDoc(selection.from, selection.to);

  if (options.mode === "normal") {
    const equal = options.matchCase ? text === query.search : text.toLowerCase() === query.search.toLowerCase();
    if (!equal) return false;
  } else {
    const match = new RegExp(query.search, "u").exec(text);
    if (!match || match.index !== 0 || match[0] !== text) return false;
  }

  if (options.wholeWord && options.mode !== "regexp") {
    const before = selection.from > 0 ? state.sliceDoc(selection.from - 1, selection.from) : " ";
    const after = selection.to < state.doc.length ? state.sliceDoc(selection.to, selection.to + 1) : " ";
    if (/[\p{L}\p{N}_]/u.test(before) || /[\p{L}\p{N}_]/u.test(after)) return false;
  }
  return true;
}

/** N++'s "Replace All": every match in the scope, replaced in one transaction (one undo step). */
export function replaceAll(view: EditorView, query: SearchQuery, options: SearchOptions): number {
  const state = view.state;
  const scope = scopeFor(state, options);
  const matches = allMatches(state, query, scope);
  if (!matches || matches.length === 0) return 0;

  const changes: { from: number; to: number; insert: string }[] = [];
  for (const match of matches) {
    const text = state.sliceDoc(match.from, match.to);
    changes.push({ from: match.from, to: match.to, insert: replacementFor(query, options, text) });
  }
  view.dispatch({ changes, userEvent: "input.replace.all" });
  return changes.length;
}

/* ------------------------------------------------------------------- the dialog */

export interface SearchHost {
  /** The view commands act on: the focused view of the active document, else its owner. */
  target: () => EditorView | null;
  /** Every view of the active document — marks and bookmarks are painted in all of them. */
  views: () => readonly EditorView[];
  /** Toggle bookmark lines the Mark tab's "Bookmark line" option asks for. */
  markLines: (lines: readonly number[]) => void;
}

export type SearchTab = "find" | "replace" | "mark";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: { className?: string; text?: string; attrs?: Record<string, string> } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [name, value] of Object.entries(options.attrs ?? {})) node.setAttribute(name, value);
  return node;
}

/**
 * The floating Find/Replace dialog. It owns the options, the marks and the status line; the
 * workspace owns the documents it acts on (that is what `SearchHost` is for).
 *
 * N++'s dialog is one window with Find / Replace / Mark tabs over a shared set of controls
 * (`IDD_FIND_REPLACE_DLG` in FindReplaceDlg.rc holds every control, and the tabs show and hide
 * groups of them). This is the same shape, minus "Find in Files" and "Find in Projects", which
 * need a filesystem N++ has and a browser page does not — recorded in `DEVIATIONS_FROM_NPP`.
 */
export class FindReplaceDialog {
  readonly options: SearchOptions = { ...NPP_SEARCH_DEFAULTS };
  readonly element: HTMLElement;

  readonly #host: SearchHost;
  readonly #status: HTMLElement;
  readonly #inputs = new Map<string, HTMLInputElement>();
  readonly #buttons = new Map<string, HTMLButtonElement>();
  readonly #rows: HTMLElement[] = [];
  #tab: SearchTab = "find";

  constructor(host: SearchHost, parent: HTMLElement) {
    this.#host = host;
    this.element = el("div", {
      className: "npp-find",
      attrs: { "data-find": "dialog", role: "dialog", "aria-label": "Find and Replace" },
    });
    this.element.hidden = true;

    const tabs = el("div", { className: "npp-find-tabs", attrs: { role: "tablist" } });
    for (const [id, label] of [["find", "Find"], ["replace", "Replace"], ["mark", "Mark"]] as const) {
      const button = el("button", {
        className: "npp-find-tab",
        text: label,
        attrs: { type: "button", role: "tab", "data-find-tab": id },
      });
      button.addEventListener("click", () => this.show(id));
      tabs.appendChild(button);
    }
    const closeTop = el("button", {
      className: "npp-find-x",
      text: "\u00d7",
      attrs: { type: "button", "aria-label": "Close", title: "Close" },
    });
    closeTop.addEventListener("click", () => this.close());
    tabs.appendChild(closeTop);

    const body = el("div", { className: "npp-find-body" });
    body.append(
      this.#field("what", "Find what:", "text"),
      this.#field("with", "Replace with:", "text", "replace"),
    );

    const grid = el("div", { className: "npp-find-checks" });
    grid.append(
      this.#check("wrap", "Wrap around"),
      this.#check("case", "Match case"),
      this.#check("word", "Match whole word only"),
      this.#check("backward", "Backward direction"),
      this.#check("in-selection", "In selection", "replace"),
      this.#check("bookmark-line", "Bookmark line", "mark"),
    );
    body.appendChild(grid);

    const modes = el("fieldset", { className: "npp-find-modes" });
    modes.appendChild(el("legend", { text: "Search Mode" }));
    for (const [value, label] of [
      ["normal", "Normal"],
      ["extended", "Extended (\\n, \\r, \\t, \\0, \\x...)"],
      ["regexp", "Regular expression"],
    ] as const) {
      const wrapper = el("label", { className: "npp-find-radio" });
      const input = el("input", {
        attrs: { type: "radio", name: "npp-find-mode", value, "data-find": "mode" },
      });
      input.checked = value === "normal";
      input.addEventListener("change", () => this.#applyMode(value));
      wrapper.append(input, el("span", { text: label }));
      modes.appendChild(wrapper);
    }
    modes.appendChild(this.#check("dot-newline", ". matches newline"));
    body.appendChild(modes);

    body.appendChild(this.#actions());
    this.#status = el("div", { className: "npp-find-status", attrs: { "data-find": "status" } });
    body.appendChild(this.#status);

    this.element.append(tabs, body);
    this.element.addEventListener("keydown", (event) => this.#onKeydown(event));
    parent.appendChild(this.element);
    this.#render();
  }

  /* ------------------------------------------------------------------ building */

  #field(id: string, label: string, type: string, row?: string): HTMLElement {
    const wrapper = el("div", { className: "npp-find-field" });
    if (row) {
      wrapper.dataset.findRow = row;
      this.#rows.push(wrapper);
    }
    const text = el("label", { text: label, attrs: { for: `npp-find-${id}` } });
    const input = el("input", {
      attrs: { id: `npp-find-${id}`, type, autocomplete: "off", spellcheck: "false", "data-find": id },
    });
    input.addEventListener("input", () => {
      if (id === "what") this.options.query = input.value;
      else this.options.replace = input.value;
    });
    this.#inputs.set(id, input);
    wrapper.append(text, input);
    return wrapper;
  }

  #check(id: string, label: string, row?: string): HTMLElement {
    const wrapper = el("label", { className: "npp-find-check" });
    if (row) {
      wrapper.dataset.findRow = row;
      this.#rows.push(wrapper);
    }
    const input = el("input", { attrs: { type: "checkbox", "data-find": id } });
    input.addEventListener("change", () => {
      switch (id) {
        case "wrap":
          this.options.wrapAround = input.checked;
          break;
        case "case":
          this.options.matchCase = input.checked;
          break;
        case "word":
          this.options.wholeWord = input.checked;
          break;
        case "backward":
          this.options.backwards = input.checked;
          break;
        case "in-selection":
          this.options.inSelection = input.checked;
          break;
        case "dot-newline":
          this.options.dotMatchesNewline = input.checked;
          break;
        default:
          break; // "Bookmark line" is read at Mark All time, not stored in the options
      }
    });
    this.#inputs.set(id, input);
    wrapper.append(input, el("span", { text: label }));
    return wrapper;
  }

  #actions(): HTMLElement {
    const actions = el("div", { className: "npp-find-actions" });
    const add = (id: string, label: string, row: SearchTab | "all", onClick: () => void) => {
      const button = el("button", {
        className: "npp-find-button",
        text: label,
        attrs: { type: "button", "data-find-action": id },
      });
      button.addEventListener("click", onClick);
      this.#buttons.set(id, button);
      if (row !== "all") {
        button.dataset.findRow = row;
        this.#rows.push(button);
      }
      actions.appendChild(button);
      return button;
    };
    add("find-next", "Find Next", "find", () => this.findNext());
    add("find-prev", "Find Previous", "find", () => this.findPrevious());
    add("count", "Count", "find", () => this.count());
    add("replace", "Replace", "replace", () => this.replaceOne());
    add("replace-all", "Replace All", "replace", () => this.replaceEvery());
    add("mark-all", "Mark All", "mark", () => this.markAll());
    add("clear-marks", "Clear all marks", "mark", () => this.clearMarked());
    add("close", "Close", "all", () => this.close());
    return actions;
  }

  /* ---------------------------------------------------------------- appearance */

  get tab(): SearchTab {
    return this.#tab;
  }

  get open(): boolean {
    return !this.element.hidden;
  }

  get status(): string {
    return this.#status.textContent ?? "";
  }

  show(tab: SearchTab = this.#tab): void {
    this.#tab = tab;
    this.element.hidden = false;
    this.#render();
    this.#inputs.get("what")?.focus();
    this.#inputs.get("what")?.select();
  }

  close(): void {
    this.element.hidden = true;
    this.#host.target()?.focus();
  }

  /** Pull the widget state out of the options — one place that knows both. */
  #render(): void {
    const option = (id: string) => this.#inputs.get(id);
    option("what")!.value = this.options.query;
    option("with")!.value = this.options.replace;
    option("wrap")!.checked = this.options.wrapAround;
    option("case")!.checked = this.options.matchCase;
    option("word")!.checked = this.options.wholeWord;
    option("backward")!.checked = this.options.backwards;
    option("in-selection")!.checked = this.options.inSelection;
    option("dot-newline")!.checked = this.options.dotMatchesNewline;
    for (const input of this.element.querySelectorAll<HTMLInputElement>("input[data-find='mode']")) {
      input.checked = input.value === this.options.mode;
    }

    for (const tab of this.element.querySelectorAll<HTMLElement>("[data-find-tab]")) {
      const active = tab.dataset.findTab === this.#tab;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    }
    for (const node of this.#rows) {
      node.hidden = node.dataset.findRow !== this.#tab;
    }
    this.#applyModeGating();
  }

  /**
   * N++'s option rules (FindReplaceDlg.cpp:2695-2740), applied to the controls:
   * whole word and backward direction are disabled in regular-expression mode, and
   * ". matches newline" is only enabled there.
   */
  #applyModeGating(): void {
    const regexp = this.options.mode === "regexp";
    const word = this.#inputs.get("word")!;
    const backward = this.#inputs.get("backward")!;
    const dot = this.#inputs.get("dot-newline")!;
    const previous = this.#buttons.get("find-prev")!;
    word.disabled = regexp;
    backward.disabled = regexp;
    dot.disabled = !regexp;
    previous.disabled = regexp;
    word.closest("label")?.classList.toggle("is-disabled", regexp);
    backward.closest("label")?.classList.toggle("is-disabled", regexp);
    dot.closest("label")?.classList.toggle("is-disabled", !regexp);
  }

  #applyMode(mode: SearchMode): void {
    this.options.mode = mode;
    if (mode === "regexp") {
      // N++ unchecks both rather than leaving a checked-but-ignored control (FindReplaceDlg.cpp:2714).
      this.options.wholeWord = false;
      this.options.backwards = false;
    }
    this.#render();
  }

  /* ------------------------------------------------------------------- commands */

  #onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key === "F3") {
      event.preventDefault();
      if (event.shiftKey) this.findPrevious();
      else this.findNext();
      return;
    }
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      this.findNext();
    }
  }

  /** The state a command runs against: the focused view, else the document's owner. */
  #target(): EditorView | null {
    return this.#host.target();
  }

  #say(message: string): void {
    this.#status.textContent = message;
  }

  /**
   * Where the focus goes after a command. N++ hands it back to the dialog's "Find what" box
   * while the dialog is open (`FindReplaceDlg.cpp:3075` sets focus to IDFINDWHAT) and to the
   * editor when it is not — the difference matters here, because stealing focus out of a text
   * input mid-typing would end the search after one keystroke.
   */
  #refocus(): void {
    if (this.open) this.#inputs.get("what")?.focus();
    else this.#host.target()?.focus();
  }

  /** Shared front half of every command: the query, or the reason there is none. */
  #ready(): { view: EditorView; query: SearchQuery; scope: SearchScope } | null {
    const view = this.#target();
    if (!view) {
      this.#say("No document");
      return null;
    }
    const { query, problem } = buildQuery(this.options);
    if (!query) {
      this.#say(problem === "invalid-regexp" ? SEARCH_STATUS.invalidRegexp : "");
      return null;
    }
    return { view, query, scope: scopeFor(view.state, this.options) };
  }

  #canFind(message: string): boolean {
    // N++'s own hint is only worth the pixels when a stricter option could be the cause.
    const lax = this.options.wrapAround && !this.options.matchCase && !this.options.wholeWord;
    this.#say(lax ? message : `${message}\n${SEARCH_STATUS.cantFindHint}`);
    return false;
  }

  findNext(): boolean {
    return this.#step(false);
  }

  findPrevious(): boolean {
    return this.#step(true);
  }

  #step(backwards: boolean): boolean {
    const ready = this.#ready();
    if (!ready) return false;
    const { view, query, scope } = ready;
    const found = findMatch(view.state, query, { ...this.options, backwards }, scope);
    if (!found) return this.#canFind(SEARCH_STATUS.cantFind(this.options.query));

    view.dispatch({
      selection: EditorSelection.single(found.match.from, found.match.to),
      effects: EditorView.scrollIntoView(found.match.from, { y: "center" }),
      scrollIntoView: true,
      userEvent: "select.search",
    });
    this.#refocus();
    this.#say(
      found.wrapped
        ? backwards
          ? SEARCH_STATUS.topReached
          : SEARCH_STATUS.endReached
        : "",
    );
    return true;
  }

  count(): number {
    const ready = this.#ready();
    if (!ready) return 0;
    const { view, query, scope } = ready;
    const matches = allMatches(view.state, query, scope);
    const total = matches?.length ?? 0;
    this.#say(total === 1 ? SEARCH_STATUS.countOne : SEARCH_STATUS.countMany(total));
    return total;
  }

  /** N++'s Mark tab: paint every match of the current query (and optionally bookmark its line). */
  markAll(): number {
    const ready = this.#ready();
    if (!ready) return 0;
    const { view, query, scope } = ready;
    const matches = allMatches(view.state, query, scope);
    if (!matches) {
      this.#say("Find: too many matches to mark");
      return 0;
    }

    applyToViews(this.#host.views(), setMarksEffect.of(matches));
    if (this.#inputs.get("bookmark-line")?.checked && matches.length > 0) {
      const lines = [...new Set(matches.map((match) => view.state.doc.lineAt(match.from).number))];
      this.#host.markLines(lines);
    }
    this.#say(matches.length === 1 ? SEARCH_STATUS.markOne : SEARCH_STATUS.markMany(matches.length));
    return matches.length;
  }

  clearMarked(): void {
    clearMarks(this.#host.views());
    this.#say("");
  }

  replaceOne(): boolean {
    const ready = this.#ready();
    if (!ready) return false;
    const { view, query } = ready;
    const outcome = replaceCurrent(view, query, this.options);
    if (!outcome.replaced) {
      this.#say(outcome.moreMatches ? "" : SEARCH_STATUS.replaceNotFound);
      return false;
    }
    this.#say(outcome.moreMatches ? SEARCH_STATUS.replacedNext : SEARCH_STATUS.replacedLast);
    this.#refocus();
    return true;
  }

  replaceEvery(): number {
    const ready = this.#ready();
    if (!ready) return 0;
    const { view, query } = ready;
    const replaced = replaceAll(view, query, this.options);
    if (replaced === 0) {
      this.#say(SEARCH_STATUS.replaceNotFound);
      return 0;
    }
    this.#say(replaced === 1 ? SEARCH_STATUS.replaceAllOne : SEARCH_STATUS.replaceAllMany(replaced));
    this.#refocus();
    return replaced;
  }
}

/* ------------------------------------------------------------------ Go to line */

export interface GoToHost {
  target: () => EditorView | null;
}

/**
 * N++'s Go To dialog (`IDD_GOLINE`, Notepad_plus.rc:1472): Line or Offset, "You are here:",
 * "You want to go to:", "You can't go further than:", and the buttons "Go" / "I'm going nowhere".
 * Line mode puts the caret at the start of the line (`SCI_GOTOLINE`); Offset mode at the
 * character offset (`SCI_GOTOPOS`, GoToLineDlg.cpp:100).
 */
export function openGoToDialog(host: GoToHost): void {
  const view = host.target();
  if (!view) return;

  let mode: "line" | "offset" = "line";
  const dialog = el("dialog", { className: "npp-dialog", attrs: { "data-dialog": "go-to" } });
  const title = el("h2", { className: "npp-dialog-title", text: "Go To..." });

  const radios = el("div", { className: "npp-goto-modes" });
  const radio = (value: "line" | "offset", label: string) => {
    const wrapper = el("label", { className: "npp-find-radio" });
    const input = el("input", {
      attrs: { type: "radio", name: "npp-goto-mode", value, "data-goto": "mode" },
    });
    input.checked = value === "line";
    input.addEventListener("change", () => {
      mode = value;
      update();
    });
    wrapper.append(input, el("span", { text: label }));
    radios.appendChild(wrapper);
  };
  radio("line", "Line");
  radio("offset", "Offset");

  const grid = el("div", { className: "npp-goto-grid" });
  const here = el("input", { attrs: { type: "text", readonly: "", "data-goto": "here" } });
  const want = el("input", { attrs: { type: "text", "data-goto": "want", inputmode: "numeric" } });
  const limit = el("span", { className: "npp-goto-limit", attrs: { "data-goto": "limit" } });
  const row = (label: string, control: HTMLElement) => {
    grid.append(el("span", { className: "npp-goto-label", text: label }), control);
  };
  row("You are here:", here);
  row("You want to go to:", want);
  row("You can't go further than:", limit);

  const actions = el("div", { className: "npp-dialog-actions" });
  const cancel = el("button", {
    className: "npp-dialog-cancel",
    text: "I'm going nowhere",
    attrs: { type: "button", "data-dialog-action": "cancel" },
  });
  const go = el("button", {
    className: "npp-dialog-confirm",
    text: "Go",
    attrs: { type: "button", "data-dialog-action": "go" },
  });
  cancel.addEventListener("click", () => dialog.close("cancel"));
  go.addEventListener("click", () => dialog.close("go"));
  actions.append(cancel, go);

  const update = () => {
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    here.value = mode === "line" ? String(line.number) : String(view.state.selection.main.head);
    limit.textContent =
      mode === "line" ? String(view.state.doc.lines) : String(view.state.doc.length);
    want.value = "";
    want.focus();
  };

  dialog.append(title, radios, grid, actions);
  dialog.addEventListener("close", () => {
    const accepted = dialog.returnValue === "go";
    dialog.remove();
    if (!accepted) {
      view.focus();
      return;
    }
    const value = Number.parseInt(want.value, 10);
    if (!Number.isFinite(value)) {
      view.focus();
      return;
    }
    const doc = view.state.doc;
    const target =
      mode === "line"
        ? doc.line(Math.min(Math.max(value, 1), doc.lines)).from
        : Math.min(Math.max(value, 0), doc.length);
    view.dispatch({
      selection: EditorSelection.cursor(target),
      effects: EditorView.scrollIntoView(target, { y: "center" }),
      scrollIntoView: true,
    });
    view.focus();
  });
  document.body.appendChild(dialog);
  dialog.showModal();
  update();
  want.select();
}
