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
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
} from "@codemirror/language";

/* ------------------------------------------------------------------ defaults */

/** stylers.model.xml → GlobalStyles/"Default Style": fontName="Courier New" fontSize="10". */
export const NPP_FONT_FAMILY =
  '"Courier New", Courier, "DejaVu Sans Mono", ui-monospace, monospace';
export const NPP_FONT_SIZE = "10pt";

/** Parameters.h: `int _tabSize = 4;` and `bool _tabReplacedBySpace = false;` (NppGUI). */
export const NPP_TAB_SIZE = 4;
export const NPP_INDENT_UNIT = "\t";

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
} as const;

/* -------------------------------------------------------------------- theme */

export const nppTheme: Extension = EditorView.theme(
  {
    "&": {
      color: NPP_COLORS.foreground,
      backgroundColor: NPP_COLORS.background,
      fontSize: NPP_FONT_SIZE,
      height: "100%",
    },
    ".cm-scroller": { fontFamily: NPP_FONT_FAMILY },
    ".cm-content": { fontFamily: NPP_FONT_FAMILY, caretColor: NPP_COLORS.caret },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: NPP_COLORS.caret,
      borderLeftWidth: `${NPP_CARET_WIDTH}px`,
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: NPP_COLORS.selection,
    },
    ".cm-activeLine": { backgroundColor: NPP_COLORS.activeLine },
    ".cm-gutters": {
      backgroundColor: NPP_COLORS.gutterBackground,
      color: NPP_COLORS.gutterForeground,
      border: "none",
    },
    ".cm-activeLineGutter": {
      backgroundColor: NPP_COLORS.activeLine,
      color: NPP_COLORS.foreground,
    },
    ".cm-foldGutter": { backgroundColor: NPP_COLORS.foldMarginBackground },
    ".cm-foldGutter .cm-gutterElement": { color: NPP_COLORS.gutterForeground },
    ".cm-foldPlaceholder": {
      backgroundColor: NPP_COLORS.gutterBackground,
      border: "none",
      color: NPP_COLORS.gutterForeground,
    },
    ".cm-matchingBracket": {
      color: NPP_COLORS.braceHighlight,
      backgroundColor: "transparent",
      fontWeight: "bold",
    },
    ".cm-nonmatchingBracket": {
      color: NPP_COLORS.badBrace,
      backgroundColor: "transparent",
    },
  },
  { dark: false },
);

/* ------------------------------------------------------------------ keymaps */

/**
 * Keys N++ binds that a web page cannot have, and the free key each is mapped to.
 * Chrome handles these itself (new window/tab, close tab, switch tab), so no page
 * can repurpose them — see docs/r2-shared-state-spike.md notes and
 * DEVIATIONS_FROM_NPP below.
 */
export const WEB_PORT_KEYS = {
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

export function wordWrapExtension(on: boolean): Extension {
  return on ? EditorView.lineWrapping : [];
}

export interface EditorCoreOptions {
  wordWrap?: boolean;
}

/**
 * The explicit replacement for `basicSetup` (Task 3 step 1): only extensions this
 * editor actually wants, each one corresponding to an N++ default.
 *
 * Deliberately absent, with the reason:
 *   - `syntaxHighlighting` — Task 6 owns highlighting and language modes;
 *   - `autocompletion` / `closeBrackets` — N++ opens word completion on demand
 *     (Ctrl+Space), it is not automatic; unassigned task, see docs/scope.md tiers;
 *   - the search keymap — Task 5 owns find/replace.
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
    // N++ has a fold margin in the default style.
    foldGutter(),
    history(),
    drawSelection(),
    dropCursor(),
    // N++ column/rectangular selection (Alt+drag) needs multiple selections.
    EditorState.allowMultipleSelections.of(true),
    rectangularSelection(),
    crosshairCursor(),
    indentOnInput(),
    bracketMatching(),
    EditorState.tabSize.of(NPP_TAB_SIZE),
    indentUnit.of(NPP_INDENT_UNIT),
    nppTheme,
    wordWrapCompartment.of(wordWrapExtension(wordWrap)),
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
  "Indent guides: N++ shows them (`_indentGuideLineShow = true`, colour c0c0c0). CM6 core has no indent-guide extension — it needs a third-party package or a custom line-decoration plugin. Colour is reserved in NPP_COLORS.indentGuide.",
  "Vertical edge: N++'s `Edge colour` (80ffff) marker at the wrap column is not drawn; it needs a custom decoration plugin.",
  "Keyboard: N++'s New / Close / next-tab keys are Ctrl+N, Ctrl+W, Ctrl+Tab — all owned by the browser and not interceptable by a page. Mapped to Alt+N, Alt+W, Alt+PageDown/Alt+PageUp (WEB_PORT_KEYS).",
  "INS/OVR: N++ has an overwrite mode; CM6 has no overwrite state, so the status bar carries no INS/OVR field.",
  "Bracket matching: N++ colours a matched pair red+bold (`Brace highlight style`) and an unmatched one dark red (`Bad brace colour`); both are themed to those colours, but the rendering is not pixel-identical.",
  "Mixed per-line EOL: CM6 normalises to one line separator (risk R3 in docs/scope.md) — the status bar reports the document's single separator, as designed there.",
];
