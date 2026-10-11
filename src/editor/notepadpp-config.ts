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

import { nppHighlighting } from "../languages/highlight";
import { bookmarkField, bookmarkMarginCompartment, bookmarkMarginExtension } from "../search/bookmarks";
import { markField } from "../search/find-replace";
import { fontSizeForZoom, type ThemeName } from "../storage/preferences";
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

/** stylers.model.xml → GlobalStyles. Names are N++'s own. */
export const NPP_COLORS = {
  foreground: "#000000", // Default Style fgColor
  background: "#ffffff", // Default Style bgColor
  activeLine: "#e8e8ff", // Current line background colour
  selection: "#c0c0c0", // Selected text colour
  caret: "#8000ff", // Caret colour
  gutterBackground: "#e4e4e4", // Line number margin bgColor
  gutterForeground: "#808080", // Line number margin fgColor
  foldMarginBackground: "#e9e9e9", // Fold margin bgColor
  foldActive: "#ff0000", // Fold active fgColor
  braceHighlight: "#ff0000", // Brace highlight style fgColor (fontStyle 1 = bold)
  badBrace: "#800000", // Bad brace colour
  indentGuide: "#c0c0c0", // Indent guideline style
  whitespaceSymbol: "#ffb56a", // White space symbol
  smartHighlight: "#00ff00", // Smart Highlighting
  edge: "#80ffff", // Edge colour
  markStyle1: "#00ffff", // Mark Style 1 — the colour of the "Find Mark style" (stylers.model.xml)
  bookmark: "#5f7bd7", // bookmark14, the marker bitmap: centre pixel (rgba_icons.h)
} as const;

/* -------------------------------------------------------------------- theme */

/**
 * A theme is a palette plus the two facts the rest of the app needs about it. There is one
 * today (N++'s own stylers.model.xml colours, which is what the app has always drawn); the
 * second — N++'s Dark Mode, a Tier-1 row in `docs/scope.md` that no task has built yet — is a
 * palette here and one more entry in `THEMES`, which is why the shape is a map rather than a
 * bare constant. Until then the theme preference is stored and applied, and its only value is
 * the honest one. Recorded in `DEVIATIONS_FROM_NPP`.
 */
interface NppPalette {
  readonly dark: boolean;
  readonly colors: typeof NPP_COLORS;
}

export const PALETTES: Record<ThemeName, NppPalette> = {
  notepadpp: { dark: false, colors: NPP_COLORS },
};

/** What a theme name this build does not know falls back to. */
const DEFAULT_PALETTE: NppPalette = { dark: false, colors: NPP_COLORS };

/** The editor's look at a given zoom and theme — what `editorLookCompartment` holds. */
export function nppEditorLook(options: { zoom?: number; theme?: ThemeName } = {}): Extension {
  const palette = (options.theme && PALETTES[options.theme]) || DEFAULT_PALETTE;
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
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: colors.selection,
      },
      ".cm-activeLine": { backgroundColor: colors.activeLine },
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
 * Task 7. The editor's look — N++'s colours at the current zoom. A preference is not a
 * preference until it changes something, so zoom and theme are applied through this compartment
 * on every live view, the same way word wrap and the language are.
 */
export const editorLookCompartment = new Compartment();

/**
 * Task 6. The language's extension, swapped with `reconfigure` when a document's language is
 * known — including *after* the document is mounted, because loading a language is async and
 * a file must open immediately.
 */
export const languageCompartment = new Compartment();

export function wordWrapExtension(on: boolean): Extension {
  return on ? EditorView.lineWrapping : [];
}

export interface EditorCoreOptions {
  wordWrap?: boolean;
  /** N++ shows the bookmark margin by default (Parameters.h:902 `_bookMarkMarginShow = true`). */
  bookmarkMargin?: boolean;
  /** The document's loaded language support, if it has one and it has arrived. */
  language?: Extension;
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
    // Task 6: N++'s token colours, plus the document's own language (empty until it loads).
    nppHighlighting,
    languageCompartment.of(options.language ?? []),
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
  "The language is chosen by extension, by a few well-known file names and, failing both, by N++'s own content rule (`FileManager::detectLanguageFromTextBeginning`). N++'s Language menu is not built yet, so there is no way to *override* the choice from the UI: an extensionless scratch buffer stays \"Normal text file\" until it is saved with a name.",
  "makefile, batch/.bat, INI, JSON5, GraphQL, Kotlin-in-N++-terms and MATLAB-in-N++-terms have no CM6 mode anywhere. They open as \"Normal text file\" — highlighting them would mean writing a StreamLanguage by hand, which D9 did not require and the plan left as an open question. (C#, Kotlin, Scala and Objective-C *are* covered: `legacy-modes/mode/clike.js` exports parsers for them.)",
  "The 113 legacy `StreamLanguage` ports highlight but do not fold: a stream parser produces tokens, not a syntax tree, so `foldable()` reports nothing and the overview ruler shows no structure ticks for them. That is the trade D9 accepted in exchange for the long tail.",
  "N++ renders a `.vue` file with its JavaScript lexer (`langs.model.xml`: ext=\"js jsm jsx mjs vue\"); this port uses the Vue grammar, which is strictly better, and hands `.jsx`/`.tsx` to the JSX/TSX variants of the JavaScript grammar for the same reason.",
  "Extension and file-name detection is a deliberate addition to N++'s rule — N++ decides by extension alone, so a `Makefile` or a `Dockerfile` is \"Normal text file\" there unless the user picks the language. The recognised names are in `src/languages/registry.ts` (FILENAMES).",
  // ── Task 7 (session, backups, preferences) ────────────────────────────────────────────────
  "The session lives in IndexedDB and the bodies of unsaved documents in an OPFS `backup/` directory, not in `%APPDATA%\\\\Notepad++\\\\session.xml` and `backup\\\\`. The *fields* and the *rules* are N++'s (including its `FILENAME@YYYY-MM-DD_HHMMSS` backup names); the storage is what a page has instead of a user directory. A consequence worth stating: N++ users can copy session.xml aside as a backup, and this port cannot hand out its storage — the protection it offers instead is `navigator.storage.persist()` plus the snapshot interval.",
  "A reload is not a close. N++ can ask before quitting and therefore cannot lose unsaved edits by surprise; a page cannot stop a reload, and the browser may do it on its own (a crash, a mobile tab eviction). What this port does instead: it snapshots every dirty document on N++'s own interval, and when a reload happens with that protection switched off it says so, by name, rather than opening the file and letting the edits disappear quietly.",
  "N++'s Preferences ▸ MISC is a page of checkboxes; this port's Settings ▸ Preferences… carries only the settings it actually has (the session and snapshot group, the toolbar, the theme and the zoom). Style Configurator, Shortcut Mapper and the Import submenu are not built — they exist in N++ because it has style files and a Win32 shortcut table, neither of which a page has.",
  "The theme preference has exactly one value, Notepad++'s own light palette. N++'s Dark Mode (a Tier 1 row in docs/scope.md that no task has claimed) is not built: `PALETTES` in `notepadpp-config.ts` takes a second palette and `THEMES` a second name, and the store and the compartment are already theme-agnostic — but a dark skin is a feature, not a preference, and it is not in this task.",
  "View ▸ Zoom In / Zoom Out / Restore Default Zoom are not bound to keys. N++ binds them to the numeric keypad's +/- (its `winKeyDefs[]` table) and documents Ctrl+mouse wheel in the menu label; a browser owns Ctrl+wheel for page zoom unless the page cancels the gesture, and whether this one can be claimed here has not been measured — measuring first is this project's rule (see S6). The commands and their persistence work; only the binding is missing.",
  "N++ keeps a zoom per view (`zoom` and `zoom2`) plus a \"Synchronize Across Views\" switch, and groups the zoom commands in a `Zoom` submenu. This menu bar has no submenus, and one zoom for the whole app is what `zoomSync` means in N++ — the split's two panes are one document shown twice (S5), not two views with independent settings.",
  "The Toolbar preference's layout value names icon sets in N++ (its `config.xml` carries `standard`, `small`, `fluent` and a fluent colour); this port's toolbar is text, so the value spends itself on the button box instead. `visible` means what it means in N++.",
  "N++ opens a file it already has by activating the existing document — \"If we found the document, then we don't open the existing doc\" (`NppIO.cpp:306-330`) — but skips that check in snapshot mode. This port always activates: the backup belongs to the *document*, not to the file, so a second copy of the same file would have nothing to recover that the first one does not.",
  "A restored clone pane's own caret and scroll are not put back. N++ records a position per file per view (`startPos`/`endPos`/`firstVisibleLine`/`xOffset` in `mainView` and `subView`); this port records one position per document, because its split is the active document in two panes (S5) — the pane you left is the one that comes back.",
];
