/**
 * Notepad++ default configuration for the CodeMirror 6 editor core — Task 3.
 *
 * Every value here is copied from the Notepad++ source with its reference inline:
 * the point of this file is *fidelity* to those defaults, not taste. Where the
 * browser makes an N++ default impossible, `DEVIATIONS_FROM_NPP` records the
 * difference instead of quietly diverging from the original.
 *
 * Sources (Notepad++ master, fetched 2026-09-25 — primary evidence for Task 3):
 *   PowerEditor/src/Parameters.h         NppGUI + ScintillaViewParams defaults
 *   PowerEditor/src/stylers.model.xml    GlobalStyles: colours and the default font
 *   codemirror.net/examples/split/       the sync mechanism behind split-view.ts (R2)
 *   docs/r2-shared-state-spike.md        the browser proof for that mechanism
 */
import { Compartment, EditorState, type Extension, type Text } from "@codemirror/state";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  type KeyBinding,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  undo,
} from "@codemirror/commands";
import {
  bracketMatching,
  codeFolding,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
} from "@codemirror/language";

import { DARK_TOKEN_COLORS, NPP_TOKEN_COLORS, nppHighlighting, type TokenColours } from "../languages/highlight";
import { bookmarkField, bookmarkMarginCompartment, bookmarkMarginExtension } from "../search/bookmarks";
import { markField } from "../search/find-replace";
import { fontSizeForZoom, type ThemeName } from "../storage/preferences";
import { paletteFor } from "./palettes.ts";
import { overviewRuler } from "./overview-ruler";

/* ------------------------------------------------------------------ defaults */

/** stylers.model.xml → GlobalStyles/"Default Style": fontName="Courier New" fontSize="10". */
export const NPP_FONT_FAMILY =
  '"Courier New", Courier, "DejaVu Sans Mono", ui-monospace, monospace';
/** The style's own size at zoom 0 — Scintilla's zoom is an increment *on top of* this. */
export const NPP_FONT_SIZE = fontSizeForZoom(0);

/** Parameters.h: `int _tabSize = 4;` and `bool _tabReplacedBySpace = false;` (NppGUI). */
export const NPP_TAB_SIZE = 4;
export const NPP_INDENT_UNIT = "\t";

/** Parameters.h:902 `bool _bookMarkMarginShow = true;` — N++ shows the bookmark margin by default. */
export const NPP_BOOKMARK_MARGIN = true;

/** Parameters.h (ScintillaViewParams): line margin on, indent guides on, wrap off, caret 1px. */
export const NPP_LINE_NUMBERS = true;
export const NPP_INDENT_GUIDES = true;
export const NPP_WORD_WRAP = false;
export const NPP_CARET_WIDTH = 1;

// The palettes live in `palettes.ts`, free of CodeMirror imports, so `scripts/test-themes.mjs`
// can compare them in Node. Re-exported from here because this is the module the rest of the
// app already takes its colours from.
export { NPP_COLORS, DARK_COLORS, PALETTES, type NppColours } from "./palettes.ts";

/** The editor's look at a given zoom and theme — what `editorLookCompartment` holds. */
export function nppEditorLook(options: { zoom?: number; theme?: ThemeName } = {}): Extension {
  const palette = paletteFor(options.theme);
  const colors = palette.colors;
  return EditorView.theme(
    {
      "&": {
        color: colors.foreground,
        backgroundColor: colors.background,
        // N++'s Default Style size (10 pt) plus the zoom level, in points — Scintilla's own
        // model: a zoom level *is* a point count (`SCI_SETZOOM`).
        fontSize: fontSizeForZoom(options.zoom ?? 0),
        height: "100%",
      },
      ".cm-scroller": { fontFamily: NPP_FONT_FAMILY },
      ".cm-content": { fontFamily: NPP_FONT_FAMILY, caretColor: colors.caret },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: colors.caret,
        borderLeftWidth: `${NPP_CARET_WIDTH}px`,
      },
      // Selection. The selector's *shape* is load-bearing, not decoration: CodeMirror's own
      // base theme paints the focused selection through `&light.cm-focused > .cm-scroller >
      // .cm-selectionLayer .cm-selectionBackground` — five class selectors — and this rule's
      // original three lost to it silently. The palette's #c0c0c0 therefore never reached
      // the screen and the selection stayed CM6's #d7d4f0, which is indistinguishable from
      // N++'s #e8e8ff active-line band: selecting a word on the current row looked like
      // nothing had happened. Measured in `scripts/verify-task9.py` (S15); the `.cm-editor`
      // class is there so this rule wins on specificity, not on stylesheet order.
      "&.cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, & > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: colors.selection,
      },
      // N++ paints the current-line background *first* and the selection on top of it
      // (Scintilla's order). CodeMirror paints its selection on a layer at z-index -2, i.e.
      // behind the content, so an opaque background on `.cm-line` hides a selection
      // completely — measured: on the current row the selected text kept the band's
      // #e8e8ff and the selection's own colour never appeared. The band therefore lives on
      // a pseudo-element at z-index -3, which is behind the selection layer; the line itself
      // is transparent. See S15 and `scripts/verify-task9.py`.
      ".cm-activeLine": { backgroundColor: "transparent", position: "relative" },
      ".cm-activeLine::before": {
        content: '""',
        position: "absolute",
        inset: "0",
        zIndex: "-3",
        pointerEvents: "none",
        backgroundColor: colors.activeLine,
      },
      ".cm-gutters": {
        backgroundColor: colors.gutterBackground,
        color: colors.gutterForeground,
        border: "none",
      },
      ".cm-activeLineGutter": {
        backgroundColor: colors.activeLine,
        color: colors.foreground,
      },
      ".cm-foldGutter": { backgroundColor: colors.foldMarginBackground },
      ".cm-foldGutter .cm-gutterElement": { color: colors.gutterForeground },
      ".cm-foldPlaceholder": {
        backgroundColor: colors.gutterBackground,
        border: "none",
        color: colors.gutterForeground,
      },
      ".cm-matchingBracket": {
        color: colors.braceHighlight,
        backgroundColor: "transparent",
        fontWeight: "bold",
      },
      ".cm-nonmatchingBracket": {
        color: colors.badBrace,
        backgroundColor: "transparent",
      },
      // Search marks — N++'s "Find Mark style", i.e. Mark Style 1 (bgColor 00FFFF).
      ".cm-searchMark": { backgroundColor: colors.markStyle1 },
      // The bookmark margin: N++'s own margins are the gutter grey, and the dot is its
      // bitmap drawn with SCI_MARKERSETALPHA 70 (ScintillaEditView.cpp:412) — ≈27% opacity,
      // which is why the marker looks pale on a real N++ bookmark margin.
      ".cm-bookmarkGutter": { backgroundColor: colors.gutterBackground },
      ".npp-bookmark-dot": {
        width: "8px",
        height: "8px",
        marginTop: "2px",
        borderRadius: "50%",
        background: "rgba(95 123 215 / 27%)",
      },
    },
    { dark: palette.dark },
  );
}

/* ------------------------------------------------------------------ keymaps */

/**
 * Keys N++ binds that a web page cannot have, and the free key each is mapped to.
 * Chrome handles these itself (new window/tab, close tab, switch tab), so no page
 * can repurpose them — see docs/r2-shared-state-spike.md notes and
 * DEVIATIONS_FROM_NPP below.
 */
export const WEB_PORT_KEYS = {
  // Task 5. N++ binds Find to Ctrl+F, and Chrome does not merely "also" handle it: the page
  // never receives the keydown at all, and the find bar takes the focus (measured twice, in
  // scripts/probe-reserved-keys.py — the same instrument that cleared Alt+N/O/S/W in Task 4).
  // Every other key in this task's family *is* deliverable, because the page receives the
  // keydown and `preventDefault` suppresses Chrome's action — also measured:
  //   Ctrl+H (Replace) · Ctrl+G (Go to) · F3 / Shift+F3 (find next/previous) · Ctrl+M (Mark)
  //   Ctrl+F2 / F2 / Shift+F2 (bookmarks)
  find: "Alt-f", // N++: Ctrl+F
  newDocument: "Alt-n", // N++: Ctrl+N
  openFile: "Alt-o", // N++: Ctrl+O
  saveFile: "Alt-s", // N++: Ctrl+S
  saveFileAs: "Alt-Shift-s", // N++: Ctrl+Alt+Shift+S
  closeDocument: "Alt-w", // N++: Ctrl+W
  nextDocument: "Alt-PageDown", // N++: Ctrl+Tab
  previousDocument: "Alt-PageUp", // N++: Ctrl+Shift+Tab
  toggleWordWrap: "Alt-z", // N++: no default binding
  // Task 3 also bound split view to Alt+S; Task 4 gives that key to Save, which is
  // the more important command, and Alt+C (clone to other view) already ran the
  // same handler — so no capability is lost by dropping the duplicate.
  cloneToOtherView: "Alt-c", // N++: View ▸ Move/Clone Current Document ▸ Clone to Other View
} as const;

/**
 * Task 5's keys. N++'s own defaults wherever a page can hold them (see `WEB_PORT_KEYS.find`
 * for the one exception); the defaults are N++'s `winKeyDefs[]` table in Parameters.cpp.
 */
export const SEARCH_KEYS = {
  find: WEB_PORT_KEYS.find, // Alt+F   (N++ Ctrl+F)
  findNext: "F3", // N++
  findPrevious: "Shift-F3", // N++
  replace: "Ctrl-h", // N++
  mark: "Ctrl-m", // N++
  gotoLine: "Ctrl-g", // N++
  toggleBookmark: "Ctrl-F2", // N++
  nextBookmark: "F2", // N++
  previousBookmark: "Shift-F2", // N++
} as const;

/** What the app can do from the keyboard. Every handler returns true when it handled the key. */
export interface NppCommandHandlers {
  newDocument?: () => boolean;
  openFile?: () => boolean;
  saveFile?: () => boolean;
  saveFileAs?: () => boolean;
  closeDocument?: () => boolean;
  nextDocument?: () => boolean;
  previousDocument?: () => boolean;
  toggleWordWrap?: () => boolean;
  cloneToOtherView?: () => boolean;
  // Task 5 — search, replace and navigation.
  find?: () => boolean;
  replace?: () => boolean;
  mark?: () => boolean;
  findNext?: () => boolean;
  findPrevious?: () => boolean;
  gotoLine?: () => boolean;
  toggleBookmark?: () => boolean;
  nextBookmark?: () => boolean;
  previousBookmark?: () => boolean;
}

export interface NppKeymapOptions {
  /** false for a cloned view: it has no history of its own (see split-view.ts). */
  includeHistory?: boolean;
}

export function nppKeymap(
  handlers: NppCommandHandlers = {},
  options: NppKeymapOptions = {},
): KeyBinding[] {
  const includeHistory = options.includeHistory ?? true;
  const bindings: KeyBinding[] = [];

  const add = (key: string, run: (() => boolean) | undefined) => {
    if (run) bindings.push({ key, run, preventDefault: true });
  };
  add(WEB_PORT_KEYS.newDocument, handlers.newDocument);
  add(WEB_PORT_KEYS.openFile, handlers.openFile);
  add(WEB_PORT_KEYS.saveFile, handlers.saveFile);
  add(WEB_PORT_KEYS.saveFileAs, handlers.saveFileAs);
  add(WEB_PORT_KEYS.closeDocument, handlers.closeDocument);
  add(WEB_PORT_KEYS.nextDocument, handlers.nextDocument);
  add(WEB_PORT_KEYS.previousDocument, handlers.previousDocument);
  add(WEB_PORT_KEYS.toggleWordWrap, handlers.toggleWordWrap);
  add(WEB_PORT_KEYS.cloneToOtherView, handlers.cloneToOtherView);
  add(SEARCH_KEYS.find, handlers.find);
  add(SEARCH_KEYS.replace, handlers.replace);
  add(SEARCH_KEYS.mark, handlers.mark);
  add(SEARCH_KEYS.findNext, handlers.findNext);
  add(SEARCH_KEYS.findPrevious, handlers.findPrevious);
  add(SEARCH_KEYS.gotoLine, handlers.gotoLine);
  add(SEARCH_KEYS.toggleBookmark, handlers.toggleBookmark);
  add(SEARCH_KEYS.nextBookmark, handlers.nextBookmark);
  add(SEARCH_KEYS.previousBookmark, handlers.previousBookmark);

  // N++ inserts a real tab character (Parameters.h: _tabReplacedBySpace = false).
  bindings.push(indentWithTab);
  bindings.push(...defaultKeymap);
  if (includeHistory) bindings.push(...historyKeymap);
  bindings.push(...foldKeymap);
  return bindings;
}

/**
 * History keys for a *cloned* view: the document has one undo history, held by
 * its owner view, so Mod-Z here must drive the owner (exactly as the official
 * split-view example does).
 */
export function cloneHistoryKeymap(owner: () => EditorView | undefined): KeyBinding[] {
  return [
    {
      key: "Mod-z",
      run: () => {
        const view = owner();
        return view ? undo(view) : false;
      },
      preventDefault: true,
    },
    {
      key: "Mod-y",
      mac: "Mod-Shift-z",
      run: () => {
        const view = owner();
        return view ? redo(view) : false;
      },
      preventDefault: true,
    },
    {
      key: "Ctrl-Shift-z",
      run: () => {
        const view = owner();
        return view ? redo(view) : false;
      },
      preventDefault: true,
    },
  ];
}

/* -------------------------------------------------------- extension bundles */

export const wordWrapCompartment = new Compartment();

/**
 * Task 7. The editor's look — N++'s colours at the current zoom and theme. A preference is not
 * a preference until it changes something, so zoom and theme are applied through this compartment
 * on every live view, the same way word wrap and the language are.
 */
export const editorLookCompartment = new Compartment();

/**
 * Task 10. The token palette that goes with the theme. Separate from the look because a
 * `HighlightStyle` is a different extension: the look owns the editor's chrome colours, this
 * owns the syntax colours, and a theme change reconfigures both.
 */
export const highlightCompartment = new Compartment();

/** The token table for a theme; an unknown name falls back to N++'s light palette. */
export function tokenColoursFor(theme?: ThemeName): TokenColours {
  return paletteFor(theme).dark ? DARK_TOKEN_COLORS : NPP_TOKEN_COLORS;
}

/**
 * Task 6. The language's extension, swapped with `reconfigure` when a document's language is
 * known — including *after* the document is mounted, because loading a language is async and
 * a file must open immediately.
 */
export const languageCompartment = new Compartment();

/**
 * P4 (D5). Everything plugins contribute to a document's editor: their view-level
 * extensions, plus a keymap built from the commands they registered. A compartment
 * for the same reason the theme and the language have one — the plugin set can
 * change while documents are open (enable, disable, reload), and every view has to
 * follow. Both states carry it: `createDocumentState` and `createCloneState` both
 * build from `editorCoreExtensions`, so a split pane gets plugin extensions without
 * a second mechanism.
 */
export const pluginCompartment = new Compartment();

export function wordWrapExtension(on: boolean): Extension {
  return on ? EditorView.lineWrapping : [];
}

export interface EditorCoreOptions {
  wordWrap?: boolean;
  /** N++ shows the bookmark margin by default (Parameters.h:902 `_bookMarkMarginShow = true`). */
  bookmarkMargin?: boolean;
  /** The document's loaded language support, if it has one and it has arrived. */
  language?: Extension;
  /** P4 — what active plugins contribute: extensions and their command keymap. */
  plugins?: Extension;
  /** Task 7 — the zoom preference (`<ScintillaViewParams zoom="0">`), in points. */
  zoom?: number;
  /** Task 7 — the theme preference; only N++'s own palette exists so far. */
  theme?: ThemeName;
  /**
   * Task 7 — N++'s `userReadOnly`, which is what a *placeholder* for an inaccessible file is
   * opened as (`Buffer.cpp:1754-1760`). Two facets are needed, not one: `EditorState.readOnly`
   * stops transactions from changing the document (so commands and dispatches are refused) and
   * `EditorView.editable` is what makes the DOM itself refuse typing — the CM6 docs are explicit
   * that the first "doesn't affect API calls that change the editor content", i.e. on its own it
   * would leave the page typable.
   */
  readOnly?: boolean;
}

/**
 * The explicit replacement for `basicSetup` (Task 3 step 1): only extensions this
 * editor actually wants, each one corresponding to an N++ default.
 *
 * Deliberately absent, with the reason:
 *   - `autocompletion` / `closeBrackets` — N++ opens word completion on demand
 *     (Ctrl+Space), it is not automatic; unassigned task, see docs/scope.md tiers;
 *   - `@codemirror/search`'s panel and keymap — Task 5 brings the N++-style dialog and its
 *     own keys instead (`src/search/find-replace.ts` explains why the panel is unusable here);
 *   - `highlightSelectionMatches` (N++'s Smart Highlighter) — tier 2 in docs/scope.md.
 */
export function editorCoreExtensions(options: EditorCoreOptions = {}): Extension[] {
  const wordWrap = options.wordWrap ?? NPP_WORD_WRAP;
  return [
    // N++: line number margin shown (Parameters.h: _lineNumberMarginShow = true).
    lineNumbers(),
    // N++: active line highlighted, not framed (Parameters.h: LINEHILITE_HILITE).
    highlightActiveLineGutter(),
    highlightActiveLine(),
    // N++ renders non-printables; whitespace symbols stay off by default (_wrapSymbolShow = false).
    highlightSpecialChars(),
    // N++ has a fold margin in the default style. `codeFolding()` supplies the fold *state*
    // (foldGutter only draws markers): Task 3 wired the gutter, but nothing could be folded
    // until there were languages to fold — which is now (fold state is a per-view StateField,
    // so `workspace.ts` also mirrors it across the panes, the way it does bookmarks).
    foldGutter(),
    codeFolding(),
    history(),
    drawSelection(),
    dropCursor(),
    // N++ column/rectangular selection (Alt+drag) needs multiple selections.
    EditorState.allowMultipleSelections.of(true),
    // Task 7: N++'s `userReadOnly` — a placeholder for an inaccessible file is opened read-only
    // (`Buffer.cpp:1756-1760`). Both facets are needed; `EditorCoreOptions.readOnly` says why.
    ...(options.readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
    rectangularSelection(),
    crosshairCursor(),
    indentOnInput(),
    bracketMatching(),
    EditorState.tabSize.of(NPP_TAB_SIZE),
    indentUnit.of(NPP_INDENT_UNIT),
    // Task 7: N++'s colours at the current zoom, swappable when the preference changes.
    editorLookCompartment.of(nppEditorLook({ zoom: options.zoom, theme: options.theme })),
    // Task 6/10: N++'s token colours for the theme in force, plus the document's own language
    // (empty until it loads).
    highlightCompartment.of(nppHighlighting(tokenColoursFor(options.theme))),
    languageCompartment.of(options.language ?? []),
    // P4 (D5): active plugins' extensions and command keymap. Empty until one is
    // enabled, and reconfigured on every live view when that set changes.
    pluginCompartment.of(options.plugins ?? []),
    // Task 6: the overview ruler, per view like the marks it draws from.
    overviewRuler,
    wordWrapCompartment.of(wordWrapExtension(wordWrap)),
    // Task 5: search marks and the bookmark margin. Both are per-view state — the split
    // dispatcher forwards document changes only — so `workspace.ts` keeps the views of one
    // document in step, and `EditorCoreOptions` carries the margin's initial visibility.
    markField,
    bookmarkField,
    bookmarkMarginCompartment.of(
      bookmarkMarginExtension(options.bookmarkMargin ?? NPP_BOOKMARK_MARGIN),
    ),
  ];
}

/** A document state: the core extensions plus the keymap and, unless cloned, a history. */
export function createDocumentState(
  doc: string | Text,
  options: EditorCoreOptions & { handlers?: NppCommandHandlers } = {},
): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      ...editorCoreExtensions(options),
      keymap.of(nppKeymap(options.handlers)),
    ],
  });
}

/**
 * State for a cloned view of an existing document: same core extensions, no
 * history of its own, undo/redo routed to the owner view.
 */
export function createCloneState(
  doc: string | Text,
  owner: () => EditorView | undefined,
  options: EditorCoreOptions & { handlers?: NppCommandHandlers } = {},
): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      ...editorCoreExtensions(options),
      keymap.of([
        ...cloneHistoryKeymap(owner),
        ...nppKeymap(options.handlers, { includeHistory: false }),
      ]),
    ],
  });
}

/* --------------------------------------------------------------- deviations */

/** Honest list of N++ defaults this port does not reproduce, with the reason. */
export const DEVIATIONS_FROM_NPP: readonly string[] = [
  "Find is Alt+F, not N++'s Ctrl+F: Chrome delivers no keydown to the page for Ctrl+F and opens its own find bar, which then holds the focus. Measured, and re-measurable with `python3 scripts/probe-reserved-keys.py`. Ctrl+H (Replace), Ctrl+G (Go to), F3/Shift+F3, Ctrl+M (Mark) and the bookmark keys F2/Shift+F2/Ctrl+F2 *are* deliverable — the page receives them and `preventDefault` suppresses Chrome's action.",
  "Find in Files and Find in Projects are not built: they search a filesystem, and a page has none (the pickers open one file at a time by design). \"Find All in Current Document\" and the Search Results window are tier 2/3 in docs/scope.md.",
  "Regular-expression mode uses JavaScript's engine, not N++'s Boost.Regex: `\\K`, `\\G`, POSIX classes and Boost's `(?<name>...)`/conditional syntax differ. The dialog says so where it matters and the ECMAScript subset covers what the MVP promises.",
  "Incremental search (Ctrl+Alt+I) and the Smart Highlighter are not built — both are tier-2 rows in docs/scope.md. NPP_COLORS.smartHighlight and .markStyle1 are reserved for them; Task 5 uses markStyle1 for the Mark tab's marks.",
  "Indent guides: N++ shows them (`_indentGuideLineShow = true`, colour c0c0c0). CM6 core has no indent-guide extension — it needs a third-party package or a custom line-decoration plugin. Colour is reserved in NPP_COLORS.indentGuide.",
  "Vertical edge: N++'s `Edge colour` (80ffff) marker at the wrap column is not drawn; it needs a custom decoration plugin.",
  "Keyboard: N++'s New / Close / next-tab keys are Ctrl+N, Ctrl+W, Ctrl+Tab — all owned by the browser and not interceptable by a page. Mapped to Alt+N, Alt+W, Alt+PageDown/Alt+PageUp (WEB_PORT_KEYS).",
  "INS/OVR: N++ has an overwrite mode; CM6 has no overwrite state, so the status bar carries no INS/OVR field.",
  "Bracket matching: N++ colours a matched pair red+bold (`Brace highlight style`) and an unmatched one dark red (`Bad brace colour`); both are themed to those colours, but the rendering is not pixel-identical.",
  "Mixed per-line EOL: CM6 normalises to one line separator (risk R3 in docs/scope.md) — the status bar reports the document's single separator, as designed there.",
  // ── Task 6 (languages) ────────────────────────────────────────────────────────────────
  "The overview ruler is not a Notepad++ feature. N++'s equivalent is the Document Map (a minimap, Tier 2/3 and unscheduled — docs/editor-core-decision.md B1); this strip instead maps the whole document onto the pane height and marks the language's fold regions, the search marks and the bookmarks. Clicking it scrolls; it never moves the caret.",
  "The language is chosen by extension, by a few well-known file names and, failing both, by N++'s own content rule (`FileManager::detectLanguageFromTextBeginning`); Language ▸ <name> overrides that choice for the active document, and \"None (Normal Text)\" clears it. The menu groups the 140 languages under their first letter, A–Z — N++'s optional compact form (`_isLangMenuCompact`, `Notepad_plus.cpp:583-635`) rather than its default flat menu — with the order inside a group taken from N++'s short name, case-insensitively, rather than from the rc's hand-maintained `IDM_LANG_*` order (nearly alphabetical, but CSound precedes CoffeeScript, LISP precedes LaTeX, Shell precedes Scheme).",
  "N++'s UDL entries at the bottom of the Language menu (\"Define your language…\", \"Open User Defined Language folder…\", \"Notepad++ User Defined Languages Collection\", \"User-Defined\") are absent: UDL is unscheduled (D10), and a page has no user folder to open.",
  "makefile, batch/.bat, INI, JSON5, GraphQL, Kotlin-in-N++-terms and MATLAB-in-N++-terms have no CM6 mode anywhere. They open as \"Normal text file\" — highlighting them would mean writing a StreamLanguage by hand, which D9 did not require and the plan left as an open question. (C#, Kotlin, Scala and Objective-C *are* covered: `legacy-modes/mode/clike.js` exports parsers for them.)",
  "The 113 legacy `StreamLanguage` ports highlight but do not fold: a stream parser produces tokens, not a syntax tree, so `foldable()` reports nothing and the overview ruler shows no structure ticks for them. That is the trade D9 accepted in exchange for the long tail.",
  "N++ renders a `.vue` file with its JavaScript lexer (`langs.model.xml`: ext=\"js jsm jsx mjs vue\"); this port uses the Vue grammar, which is strictly better, and hands `.jsx`/`.tsx` to the JSX/TSX variants of the JavaScript grammar for the same reason.",
  "Extension and file-name detection is a deliberate addition to N++'s rule — N++ decides by extension alone, so a `Makefile` or a `Dockerfile` is \"Normal text file\" there unless the user picks the language. The recognised names are in `src/languages/registry.ts` (FILENAMES).",
  // ── Task 7 (session, backups, preferences) ────────────────────────────────────────────────
  "The session lives in IndexedDB and the bodies of unsaved documents in an OPFS `backup/` directory, not in `%APPDATA%\\\\Notepad++\\\\session.xml` and `backup\\\\`. The *fields* and the *rules* are N++'s (including its `FILENAME@YYYY-MM-DD_HHMMSS` backup names); the storage is what a page has instead of a user directory. A consequence worth stating: N++ users can copy session.xml aside as a backup, and this port cannot hand out its storage — the protection it offers instead is `navigator.storage.persist()` plus the snapshot interval.",
  "A reload is not a close. N++ can ask before quitting and therefore cannot lose unsaved edits by surprise; a page cannot stop a reload, and the browser may do it on its own (a crash, a mobile tab eviction). What this port does instead: it snapshots every dirty document on N++'s own interval, and when a reload happens with that protection switched off it says so, by name, rather than opening the file and letting the edits disappear quietly.",
  "N++'s Preferences ▸ MISC is a page of checkboxes; this port's Settings ▸ Preferences… carries only the settings it actually has (the session and snapshot group, the toolbar, the theme and the zoom). Style Configurator, Shortcut Mapper and the Import submenu are not built — they exist in N++ because it has style files and a Win32 shortcut table, neither of which a page has.",
  "Dark Mode is N++'s own: `installer/themes/DarkModeDefault.xml` for the editor and `NppDarkMode.cpp`'s `Colors` table for the chrome, with two honest limits. (1) That theme ships no UDL styles, so the five markdown tokens (heading, strong, emphasis, code, strikethrough) are mapped to the nearest Zenburn styles rather than being N++'s own. (2) N++'s colours do not meet WCAG AA everywhere in either theme — measured on the backgrounds the port actually draws: dark comment 3.59:1, doc comment 3.59, operator 3.77, regexp 3.97, string 4.09 on #3f3f3f; light number and heading 2.52:1 on white. The port keeps N++'s values rather than inventing a more accessible skin, and `scripts/test-themes.mjs` pins both sets by name so a future palette edit has to state its intent. One further difference: N++ sets the selected text's *foreground* in dark (000000 on 585858); CM6 paints its selection *behind* the text, so this port changes the selection background and leaves the token colour alone.",
  "View ▸ Zoom In / Zoom Out / Restore Default Zoom are not bound to keys. N++ binds them to the numeric keypad's +/- (its `winKeyDefs[]` table) and documents Ctrl+mouse wheel in the menu label; a browser owns Ctrl+wheel for page zoom unless the page cancels the gesture, and whether this one can be claimed here has not been measured — measuring first is this project's rule (see S6). The commands and their persistence work; only the binding is missing.",
  "N++ keeps a zoom per view (`zoom` and `zoom2`) plus a \"Synchronize Across Views\" switch, and groups the zoom commands in a `Zoom` submenu. This menu bar has no submenus, and one zoom for the whole app is what `zoomSync` means in N++ — the split's two panes are one document shown twice (S5), not two views with independent settings.",
  "The Toolbar preference's layout value names icon sets in N++ (its `config.xml` carries `standard`, `small`, `fluent` and a fluent colour); this port's toolbar is text, so the value spends itself on the button box instead. `visible` means what it means in N++.",
  "N++ opens a file it already has by activating the existing document — \"If we found the document, then we don't open the existing doc\" (`NppIO.cpp:306-330`) — but skips that check in snapshot mode. This port always activates: the backup belongs to the *document*, not to the file, so a second copy of the same file would have nothing to recover that the first one does not.",
  "A restored clone pane's own caret and scroll are not put back. N++ records a position per file per view (`startPos`/`endPos`/`firstVisibleLine`/`xOffset` in `mainView` and `subView`); this port records one position per document, because its split is the active document in two panes (S5) — the pane you left is the one that comes back.",
  // ── Task 8 (installable, offline) ─────────────────────────────────────────────────────────
  "There is no installer, no registry entry, no shell context menu and no file-type association: the app is installed by the browser itself (the manifest and the offline shell of Task 8), which gives it an icon, its own window and an entry in the OS's application list. `file_handlers` is deliberately *not* declared, so double-clicking a `.txt` never opens it here — docs/scope.md §5 lists Chrome's File Handling API with an \"upload / drag-drop\" fallback and this port builds neither; a file is opened with File ▸ Open, in the installed app as in the tab.",
  "There is no portable mode. N++ can be carried on a USB stick with `config.xml`, `session.xml` and its `backup/` folder beside the executable; this port's equivalents live in the browser's storage for the origin (IndexedDB and OPFS, Task 7), which is not a folder a user can carry. The offline shell caches the *application*, not the configuration and not the documents — `docs/offline-pwa.md` records what that does and does not buy, including the measured result of fusing everything into one HTML file.",
  "Offline is not the same thing as local. N++ runs with no network because everything it needs is already on the disk; this port needs one load with a connection (or an install) before it can start without one, and a language that was never opened while online stays unavailable until there is a connection again — the worker precaches the shell and caches a language chunk the first time the app fetches one, which by definition cannot cover a language nobody opened. The app says so where it happens rather than showing an unhighlighted document in silence, and offers the one remedy that works (a reload, measured: `docs/offline-pwa.md`).",
];
