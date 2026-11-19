/**
 * The orchestrator: it ties the pieces together.
 *
 *   chrome.ts             pure-DOM shell (menu bar, toolbar, panes, tab strips, status bar)
 *   tabs.ts               document model (dirty flag, save point, tab captions)
 *   notepadpp-config.ts   Notepad++ defaults: states, theme, keymaps
 *   split-view.ts         two views over one document with one undo history
 *   ../file/file-io.ts    the whole file lifecycle (Task 4)
 *
 * It is the only module that mutates documents, so the chrome stays free of
 * editor state and `tabs.ts` stays free of DOM.
 *
 * ── The split model, stated plainly ──────────────────────────────────────────
 * Split view shows the *active document* in two panes (Notepad++'s "clone to
 * other view"). Both panes therefore show the same document, edits appear in
 * both, and there is one undo history — `views[0]` owns it. Notepad++'s other
 * flavour of split — each pane carrying its own independent tab set — is Tier 2
 * in `docs/scope.md` and is deliberately not built here.
 *
 * ── File I/O (Task 4, decisions D3/D4) ───────────────────────────────────────
 * Every open/save goes through `file-io.ts`; this class only decides *when* and
 * what to tell the user. Two rules from that module's contract are easy to break
 * from up here, so they are stated where they are used:
 *   - a picker must be called synchronously from a user gesture, so nothing may
 *     `await` before it — that is why the click handlers below call straight into
 *     `openFile()` / `saveFile()` rather than after any setup;
 *   - a dismissed picker is a cancel, not a failure, so a `null` handle returns
 *     quietly and only real errors reach a dialog.
 *
 * Keyboard: `WEB_PORT_KEYS` because Chrome owns Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+W
 * and no page can intercept them (recorded in `DEVIATIONS_FROM_NPP`).
 */
import { EditorView, keymap } from "@codemirror/view";
import { Text, type EditorState, type Extension } from "@codemirror/state";
import {
  foldEffect,
  foldable,
  foldedRanges,
  indentUnit,
  unfoldEffect,
} from "@codemirror/language";

import {
  canEncode,
  encodeFile,
  pickFileToOpen,
  pickFileToSave,
  readHandle,
  toEditorLineEndings,
  toFileLineEndings,
  writeHandle,
} from "../file/file-io";
import { ensureAccess, forgetRecent, hasAccessWithoutAsking, listRecent, rememberRecent } from "../file/recent-files";
import type { RecentFile } from "../file/recent-files";
import type { DocumentFormat } from "../file/types";
import { detectLanguage, languageStats, languagesByName, PLAIN_TEXT, byId } from "../languages/registry";
import type { LanguageDefinition } from "../languages/registry";
import { detectCapabilities, unsupportedNotice } from "../platform/capabilities";
import {
  deleteBackup,
  listBackups,
  pruneBackups,
  readBackup,
  writeBackup,
} from "../storage/backup-store";
import { requestPersistentStorage, type PersistenceStatus } from "../storage/persistent-storage";
import {
  NPP_PREFERENCES,
  clampZoom,
  loadPreferences,
  savePreferences,
  type Preferences,
} from "../storage/preferences";
import {
  emptySession,
  lineNumbersToOffsets,
  lineStartOffset,
  loadSessionRecord,
  nextUntitledNumber,
  offsetToLine,
  offsetsToLineNumbers,
  restoreOutcome,
  saveSessionRecord,
  type SessionFile,
  type SessionPosition,
  type SessionRecord,
  type SessionSelection,
} from "../storage/session-store";

import { Chrome, type MenuEntry, type PaneElements, type TabDescriptor } from "./chrome";
import {
  bookmarkLines,
  clearBookmarks as clearAllBookmarks,
  bookmarkMarginCompartment,
  bookmarkMarginExtension,
  bookmarkPositions,
  bookmarkedLines,
  copyBookmarks,
  gotoBookmark,
  setBookmarksEffect,
  toggleBookmark,
} from "../search/bookmarks";
import {
  FindReplaceDialog,
  copyMarks,
  markCount,
  openGoToDialog,
  type SearchHost,
  type SearchTab,
} from "../search/find-replace";
import {
  NPP_BOOKMARK_MARGIN,
  NPP_WORD_WRAP,
  PALETTES,
  SEARCH_KEYS,
  WEB_PORT_KEYS,
  createCloneState,
  createDocumentState,
  editorLookCompartment,
  highlightCompartment,
  languageCompartment,
  nppEditorLook,
  nppKeymap,
  pluginCompartment,
  tokenColoursFor,
  wordWrapCompartment,
  wordWrapExtension,
  type NppCommandHandlers,
} from "./notepadpp-config";
import { nppHighlighting } from "../languages/highlight";
import { refreshStructure, rulerCounts, type RulerCounts } from "./overview-ruler";
import { openPreferencesDialog } from "./preferences-dialog";
import {
  createDocumentRuntime,
  makeSyncDispatcher,
  ownerView,
  registerView,
  unregisterView,
} from "./split-view";
import { backAtSavePoint, newDocumentName, tabLabel, type OpenDocument } from "./tabs";
import { PluginRegistry, type RegisteredButton } from "../plugins/registry";
import { PluginLoader } from "../plugins/loader";
import { PluginDock } from "../plugins/panels";
import { openPluginManager } from "../plugins/manager-dialog";
import { createPluginContext, type WorkspaceBridge } from "../plugins/host";
import { listPlugins } from "../plugins/store";
import type { DocumentInfo, PluginEventType, UiApi } from "../plugins/api";
import type { PluginRecord } from "../plugins/model";
import { toKeymapKey } from "../plugins/model";

/** What a scratch buffer claims until it is given a file of its own. */
const DEFAULT_FORMAT: DocumentFormat = { encoding: "utf-8", bom: "none", eol: "LF" };

/** Shown in the first document so a fresh clone explains what it can do. */
const WELCOME = `Notepad++ Web — Task 7

Multi-document tabs, Notepad++'s editor defaults, split view, real files,
search, 140 languages, and now a session: tabs, carets, bookmarks and folds come
back the way you left them, unsaved work included.

Keys (the N++ ones are deliberately different — see below):
  Alt+N          new document          Alt+O   open a file
  Alt+S          save                  Alt+Shift+S  save as
  Alt+W          close document        Alt+C   clone this document to a second pane
  Alt+PageUp     previous document     Alt+PageDown  next document
  Alt+Z          toggle word wrap      Ctrl+Z / Ctrl+Y  undo / redo
  Tab            indent by a real tab character

  Alt+F          Find...               Ctrl+H  Replace...   Ctrl+M  Mark...
  F3 / Shift+F3  find next / previous  Ctrl+G  Go to line...
  Ctrl+F2        toggle bookmark       F2 / Shift+F2  next / previous bookmark

Why not Ctrl+N/O/S/W, and not Ctrl+F either? Chrome owns them (new window, open,
save page, close tab, find bar) and no web page may intercept them, so the
substitutes move to Alt. Which keys a page *can* claim here was measured rather
than assumed — see scripts/probe-reserved-keys.py and DEVIATIONS_FROM_NPP.

Files are read and written with the File System Access API, which is what makes
a byte-identical round-trip possible: the encoding, byte-order mark and line
endings a file arrives with are the ones it is saved with, unless you change
them. Nothing here talks to a server — there is no backend at all (decision D1).

Settings ▸ Preferences holds what N++ keeps in config.xml: the session and
snapshot behaviour, the toolbar, the theme and the zoom. Reload this page and the
session comes back — including documents you never saved, which are snapshotted
into backup/ while they are dirty, exactly as Notepad++ does.
`;

export class Workspace {
  /** Key handlers live in a field so states created later close over them. */
  readonly #handlers: NppCommandHandlers = {
    newDocument: () => {
      this.newDocument();
      return true;
    },
    openFile: () => {
      void this.openFile();
      return true;
    },
    saveFile: () => {
      void this.saveFile();
      return true;
    },
    saveFileAs: () => {
      void this.saveFile({ forceDialog: true });
      return true;
    },
    closeDocument: () => {
      this.#closeActive();
      return true;
    },
    nextDocument: () => {
      this.#activateRelative(1);
      return true;
    },
    previousDocument: () => {
      this.#activateRelative(-1);
      return true;
    },
    toggleWordWrap: () => this.toggleWordWrap(),
    cloneToOtherView: () => {
      this.toggleSplit();
      return true;
    },
    find: () => {
      this.openSearch("find");
      return true;
    },
    replace: () => {
      this.openSearch("replace");
      return true;
    },
    mark: () => {
      this.openSearch("mark");
      return true;
    },
    findNext: () => this.#find.findNext(),
    findPrevious: () => this.#find.findPrevious(),
    gotoLine: () => {
      openGoToDialog({ target: () => this.#focusView() });
      return true;
    },
    toggleBookmark: () => this.#toggleBookmark(),
    nextBookmark: () => this.#gotoBookmark(true),
    previousBookmark: () => this.#gotoBookmark(false),
  };

  /**
   * Task 5's dialog — one instance for the whole app, like N++'s single Find window. It stays
   * alive when closed so F3 keeps working from the last search, which is what N++ does.
   */
  readonly #find: FindReplaceDialog;

  readonly #chrome: Chrome;
  readonly #primary: PaneElements;
  /* ─────────────────────────────────────────────── P4 (D5): plugins ── */
  /** What plugins registered; the registry owns disposal. */
  readonly #pluginRegistry: PluginRegistry;
  /** Loads plugin modules from their stored source. */
  readonly #plugins: PluginLoader;
  /** The right-hand dock a plugin's panel appears in (P5). */
  readonly #dock: PluginDock;
  /** Toolbar buttons plugins added, by their `plugin:<plugin>:<id>` key. */
  readonly #pluginButtons = new Set<string>();
  /** Installed records, cached for `inspect()` and the (P6) manager. */
  #pluginRecords: PluginRecord[] = [];
  /** One `document:changed` per burst of typing, like the session write. */
  #pluginChangeTimer: number | null = null;
  /** True when this page was opened with `?plugins=off`. */
  readonly #pluginsDisabled: boolean;
  /** True once `start()` reported that it skipped loading (same flag, after start). */
  #pluginsSkipped = false;
  #bookmarkMargin = NPP_BOOKMARK_MARGIN;
  readonly #capabilities = detectCapabilities();
  #secondary: PaneElements | null = null;
  #disposeSplitterDrag: (() => void) | null = null;

  readonly #documents: OpenDocument[] = [];
  #activeId: string | null = null;
  #nextDocumentNumber = 0;
  /**
   * Document ids come from one monotonic counter, and nothing else. They used to be built from the
   * document count and the `new N` number, which is not unique: a document that is *removed* — the
   * welcome buffer a restore discards, or any closed tab — puts the count back where it was, and the
   * `new N` counter does not move when a file is opened. Task 7's restore made that reachable, and
   * the collision showed up exactly as it would in use: `#show()` saw an id it was already showing,
   * returned early, and the file that had just been opened never came to the front.
   */
  #nextDocumentId = 0;
  #split = false;
  #lastStatusSignature = "";
  /**
   * File ▸ Recent renders synchronously and IndexedDB does not, so the list is
   * cached here and refreshed on startup and after every open or save. A file
   * changed in another tab therefore appears after the next refresh rather than
   * instantly — an acceptable lag for a convenience list.
   */
  #recent: RecentFile[] = [];

  /* ─────────────────────────────── Task 7: what the app remembers between reloads ── */

  /** N++'s `config.xml` GUIConfigs, as this port's preferences (`src/storage/preferences.ts`). */
  #preferences: Preferences = { ...NPP_PREFERENCES };
  /**
   * Whether the origin's storage is exempt from eviction — risk R6's recorded mitigation. Read
   * by the acceptance check through `inspect()`, never assumed.
   */
  #persistence: PersistenceStatus = { supported: false, persisted: false, usage: null, quota: null };
  /**
   * One session write per burst of change, like N++ writing session.xml once rather than on every
   * keystroke. Flushed immediately on a tab switch, a close and `pagehide`.
   */
  #sessionTimer: number | null = null;
  /** The record last written (or restored), for `debugSession()` and the check's assertions. */
  #lastSession: SessionRecord | null = null;
  /** What the last restore did — the numbers the acceptance check asserts on. */
  #restore: RestoreReport = { complete: false, restored: 0, dropped: 0, placeholders: 0, unsavedLost: 0 };
  /** Pending snapshot writes, one per document, cleared when a document is closed. */
  #snapshotTimers = new Map<string, number>();
  /**
   * Restored positions waiting for a view to exist. A document that is not on screen has no view,
   * so its caret, marks and folds are applied when it is first mounted.
   */
  #pendingRestore = new Map<string, RestoreState>();
  /**
   * The last fold/bookmark set each live view was asked about — the signature a reconciliation
   * compares against, so that "changed" is what propagates rather than "differs". Keyed by view
   * (and weak, so a view that is destroyed is not held on to) because a freshly mounted clone
   * legitimately starts empty, and starting empty is not news for the other pane.
   */
  readonly #foldSignatures = new WeakMap<EditorView, string>();
  readonly #bookmarkSignatures = new WeakMap<EditorView, string>();
  /** A restore is in flight: document mutations must not race it. */
  #restoring = false;
  /**
   * Set when the user does something — opens a file, makes a document, closes one, turns the split
   * on — while a restore is still assembling the session. N++ never has this problem because it
   * restores before its window accepts input; a page cannot block, so the session puts the *tabs*
   * back and leaves the *front tab* to whoever got there first.
   */
  #userActedDuringRestore = false;
  #preferencesOpen = false;

  /* ───────────────────────────── Task 8: what an offline first load cannot have ── */

  /** Record that something happened outside the restore — see `#userActedDuringRestore`. */
  #noteUserAction(): void {
    if (this.#restoring) this.#userActedDuringRestore = true;
  }

  /**
   * A grammar whose chunk cannot be fetched. The precondition is ordinary rather than exotic
   * (Task 8): a language is cached the first time it is *opened*, so offline a document whose
   * language was never opened online simply has no grammar available. The status bar goes on
   * naming the language — that is N++'s own field, and the document is what the user opened —
   * so silence here would misreport what is on screen.
   *
   * **There is no in-page retry, because measurement says there cannot be one.** After the
   * connection returned, this app's own retry re-imported the language and failed again with
   * *no network request at all*: the failed module fetch (a shared Lezer chunk, preloaded by
   * Vite's import helper) stays memoised for the life of the document, so the same import path
   * keeps failing instantly. A reload gets a fresh module map, and the same document then loads
   * its grammar and paints — both measured, with `scripts/verify-task8.py` §6 as the re-runnable
   * form of the measurement. So the notice carries the remedy that works instead of promising
   * one that does not.
   */
  #noteLanguageUnavailable(language: LanguageDefinition): void {
    this.#chrome.showNotice(
      `${language.label} highlighting could not be loaded`,
      "The grammar is a file of its own, and this app had not cached it, so the document is " +
        "shown as plain text — the text, the editing and the saving are unaffected. The browser " +
        "will not fetch that file again in this page, so reload once there is a connection: the " +
        "highlighting comes back with it, and offline, only the languages opened while online " +
        "are available.",
      { kind: "language", action: { label: "Reload the page", onClick: () => location.reload() } },
    );
  }

  constructor(host: HTMLElement) {
    this.#pluginsDisabled = new URLSearchParams(location.search).get("plugins") === "off";
    this.#chrome = new Chrome(host);
    this.#primary = this.#chrome.addPane("primary", "before-splitter");
    this.#find = new FindReplaceDialog(this.#searchHost(), host);
    this.#pluginRegistry = new PluginRegistry({
      // The app's own bindings, in CodeMirror's notation, so a plugin cannot take
      // one of them. `model.ts` parses both notations — that bug is pinned there.
      knownKeys: [
        ...nppKeymap({}).map((binding) => binding.key),
        ...Object.values(WEB_PORT_KEYS),
        ...Object.values(SEARCH_KEYS),
      ].filter((key): key is string => typeof key === "string"),
      onCommandsChanged: () => this.#applyPluginExtensions(),
      onButtonsChanged: () => this.#syncPluginButtons(),
      onExtensionsChanged: () => this.#applyPluginExtensions(),
      onPanelsChanged: () => this.#dock.sync(),
    });
    this.#plugins = new PluginLoader({
      registry: this.#pluginRegistry,
      context: (record) =>
        createPluginContext({
          record,
          registry: this.#pluginRegistry,
          workspace: this.#pluginBridge(),
          ui: this.#pluginUi(),
        }),
      // The escape hatch for a plugin that breaks something at startup.
      disabled: this.#pluginsDisabled,
    });
    this.#dock = new PluginDock(this.#chrome.workspace, this.#pluginRegistry);
    this.#chrome.setDockElement(this.#dock.root);
    this.#addMenus();

    this.#chrome.addButton({
      id: "new",
      label: "New",
      title: `New document (${WEB_PORT_KEYS.newDocument})`,
      onClick: () => {
        this.newDocument();
        return false;
      },
    });
    this.#chrome.addButton({
      id: "open",
      label: "Open",
      title: `Open a file (${WEB_PORT_KEYS.openFile})`,
      onClick: () => {
        void this.openFile();
        return false;
      },
    });
    this.#chrome.addButton({
      id: "save",
      label: "Save",
      title: `Save this document (${WEB_PORT_KEYS.saveFile})`,
      onClick: () => {
        void this.saveFile();
        return false;
      },
    });
    this.#chrome.addButton({
      id: "close",
      label: "Close",
      title: `Close this document (${WEB_PORT_KEYS.closeDocument})`,
      onClick: () => {
        this.#closeActive();
        return false;
      },
    });
    this.#chrome.addButton({
      id: "wordwrap",
      label: "Wrap",
      title: `Word wrap (${WEB_PORT_KEYS.toggleWordWrap})`,
      onClick: () => this.toggleWordWrap(),
    });
    this.#chrome.addButton({
      id: "split",
      label: "Split",
      title: `Clone this document to a second pane (${WEB_PORT_KEYS.cloneToOtherView})`,
      onClick: () => {
        this.toggleSplit();
        return this.#split;
      },
    });
  }

  /**
   * Create the first document, restore the previous session over it, load the recent list, and
   * report a browser we cannot use.
   *
   * The first document is created **synchronously** on purpose. N++ opens an empty window and
   * fills it from `session.xml`; a page cannot afford the same blank beat — every acceptance
   * check since Task 2 reads the app the moment it loads. So the welcome buffer exists at once
   * and is discarded when the session turns out to have something to put in its place.
   */
  start(): void {
    const startup = this.newDocument(WELCOME);
    void this.#restoreSession(startup);
    void this.#refreshRecent();
    this.#installLifecycleHooks();
    // Not awaited: a plugin must never delay the first document, let alone the
    // session restore. Each one applies to the documents already open when it
    // activates (see `#applyPluginExtensions`).
    void this.#startPlugins();
    const notice = unsupportedNotice(this.#capabilities);
    if (notice) this.#chrome.showNotice(notice.title, notice.body);
  }

  /**
   * A page is not a process: there is no "exit", only the tab going away. N++ flushes the session
   * when it closes (`WM_ENDSESSION`); the browser equivalent is `pagehide` plus the tab becoming
   * hidden, which is also the last moment a write is likely to land (`visibilitychange` fires on
   * a mobile tab switch, where `pagehide` may not).
   */
  #installLifecycleHooks(): void {
    window.addEventListener("pagehide", () => void this.#flushSession());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void this.#flushSession();
    });
  }

  #addMenus(): void {
    this.#chrome.addMenus([
      {
        label: "File",
        // A function, not an array: the Recent section is rebuilt from the cache
        // each time the menu opens, so it reflects the most recent refresh.
        items: () => this.#fileMenu(),
      },
      {
        // N++'s Search menu (Notepad_plus.rc). "Find in Files", the Search Results window and
        // the Mark-style families are out of the MVP: see DEVIATIONS_FROM_NPP.
        label: "Search",
        items: [
          {
            id: "find",
            label: "Find…",
            shortcut: SEARCH_KEYS.find,
            onClick: () => this.openSearch("find"),
          },
          { id: "find-next", label: "Find Next", shortcut: SEARCH_KEYS.findNext, onClick: () => this.#find.findNext() },
          {
            id: "find-previous",
            label: "Find Previous",
            shortcut: SEARCH_KEYS.findPrevious,
            onClick: () => this.#find.findPrevious(),
          },
          {
            id: "replace",
            label: "Replace…",
            shortcut: SEARCH_KEYS.replace,
            onClick: () => this.openSearch("replace"),
          },
          { id: "mark", label: "Mark…", shortcut: SEARCH_KEYS.mark, onClick: () => this.openSearch("mark") },
          { id: "search-rule", separator: true },
          {
            id: "goto-line",
            label: "Go to…",
            shortcut: SEARCH_KEYS.gotoLine,
            onClick: () => openGoToDialog({ target: () => this.#focusView() }),
          },
          { id: "bookmark-rule", separator: true },
          {
            id: "toggle-bookmark",
            label: "Toggle Bookmark",
            shortcut: SEARCH_KEYS.toggleBookmark,
            onClick: () => void this.#toggleBookmark(),
          },
          {
            id: "next-bookmark",
            label: "Next Bookmark",
            shortcut: SEARCH_KEYS.nextBookmark,
            onClick: () => void this.#gotoBookmark(true),
          },
          {
            id: "previous-bookmark",
            label: "Previous Bookmark",
            shortcut: SEARCH_KEYS.previousBookmark,
            onClick: () => void this.#gotoBookmark(false),
          },
          {
            id: "clear-bookmarks",
            label: "Clear All Bookmarks",
            // N++ leaves this one unbound too (`winKeyDefs[]`: VK_NULL for IDM_SEARCH_CLEAR_BOOKMARKS).
            onClick: () => this.clearBookmarks(),
          },
        ],
      },
      {
        label: "View",
        items: [
          {
            id: "word-wrap",
            label: "Word Wrap",
            shortcut: WEB_PORT_KEYS.toggleWordWrap,
            onClick: () => this.toggleWordWrap(),
          },
          {
            id: "clone",
            label: "Clone to Other View",
            shortcut: WEB_PORT_KEYS.cloneToOtherView,
            onClick: () => this.toggleSplit(),
          },
          {
            // N++ keeps this in Settings ▸ Preferences ▸ Margins ("Display bookmark margin"), and
            // Task 5 put it here because there was no Settings menu yet. It stays: the toggle and
            // the preference dialog are two views of one setting, and the menu is the shorter path.
            id: "bookmark-margin",
            label: "Bookmark Margin",
            onClick: () => this.toggleBookmarkMargin(),
          },
          { id: "zoom-rule", separator: true },
          // N++ groups these in a View ▸ Zoom submenu and spells the binding in the label
          // ("Zoom In (Ctrl+Mouse Wheel Up)", Notepad_plus.rc:773-780). This menu bar has no
          // submenus yet, so they sit flat — and carry no binding, because Ctrl+wheel is the
          // browser's page zoom unless a page cancels the gesture, and that has not been measured
          // here. Measuring first is this project's rule (S6 is the standing example).
          { id: "zoom-in", label: "Zoom In", onClick: () => void this.zoomBy(1) },
          { id: "zoom-out", label: "Zoom Out", onClick: () => void this.zoomBy(-1) },
          { id: "zoom-restore", label: "Restore Default Zoom", onClick: () => void this.setZoom(0) },
        ],
      },
      {
        // N++'s Language menu sits between View and Settings (Notepad_plus.rc:998). Its list
        // is a function because the radio check follows the active document, which changes
        // without the menu bar itself changing.
        label: "Language",
        items: () => this.#languageMenu(),
      },
      {
        // N++'s Settings menu holds Preferences, Style Configurator, Shortcut Mapper and Import.
        // Only the first has anything behind it here: the other three exist in N++ because it has
        // style files and a Win32 shortcut table, neither of which this port has.
        label: "Settings",
        items: [
          {
            id: "preferences",
            label: "Preferences…",
            onClick: () => void this.openPreferences(),
          },
        ],
      },
      {
        // D5/P4: one entry per command a plugin registered, in activation order.
        // Placed where N++ puts Plugins — late in the bar, after Settings (its own
        // order is File … Language, Settings, Tools, Macro, Run, Plugins, Window) —
        // and a function like File and Language, because enabling a plugin while
        // the app is open changes the list without rebuilding the menu bar.
        label: "Plugins",
        items: () => this.#pluginMenu(),
      },
    ]);
  }

  /** N++ File menu: the commands, then a rule, then the recent files. */
  #fileMenu(): MenuEntry[] {
    const entries: MenuEntry[] = [
      { id: "new", label: "New", shortcut: WEB_PORT_KEYS.newDocument, onClick: () => this.newDocument() },
      { id: "open", label: "Open…", shortcut: WEB_PORT_KEYS.openFile, onClick: () => void this.openFile() },
      { id: "save", label: "Save", shortcut: WEB_PORT_KEYS.saveFile, onClick: () => void this.saveFile() },
      {
        id: "save-as",
        label: "Save As…",
        shortcut: WEB_PORT_KEYS.saveFileAs,
        onClick: () => void this.saveFile({ forceDialog: true }),
      },
      { id: "close", label: "Close", shortcut: WEB_PORT_KEYS.closeDocument, onClick: () => this.#closeActive() },
    ];

    if (this.#recent.length > 0) {
      entries.push({ id: "recent-rule", separator: true });
      for (const entry of this.#recent) {
        entries.push({
          id: `recent:${entry.name}`,
          label: entry.name,
          onClick: () => void this.openRecent(entry.name),
        });
      }
    }

    return entries;
  }

  /**
   * N++'s Language menu: "None (Normal Text)" (Notepad_plus.rc:1000), a rule, then the
   * languages grouped under their first letter — N++'s compact form
   * (`_isLangMenuCompact`, `Notepad_plus.cpp:583-635`) — with a radio check on the one
   * the active document is using (`CheckMenuRadioItem`, `Notepad_plus.cpp:2965`).
   *
   * Inside a group the order is N++'s short name, case-insensitively (`languagesByName()`),
   * rather than copying the rc's hand-maintained `IDM_LANG_*` order (nearly alphabetical,
   * but CSound precedes CoffeeScript and Shell precedes Scheme) — the same call S9 made
   * about extension collisions. N++'s UDL entries at the bottom of the menu are absent
   * because UDL is unscheduled (D10); that is in DEVIATIONS_FROM_NPP.
   */
  #languageMenu(): MenuEntry[] {
    const current = this.#active()?.language?.id ?? null;
    const entries: MenuEntry[] = [
      {
        id: "lang-none",
        label: "None (Normal Text)",
        checked: current === null,
        onClick: () => void this.setLanguage(null),
      },
      { id: "lang-rule", separator: true },
    ];
    const groups = new Map<string, MenuEntry[]>();
    for (const language of languagesByName()) {
      const letter = language.name.charAt(0).toUpperCase();
      const group = groups.get(letter) ?? [];
      group.push({
        id: `lang-${language.id}`,
        label: language.name,
        checked: current === language.id,
        onClick: () => void this.setLanguage(language.id),
      });
      groups.set(letter, group);
    }
    for (const [letter, submenu] of groups) {
      entries.push({ id: `lang-group-${letter.toLowerCase()}`, label: letter, submenu });
    }
    return entries;
  }

  async #refreshRecent(): Promise<void> {
    this.#recent = await listRecent();
  }

  /* ------------------------------------------------------------ documents */

  /** Open a new document and switch to it (N++ File ▸ New). */
  newDocument(content = ""): OpenDocument {
    this.#noteUserAction();
    this.#nextDocumentNumber += 1;
    const document = this.#createDocument(newDocumentName(this.#nextDocumentNumber), content);
    this.#documents.push(document);
    this.#emitPluginEvent("document:opened", document);
    this.#show(document.id);
    return document;
  }

  get documents(): readonly OpenDocument[] {
    return this.#documents;
  }

  get active(): OpenDocument | null {
    return this.#active();
  }

  get isSplit(): boolean {
    return this.#split;
  }

  /** Views showing the active document: 1, or 2 while split. */
  get viewCount(): number {
    return this.#active()?.runtime.views.length ?? 0;
  }

  /** The live owner view of the active document, if it is mounted. */
  get activeView(): EditorView | null {
    const document = this.#active();
    if (!document) return null;
    return ownerView(document.runtime) ?? null;
  }

  /**
   * Dev/verification handle — the numbers `scripts/verify-task*.py` assert on.
   * Read-only; exposed on `window.__workspace` in dev builds.
   */
  inspect(): {
    documents: number;
    tabs: string[];
    activeName: string | null;
    activeFileName: string | null;
    dirty: boolean;
    wordWrap: boolean;
    split: boolean;
    views: number;
    tabSize: number | null;
    indentUnit: string | null;
    text: string | null;
    /** Each live view's text, in creation order: [primary, clone]. */
    viewTexts: string[];
    fontSize: string | null;
    fontFamily: string | null;
    encoding: string | null;
    eol: string | null;
    assumedEncoding: boolean;
    canEncode: boolean | null;
    fileSystemAccess: boolean;
    menuTitles: string[];
    recentFiles: string[];
    /** Task 5's search state — what `scripts/verify-task5.py` asserts on. */
    search: {
      open: boolean;
      tab: SearchTab;
      status: string;
      query: string;
      replace: string;
      mode: string;
      matchCase: boolean;
      wholeWord: boolean;
      wrapAround: boolean;
      backwards: boolean;
      dotMatchesNewline: boolean;
      inSelection: boolean;
      marks: number;
    };
    /** Bookmarked line numbers, 1-based (N++'s margin marks lines, not positions). */
    bookmarks: number[];
    bookmarkMargin: boolean;
    /** Task 6 — what `scripts/verify-task6.py` asserts on. */
    language: {
      id: string;
      name: string;
      label: string;
      firstClass: boolean;
      origin: string;
      /** true once the lazy import has resolved and the grammar is in the state. */
      loaded: boolean;
    } | null;
    /** The registry's own counts, measured from it rather than asserted. */
    languages: ReturnType<typeof languageStats>;
    /** The overview ruler's tick counts for the active view. */
    ruler: RulerCounts | null;
    /** Folded ranges per live view, in creation order — the panes must agree (Task 6). */
    viewFolds: number[];
    /** Task 7 — the preferences in force, and what `scripts/verify-task7.py` asserts on. */
    preferences: Preferences;
    /** The restore's own report: how many documents came back, and how they came back. */
    session: RestoreReport & {
      /** Files in the record last written this run (0 = nothing written yet). */
      written: number;
      /** The tab the session says was in front. */
      activeIndex: number;
      /** True when the split is part of the session. */
      split: boolean;
    };
    /** Risk R6's mitigation, as the browser answered it — never assumed. */
    persistence: PersistenceStatus;
    zoom: number;
    toolbar: { visible: boolean; layout: string };
    /** The active document: N++'s `userReadOnly`, its placeholder state, and its backup. */
    readOnly: boolean;
    inaccessible: boolean;
    backupPath: string | null;
    /** Which pane has the focus: 0 = primary, 1 = the clone (N++'s `Session activeView`). */
    focusedPane: number;
    /** P4 — what the plugin host holds; the manager (P6) and the acceptance check read this. */
    plugins: {
      installed: {
        id: string;
        name: string;
        version: string;
        enabled: boolean;
        error: string | null;
      }[];
      active: string[];
      commands: number;
      panels: number;
      buttons: number;
      errors: Record<string, string>;
      skipped: boolean;
    };
  } {
    const document = this.#active();
    const views = document?.runtime.views ?? [];
    const owner = document ? ownerView(document.runtime) : undefined;
    // Marks and bookmarks live in a view's state; with nothing mounted the document still
    // carries the state it was last left in, so the numbers stay truthful either way.
    const state = owner?.state ?? document?.state;
    return {
      documents: this.#documents.length,
      tabs: this.#documents.map(tabLabel),
      activeName: document?.name ?? null,
      activeFileName: document?.handle?.name ?? null,
      dirty: document?.dirty ?? false,
      wordWrap: document?.wordWrap ?? false,
      split: this.#split,
      views: document?.runtime.views.length ?? 0,
      viewTexts: (document?.runtime.views ?? []).map((view) => view.state.doc.toString()),
      tabSize: owner ? owner.state.tabSize : null,
      indentUnit: owner ? owner.state.facet(indentUnit) : null,
      text: owner ? owner.state.doc.toString() : null,
      // nppTheme sets the size on `&` (.cm-editor) but the N++ font family on
      // .cm-scroller/.cm-content, so the two must be read from different nodes.
      fontSize: owner ? getComputedStyle(owner.dom).fontSize : null,
      fontFamily: owner ? getComputedStyle(owner.contentDOM).fontFamily : null,
      encoding: document ? document.format.encoding : null,
      eol: document ? document.format.eol : null,
      assumedEncoding: document?.assumedEncoding ?? false,
      canEncode: document ? canEncode(document.format.encoding) : null,
      fileSystemAccess: this.#capabilities.fileSystemAccess,
      menuTitles: [...this.#chrome.menuBar.querySelectorAll(".npp-menu-title")].map(
        (node) => node.textContent ?? "",
      ),
      recentFiles: this.#recent.map((entry) => entry.name),
      search: {
        open: this.#find.open,
        tab: this.#find.tab,
        status: this.#find.status,
        ...this.#find.options,
        marks: state ? markCount(state) : 0,
      },
      bookmarks: state ? bookmarkedLines(state) : [],
      bookmarkMargin: this.#bookmarkMargin,
      language: document?.language
        ? {
            id: document.language.id,
            name: document.language.name,
            label: document.language.label,
            firstClass: document.language.firstClass,
            origin: document.language.origin,
            loaded: document.languageExtension !== undefined,
          }
        : null,
      languages: languageStats(),
      ruler: owner ? rulerCounts(owner) : null,
      viewFolds: (document?.runtime.views ?? []).map((view) => foldRanges(view.state).length),
      preferences: { ...this.#preferences },
      session: {
        ...this.#restore,
        written: this.#lastSession?.mainView.files.length ?? 0,
        activeIndex: this.#lastSession?.mainView.activeIndex ?? 0,
        split: (this.#lastSession?.subView.files.length ?? 0) > 0,
      },
      persistence: { ...this.#persistence },
      zoom: this.#preferences.zoom,
      toolbar: {
        visible: this.#preferences.toolbarVisible,
        layout: this.#preferences.toolbarLayout,
      },
      readOnly: document?.readOnly ?? false,
      inaccessible: document?.inaccessible ?? false,
      backupPath: document?.backupPath ?? null,
      focusedPane: views.length > 1 && views[1]?.hasFocus ? 1 : 0,
      plugins: {
        installed: this.#pluginRecords.map((record) => ({
          id: record.id,
          name: record.name,
          version: record.version,
          enabled: record.enabled,
          error: record.lastError,
        })),
        active: this.#plugins.activeIds(),
        commands: this.#pluginRegistry.commands().length,
        panels: this.#pluginRegistry.panels().length,
        buttons: this.#pluginRegistry.buttons().length,
        errors: this.#pluginRegistry.errors(),
        skipped: this.#pluginsSkipped,
      },
    };
  }

  /**
   * Recompute the active view's ruler structure now, bypassing its typing debounce, and
   * report how long the tree walk took. Dev/verification only — `scripts/verify-task6.py`
   * needs the ruler's cost over a large document to be a measured number, not a hope.
   */
  refreshRuler(): { structure: number; ms: number } {
    const owner = this.activeView;
    if (!owner) return { structure: 0, ms: 0 };
    const started = performance.now();
    const structure = refreshStructure(owner);
    return { structure, ms: performance.now() - started };
  }

  #createDocument(
    name: string,
    content: string,
    file?: {
      handle: FileSystemFileHandle;
      format: DocumentFormat;
      assumedEncoding: boolean;
      /** The file's mtime when it was read — N++'s `originalFileLastModifTimestamp`. */
      lastModified?: number;
    },
    restore?: RestoreState,
  ): OpenDocument {
    const runtime = createDocumentRuntime();
    // Task 6: the language comes from the file name, and — only when that says nothing — from the
    // content (extension, then `FileManager::detectLanguageFromTextBeginning`). A restored
    // document keeps the language the session recorded instead of asking again (N++ sets it from
    // the session's `lang`), which is what makes an override survive a reload once one exists.
    const language = restore ? restore.language : detectLanguage(name, content);
    const wordWrap = restore?.wordWrap ?? NPP_WORD_WRAP;
    const state = createDocumentState(content, {
      handlers: this.#handlers,
      wordWrap,
      bookmarkMargin: this.#bookmarkMargin,
      zoom: this.#preferences.zoom,
      theme: this.#preferences.theme,
      plugins: this.#pluginExtensions(),
      readOnly: restore?.readOnly ?? false,
      // A restored document whose grammar the restore already waited for carries it in the state
      // from the start; anything else loads lazily and is swapped in through the compartment.
      language: restore?.languageExtension,
    });
    const document: OpenDocument = {
      id: `d${(this.#nextDocumentId += 1)}`,
      name,
      savedText: state.doc,
      dirty: false,
      wordWrap,
      runtime,
      state,
      // The session's own format wins: it is what the file was read as, which is what §6's
      // round-trip rule has to reproduce on the next save.
      format: restore?.format ?? file?.format ?? { ...DEFAULT_FORMAT },
      language,
      readOnly: restore?.readOnly ?? false,
      position: restore?.position ?? { firstVisibleLine: 1, xOffset: 0 },
      selection: restore?.selection ?? { anchor: 0, head: 0, mode: "stream" },
    };
    if (file) {
      document.handle = file.handle;
      document.assumedEncoding = file.assumedEncoding;
      document.originalFileLastModifTimestamp = file.lastModified;
    } else if (restore) {
      // D4: the encoding was *assumed* when this file was first read — nothing in the file
      // identifies it — and a reload must not turn that into a silent guess. The session records
      // the flag (session-store.ts) and the restore carries it as far as `RestoreState`; without
      // this line it went no further, so a restored windows-1252 document reported an identified
      // encoding to `inspect()` and to the status bar while still writing windows-1252 back.
      document.assumedEncoding = restore.assumedEncoding;
    }
    // The grammar is already in the state, so nothing needs to be loaded for it (and
    // `#loadLanguage` returns early for it, which is what keeps the lazy path and this one apart).
    if (restore?.languageExtension) document.languageExtension = restore.languageExtension;
    // Fired by split-view's dispatcher, once per transaction, for every view.
    runtime.onUpdate = (view) => this.#onUpdate(document, view);
    // The import is lazy and the document must appear now, so the language arrives after
    // the fact and is swapped in through `languageCompartment`.
    if (language) void this.#loadLanguage(document);
    return document;
  }

  /**
   * Load a document's language and reconfigure every view that shows it.
   *
   * Two guards matter: the document may have been closed while the import was in flight
   * (so the result is dropped, not dispatched into a destroyed view), and a language whose
   * chunk fails to load must say so loudly — a silent failure would leave the status bar
   * naming a language that is not actually applied.
   */
  async #loadLanguage(document: OpenDocument): Promise<void> {
    const language = document.language;
    if (!language || document.languageExtension) return;
    let extension;
    try {
      extension = await language.load();
    } catch (error) {
      console.error(`[task 6] ${language.id} (${language.origin}) failed to load`, error);
      // Task 8: offline this is the *expected* outcome for a language that was never opened
      // while online, so it is reported rather than logged and forgotten.
      this.#noteLanguageUnavailable(language);
      return;
    }
    if (!this.#documents.includes(document)) return; // closed while loading
    document.languageExtension = extension;
    const effect = languageCompartment.reconfigure(extension);
    for (const view of [...document.runtime.views]) view.dispatch({ effects: effect });
    this.#render();
  }

  /**
   * Set a document's language by id — N++'s Language menu. `null` is "Normal text file".
   *
   * Everything already on screen is replaced in the same order a fresh open would use:
   * drop the old extension first so a failed load cannot leave the previous grammar in
   * place under the new name.
   */
  async setLanguage(id: string | null): Promise<boolean> {
    const document = this.#active();
    if (!document) return false;
    const wanted: LanguageDefinition | null = id === null ? null : (byId(id) ?? null);
    if (id !== null && !wanted) return false;
    if (document.language?.id === wanted?.id && document.languageExtension) return true;

    document.language = wanted;
    document.languageExtension = undefined;
    const empty = languageCompartment.reconfigure([]);
    for (const view of [...document.runtime.views]) view.dispatch({ effects: empty });
    this.#render();
    if (wanted) await this.#loadLanguage(document);
    this.#pluginRegistry.emit("language:changed", {
      document: this.#pluginInfo(document),
      language: wanted?.id ?? null,
    });
    // N++ records the language in the buffer's session entry; a choice made from the menu is
    // state worth keeping even when no text changed, so it is a session write of its own.
    this.#scheduleSessionWrite();
    return true;
  }

  #onUpdate(document: OpenDocument, view: EditorView): void {
    const owner = ownerView(document.runtime);
    // Only the owner's state carries the history, so never let a clone's state
    // replace it. When no owner exists the view *is* the document.
    if (!owner || view === owner) document.state = view.state;

    // Both views hold identical text (split-view forwards every change), so the
    // view that just applied the change is as good a source as any — and it is
    // the only correct one mid-transaction, before the owner has caught up.
    const dirty = !backAtSavePoint(view.state.doc, document.savedText);
    if (dirty !== document.dirty) document.dirty = dirty;

    this.#mirrorBookmarks(document, view);
    this.#mirrorFolds(document, view);
    // Task 7: a change is a reason to remember. The session follows in a moment, and the body
    // follows on N++'s own interval — "sync: (every N seconds) the backup file will be saved if
    // the buffer is dirty and modifications are present" (`Buffer.cpp:1247`).
    this.#scheduleSessionWrite();
    this.#scheduleSnapshot(document);
    this.#emitDocumentChanged(document);
    this.#render();
  }

  /* --------------------------------------------------------------- plugins */

  /** Load every enabled plugin, then tell them the app is ready. Never awaited by `start()`. */
  async #startPlugins(): Promise<void> {
    const report = await this.#plugins.start();
    this.#pluginsSkipped = report.skipped;
    await this.#refreshPluginRecords();
    const [first] = report.failed;
    if (first) {
      this.#chrome.showNotice(
        report.failed.length === 1
          ? "A plugin could not be started"
          : `${report.failed.length} plugins could not be started`,
        `${first.id}: ${first.error}`,
        {
          kind: "plugin-failure",
          action: { label: "Open Plugin Manager", onClick: () => this.#openPluginManager() },
        },
      );
    }
    this.#pluginRegistry.emit("ready", {});
    this.#dock.sync();
    this.#render();
  }

  async #refreshPluginRecords(): Promise<void> {
    this.#pluginRecords = await listPlugins();
  }

  /** Install a plugin from source text — the manager's entry point (P6). */
  async installPlugin(source: string): Promise<{ ok: boolean; error?: string; id?: string }> {
    const result = await this.#plugins.install(source);
    await this.#refreshPluginRecords();
    this.#render();
    return result;
  }

  async enablePlugin(id: string): Promise<{ ok: boolean; error?: string; id?: string }> {
    const result = await this.#plugins.enable(id);
    await this.#refreshPluginRecords();
    this.#render();
    return result;
  }

  async disablePlugin(id: string): Promise<boolean> {
    const disabled = await this.#plugins.disable(id);
    await this.#refreshPluginRecords();
    this.#render();
    return disabled;
  }

  async uninstallPlugin(id: string): Promise<boolean> {
    const removed = await this.#plugins.uninstall(id);
    await this.#refreshPluginRecords();
    this.#render();
    return removed;
  }

  async reloadPlugin(id: string): Promise<{ ok: boolean; error?: string; id?: string }> {
    const result = await this.#plugins.reload(id);
    await this.#refreshPluginRecords();
    this.#render();
    return result;
  }

  /** A read-only snapshot for plugins — never the `OpenDocument` itself. */
  #pluginInfo(document: OpenDocument): DocumentInfo {
    const view = ownerView(document.runtime);
    const text = view?.state.doc ?? document.state.doc;
    return {
      id: document.id,
      name: document.name,
      fileName: document.handle?.name ?? null,
      language: document.language?.id ?? null,
      dirty: document.dirty,
      readOnly: document.readOnly,
      lineCount: text.lines,
      characterCount: text.length,
    };
  }

  #pluginDocument(documentId?: string): OpenDocument | null {
    if (documentId === undefined) return this.#active();
    return this.#documents.find((document) => document.id === documentId) ?? null;
  }

  /**
   * What plugins contribute to a document: their extensions, plus a keymap built
   * from the shortcuts they registered. A shortcut that could shadow one of the
   * app's own was already refused at registration, so this keymap cannot steal
   * Ctrl+S by construction.
   */
  #pluginExtensions(): Extension {
    const bindings = this.#pluginRegistry
      .commands()
      .filter((command) => command.enabled && command.shortcut !== undefined)
      .flatMap((command) => {
        // CodeMirror's keymap understands `Ctrl-Alt-u`, not `Ctrl+Alt+U`. Without
        // this conversion the binding exists and matches nothing — measured in P4.
        const key = toKeymapKey(command.shortcut as string);
        if (!key) return [];
        return [
          {
            key,
            preventDefault: true,
            run: (): boolean => {
              try {
                return command.run() !== false;
              } catch (error) {
                this.#pluginRegistry.noteError(command.pluginId, error);
                return false;
              }
            },
          },
        ];
      });
    return [...this.#pluginRegistry.extensions(), bindings.length > 0 ? keymap.of(bindings) : []];
  }

  /** Push the current plugin set into every live view, and keep the toolbar in step. */
  #applyPluginExtensions(): void {
    const effect = pluginCompartment.reconfigure(this.#pluginExtensions());
    for (const document of this.#documents) {
      this.#eachView(document, (view) => view.dispatch({ effects: effect }));
    }
    this.#syncPluginButtons();
    this.#render();
  }

  #pluginMenu(): MenuEntry[] {
    const commands = this.#pluginRegistry.commands();
    const entries: MenuEntry[] = commands.map((command) => ({
      id: `plugin:${command.key}`,
      label: command.label,
      onClick: () => this.#runPluginCommand(command.key),
      ...(command.shortcut ? { shortcut: command.shortcut } : {}),
      ...(command.checked ? { checked: command.checked() } : {}),
    }));
    if (entries.length > 0) entries.push({ id: "plugins-separator", separator: true });
    // N++ ends Plugins with "Plugins Admin…"; this is the same door, and the only
    // permanent entry here — with no plugins the menu is still usable.
    entries.push({
      id: "plugin-manager",
      label: "Plugin Manager…",
      onClick: () => this.#openPluginManager(),
    });
    return entries;
  }

  /** P6 — the manager, fed the same facade the console and the checks use. */
  #openPluginManager(): void {
    void openPluginManager({
      list: () => listPlugins(),
      install: (source) => this.installPlugin(source),
      enable: (id) => this.enablePlugin(id),
      disable: (id) => this.disablePlugin(id),
      reload: (id) => this.reloadPlugin(id),
      uninstall: (id) => this.uninstallPlugin(id),
      disabled: this.#pluginsDisabled,
    });
  }

  #runPluginCommand(key: string): void {
    const command = this.#pluginRegistry.findCommand(key);
    if (!command || !command.enabled) return;
    try {
      command.run();
    } catch (error) {
      this.#pluginRegistry.noteError(command.pluginId, error);
    }
    this.#render();
  }

  #syncPluginButtons(): void {
    const wanted = new Map<string, RegisteredButton>();
    for (const button of this.#pluginRegistry.buttons()) {
      wanted.set(`plugin:${button.pluginId}:${button.spec.id}`, button);
    }
    for (const id of [...this.#pluginButtons]) {
      if (wanted.has(id)) continue;
      this.#chrome.removeButton(id);
      this.#pluginButtons.delete(id);
    }
    for (const [id, button] of wanted) {
      if (this.#pluginButtons.has(id)) continue;
      this.#chrome.addButton({
        id,
        label: button.spec.label,
        title: button.spec.title ?? button.spec.label,
        onClick: () => {
          try {
            return button.spec.onClick() === true;
          } catch (error) {
            this.#pluginRegistry.noteError(button.pluginId, error);
            return false;
          }
        },
      });
      this.#pluginButtons.add(id);
    }
  }

  /**
   * The document operations a plugin may perform. Every edit is an ordinary
   * transaction, so Ctrl+Z undoes it; a document with no mounted view is edited
   * through its own state, which keeps the history it will show when reopened.
   */
  #pluginBridge(): WorkspaceBridge {
    const textOf = (document: OpenDocument): Text =>
      ownerView(document.runtime)?.state.doc ?? document.state.doc;
    const rangesOf = (document: OpenDocument) =>
      (ownerView(document.runtime)?.state ?? document.state).selection.ranges;

    const apply = (
      document: OpenDocument,
      changes: readonly { from: number; to: number; insert: string }[],
    ): boolean => {
      if (document.readOnly || changes.length === 0) return false;
      const view = ownerView(document.runtime);
      if (view) {
        view.dispatch({ changes: [...changes], userEvent: "input.plugin" });
        return true;
      }
      document.state = document.state.update({
        changes: [...changes],
        userEvent: "input.plugin",
      }).state;
      this.#render();
      return true;
    };

    return {
      documents: () => this.#documents.map((document) => this.#pluginInfo(document)),
      active: () => {
        const document = this.#active();
        return document ? this.#pluginInfo(document) : null;
      },
      text: (documentId) => {
        const document = this.#pluginDocument(documentId);
        return document ? textOf(document).toString() : null;
      },
      setText: (text, documentId) => {
        const document = this.#pluginDocument(documentId);
        return document
          ? apply(document, [{ from: 0, to: textOf(document).length, insert: text }])
          : false;
      },
      selections: (documentId) => {
        const document = this.#pluginDocument(documentId);
        return document
          ? rangesOf(document).map((range) => ({
              from: range.from,
              to: range.to,
              head: range.head,
              anchor: range.anchor,
            }))
          : [];
      },
      replaceSelections: (map, documentId) => {
        const document = this.#pluginDocument(documentId);
        if (!document) return false;
        const text = textOf(document);
        const changes = rangesOf(document).map((range, index) => ({
          from: range.from,
          to: range.to,
          insert: map(text.slice(range.from, range.to).toString(), index),
        }));
        return apply(document, changes);
      },
    };
  }

  /** Dialogs and notices for plugins, in the app's own chrome. */
  #pluginUi(): UiApi {
    const modal = (
      spec: { title: string; body?: string; content?: HTMLElement },
      actions: readonly { id: string; label: string; primary?: boolean }[],
    ): Promise<string | null> =>
      new Promise((resolve) => {
        const dialog = document.createElement("dialog");
        dialog.className = "npp-dialog";
        dialog.dataset.dialog = "plugin";
        const title = document.createElement("h2");
        title.className = "npp-dialog-title";
        title.textContent = spec.title;
        dialog.append(title);
        if (spec.body) {
          const body = document.createElement("p");
          body.className = "npp-dialog-body";
          body.textContent = spec.body;
          dialog.append(body);
        }
        if (spec.content) {
          const content = document.createElement("div");
          content.className = "npp-dialog-content";
          content.append(spec.content);
          dialog.append(content);
        }
        const row = document.createElement("div");
        row.className = "npp-dialog-actions";
        for (const action of actions) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = action.primary ? "npp-dialog-confirm" : "npp-dialog-cancel";
          button.textContent = action.label;
          button.dataset.dialogAction = action.id;
          button.addEventListener("click", () => dialog.close(action.id));
          row.append(button);
        }
        dialog.append(row);
        dialog.addEventListener("close", () => {
          const value = dialog.returnValue || null;
          dialog.remove();
          resolve(value);
        });
        document.body.append(dialog);
        dialog.showModal();
      });

    return {
      dialog: (spec) => {
        const actions = spec.actions?.length
          ? spec.actions.map((action) => ({ ...action, primary: false }))
          : [{ id: "ok", label: "OK", primary: true }];
        return modal(spec, actions);
      },
      confirm: async (message, options) => {
        const value = await modal(
          { title: options?.title ?? "Notepad++ Web", body: message },
          [
            { id: "cancel", label: "Cancel" },
            { id: "ok", label: options?.confirmLabel ?? "OK", primary: true },
          ],
        );
        return value === "ok";
      },
      notice: (title, body, options) => {
        const kind = `plugin:${options?.kind ?? "notice"}`;
        this.#chrome.showNotice(title, body, { kind });
        return { dispose: () => this.#chrome.hideNotice(kind) };
      },
    };
  }

  #emitPluginEvent(type: PluginEventType, document?: OpenDocument): void {
    this.#pluginRegistry.emit(type, document ? { document: this.#pluginInfo(document) } : {});
  }

  /** One `document:changed` per burst, like the session write — not one per keystroke. */
  #emitDocumentChanged(document: OpenDocument): void {
    if (this.#pluginChangeTimer !== null) window.clearTimeout(this.#pluginChangeTimer);
    this.#pluginChangeTimer = window.setTimeout(() => {
      this.#pluginChangeTimer = null;
      this.#emitPluginEvent("document:changed", document);
    }, 250);
  }

  /* ----------------------------------------------------------------- files */

  /**
   * File ▸ Open. Called straight from a click so the picker still has the user
   * activation it requires — nothing may be awaited before it.
   */
  async openFile(): Promise<void> {
    if (!this.#capabilities.fileSystemAccess) {
      await this.#showUnsupported();
      return;
    }

    let handle: FileSystemFileHandle | null = null;
    try {
      handle = await pickFileToOpen();
    } catch (error) {
      await this.#chrome.alert({ title: "Could not open the file", body: describe(error) });
      return;
    }
    if (!handle) return; // dismissed — a cancel, not a failure

    await this.#adopt(handle);
  }

  /**
   * Reopen a file from File ▸ Recent. Runs inside a click because a stored handle
   * says nothing about permission: `ensureAccess` may still have to ask, and the
   * browser only allows that during a user gesture.
   */
  async openRecent(name: string): Promise<void> {
    const entry = this.#recent.find((item) => item.name === name);
    if (!entry) return;

    if (!(await ensureAccess(entry.handle))) {
      await this.#chrome.alert({
        title: `Access to ${name} was not granted`,
        body:
          "The browser did not allow this file to be reopened. It has been removed from the " +
          "recent list — use File ▸ Open… to choose it again.",
      });
      await forgetRecent(name);
      await this.#refreshRecent();
      return;
    }

    // A handle can outlive the file it points at, so a failure here forgets the
    // entry rather than leaving one that can never work again.
    const opened = await this.#adopt(entry.handle);
    if (!opened) {
      await forgetRecent(name);
      await this.#refreshRecent();
    }
  }

  /**
   * Decode a handle and adopt it as a document, applying D4's honesty rules.
   * Returns false when nothing was opened, so the caller can react.
   *
   * Task 7 gave this a rule it did not need before: N++ does not open a second copy of a file it
   * already has — "If we found the document, then we don't open the existing doc. We return the
   * found buffer ID instead" (`NppIO.cpp:306-330`, which compares names; the browser's equivalent
   * of a path is the handle's own identity). The session restore makes this the common case: a
   * `File ▸ Recent` click after a reload now finds the file already open, and activating that tab
   * is both what N++ does and the only safe answer — the open copy may hold edits the file on disk
   * does not, so re-reading the file would discard them silently.
   */
  async #adopt(handle: FileSystemFileHandle): Promise<boolean> {
    this.#noteUserAction();
    const open = await this.#findOpenDocument(handle);
    if (open) {
      this.#show(open.id);
      this.#render();
      return true;
    }

    let decoded;
    try {
      decoded = await readHandle(handle);
    } catch (error) {
      await this.#chrome.alert({ title: `Could not read ${handle.name}`, body: describe(error) });
      return false;
    }

    // UTF-32 and friends: refused with the reason rather than opened as mojibake.
    if (decoded.unsupported) {
      await this.#chrome.alert({ title: `${handle.name} was not opened`, body: decoded.unsupported });
      return false;
    }

    const document = this.#createDocument(handle.name, toEditorLineEndings(decoded.text), {
      handle,
      format: { encoding: decoded.encoding, bom: decoded.bom, eol: decoded.eol },
      assumedEncoding: decoded.assumed,
      // N++ tracks the file's mtime so a later session can tell whether another program changed
      // it while this window was closed (`originalFileLastModifTimestamp`, Buffer.cpp:1241).
      lastModified: await fileTimestamp(handle),
    });
    this.#documents.push(document);
    this.#emitPluginEvent("document:opened", document);
    this.#show(document.id);

    await rememberRecent(handle);
    await this.#refreshRecent();
    this.#scheduleSessionWrite(0);

    // D4: never let an uncertain decode pass silently.
    if (decoded.assumed) {
      await this.#chrome.alert({
        title: `${handle.name} was opened as windows-1252`,
        body:
          "Nothing in the file identifies its encoding: it has no byte-order mark and its bytes " +
          "are not valid UTF-8. Rather than guess silently, it has been opened as windows-1252, " +
          "which cannot fail to decode — check that accented and punctuation characters look " +
          "right before you save, because saving will write windows-1252 back.",
      });
    } else if (decoded.hadErrors) {
      await this.#chrome.alert({
        title: `${handle.name} did not decode cleanly`,
        body:
          `Some bytes are not valid ${decoded.encoding} and were replaced with “\uFFFD”. Saving now ` +
          "would write those replacements to disk, so check the document before saving.",
      });
    }

    return true;
  }

  /**
   * File ▸ Save, or Save As when `forceDialog` is set. Needs no user gesture once
   * the document has a handle — only choosing a *new* destination does.
   */
  async saveFile(options: { forceDialog?: boolean } = {}): Promise<boolean> {
    const document = this.#active();
    if (!document) return false;
    if (!this.#capabilities.fileSystemAccess) {
      await this.#showUnsupported();
      return false;
    }

    let handle = options.forceDialog ? null : (document.handle ?? null);
    if (!handle) {
      try {
        handle = await pickFileToSave(document.name);
      } catch (error) {
        await this.#chrome.alert({ title: "Could not save the file", body: describe(error) });
        return false;
      }
      if (!handle) return false; // dismissed
    }

    // The round-trip contract: the file's own line endings go back with it (R3).
    const forFile = toFileLineEndings(document.state.doc.toString(), document.format.eol);
    const encoded = encodeFile(forFile, document.format);
    if ("problem" in encoded) {
      await this.#chrome.alert({
        title: `Cannot save as ${document.format.encoding}`,
        body: encoded.problem,
      });
      return false;
    }

    try {
      await writeHandle(handle, encoded.bytes);
    } catch (error) {
      await this.#chrome.alert({
        title: `Could not write ${handle.name}`,
        body: `${describe(error)}\n\nThe original file has been left untouched.`,
      });
      return false;
    }

    document.handle = handle;
    document.name = handle.name;
    document.savedText = document.state.doc;
    document.dirty = false;
    document.assumedEncoding = false;
    // Back at the save point, so the backup has nothing left to protect: N++ deletes it in the
    // same pass that clears the modified flag ("each save file … the backup file will be deleted
    // (if buffer is not dirty)", Buffer.cpp:1248).
    this.#forgetBackup(document);
    document.originalFileLastModifTimestamp = await fileTimestamp(handle);
    // Save As can land on a file that was not in the list before.
    await rememberRecent(handle);
    await this.#refreshRecent();
    this.#render();
    this.#scheduleSessionWrite(0);
    this.#emitPluginEvent("document:saved", document);
    return true;
  }

  /** The open document behind a handle, if there is one — see `#adopt` for why it matters. */
  async #findOpenDocument(handle: FileSystemFileHandle): Promise<OpenDocument | null> {
    for (const document of this.#documents) {
      const open = document.handle;
      if (!open || typeof open.isSameEntry !== "function") continue;
      try {
        if (await open.isSameEntry(handle)) return document;
      } catch {
        // A handle that cannot answer (a permission that was revoked) is simply not a match.
      }
    }
    return null;
  }

  async #showUnsupported(): Promise<void> {
    const notice = unsupportedNotice(this.#capabilities);
    if (notice) await this.#chrome.alert({ title: notice.title, body: notice.body });
  }

  /* ----------------------------------------------------------- tab switches */

  #show(id: string): void {
    if (this.#activeId === id) return;
    const leaving = this.#active();
    // N++ records the position of the file you are leaving as you leave it; a document that is
    // not mounted has no view to read a caret out of.
    if (leaving) this.#captureViewState(leaving);
    this.#teardownActive();
    this.#activeId = id;
    this.#mountActive();
    this.#render();
    const current = this.#active();
    if (current) this.#emitPluginEvent("document:activated", current);
    // "before switch off to another tab (or close files on exit), check 1 & 2" — N++ syncs the
    // buffer being left behind, not only the one being opened (`Buffer.cpp:1249`).
    if (leaving) void this.#flushSession();
  }

  /** Unmount every view of the active document, saving its live state first. */
  #teardownActive(): void {
    const document = this.#active();
    if (!document) return;
    const owner = ownerView(document.runtime);
    if (owner) document.state = owner.state;
    for (const view of [...document.runtime.views]) {
      unregisterView(document.runtime, view);
      view.destroy();
    }
  }

  #mountActive(): void {
    const document = this.#active();
    if (!document) return;
    const owner = this.#mountOwner(document, this.#primary);
    // A freshly mounted view starts unfocused. Without this, Alt+N would destroy
    // the focused view and leave the new document's editor unable to receive the
    // next keystroke — a real failure the acceptance check caught.
    owner.focus();
    if (this.#split) this.#mountClone(document);
    // Task 7: the clone is mounted first so that a restored document's marks and folds reach both
    // panes through the same path the rest of the app uses (S7).
    const pending = this.#pendingRestore.get(document.id);
    if (pending) {
      this.#pendingRestore.delete(document.id);
      this.#applyRestoredViewState(document, pending);
    }
  }

  #mountOwner(document: OpenDocument, pane: PaneElements): EditorView {
    // The document's own state: it holds the history across tab switches.
    const view = new EditorView({
      state: document.state,
      parent: pane.editorHost,
      dispatch: makeSyncDispatcher(document.runtime),
    });
    registerView(document.runtime, view);
    return view;
  }

  #mountClone(document: OpenDocument): void {
    if (!this.#secondary) return;
    // A clone gets a state built from the owner's text with no history of its
    // own; its Ctrl+Z runs undo on the owner (notepadpp-config.ts).
    const view = new EditorView({
      state: createCloneState(document.state.doc, () => ownerView(document.runtime), {
        handlers: this.#handlers,
        wordWrap: document.wordWrap,
        bookmarkMargin: this.#bookmarkMargin,
        plugins: this.#pluginExtensions(),
        // Task 6: the clone highlights with the same language, and — because the language
        // is loaded per view — needs the extension at construction time.
        language: document.languageExtension,
      }),
      parent: this.#secondary.editorHost,
      dispatch: makeSyncDispatcher(document.runtime),
    });
    registerView(document.runtime, view);
    // A clone's state is built from the owner's *text*, so state-held annotations — search
    // marks, bookmarks and (Task 6) folds — have to be handed over explicitly.
    copyBookmarks(document.state, view);
    copyMarks(document.state, view);
    applyFolds(view, foldRanges(document.state));
    // Mounted before its extension could be applied (the clone of a document whose language
    // was still loading): the compartment catches up through the same path a load uses.
    if (document.language && !document.languageExtension) void this.#loadLanguage(document);
  }

  #activateRelative(delta: number): void {
    const count = this.#documents.length;
    if (count < 2) return;
    const index = this.#documents.findIndex((document) => document.id === this.#activeId);
    const next = this.#documents[(index + delta + count) % count];
    if (next) this.#show(next.id);
  }

  /* ----------------------------------------------------------------- split */

  toggleSplit(): void {
    this.#noteUserAction();
    if (this.#split) this.#closeSplit();
    else this.#openSplit();
    this.#render();
  }

  #openSplit(): void {
    this.#split = true;
    this.#secondary = this.#chrome.addPane("clone", "after-splitter");
    this.#chrome.setSplitterVisible(true);
    this.#disposeSplitterDrag = this.#chrome.enableSplitterDrag(this.#secondary);
    const document = this.#active();
    if (document) this.#mountClone(document);
  }

  #closeSplit(): void {
    this.#split = false;
    const document = this.#active();
    if (document) {
      const owner = ownerView(document.runtime);
      for (const view of [...document.runtime.views]) {
        if (view === owner) continue;
        unregisterView(document.runtime, view);
        view.destroy();
      }
    }
    this.#disposeSplitterDrag?.();
    this.#disposeSplitterDrag = null;
    if (this.#secondary) {
      this.#chrome.removePane(this.#secondary);
      this.#secondary = null;
    }
    this.#chrome.setSplitterVisible(false);
  }

  /* ------------------------------------------------------------- word wrap */

  /** N++ View ▸ Word Wrap: per document, applied to every pane showing it. */
  toggleWordWrap(): boolean {
    const document = this.#active();
    if (!document) return false;
    document.wordWrap = !document.wordWrap;
    const effect = wordWrapCompartment.reconfigure(wordWrapExtension(document.wordWrap));
    // Reconfigure each pane explicitly: the sync dispatcher forwards only
    // document changes, and an extension reconfigure has none.
    for (const view of [...document.runtime.views]) view.dispatch({ effects: effect });
    this.#render();
    return document.wordWrap;
  }

  /* ----------------------------------------------------- search & bookmarks */

  /**
   * Task 5. The dialog's view of the world: the view a command acts on, and every view of the
   * active document (marks and bookmarks are per-view state, so all of them must be told).
   */
  #searchHost(): SearchHost {
    return {
      target: () => this.#focusView(),
      views: () => this.#active()?.runtime.views ?? [],
      markLines: (lines) => this.#bookmarkLines(lines),
    };
  }

  /**
   * The view a command acts on. N++'s Find works on the pane that has the focus; with the split
   * open that is not always the primary pane, and with none focused (a menu click is not a
   * focus event) it is the owner view — the one holding the document's history.
   */
  #focusView(): EditorView | null {
    const document = this.#active();
    if (!document) return null;
    for (const view of document.runtime.views) {
      if (view.hasFocus) return view;
    }
    return ownerView(document.runtime) ?? null;
  }

  /** Open the Find / Replace / Mark dialog on one of its tabs (N++: Ctrl+F, Ctrl+H, Ctrl+M). */
  openSearch(tab: SearchTab = "find"): void {
    this.#find.show(tab);
  }

  /** The search dialog, for the verification handle and for callers that need its state. */
  get search(): FindReplaceDialog {
    return this.#find;
  }

  /** Apply a transaction to every view of the active document. */
  #eachView(document: OpenDocument, apply: (view: EditorView) => void): void {
    for (const view of [...document.runtime.views]) apply(view);
  }

  /** The Mark tab's "Bookmark line": add bookmarks for the given line numbers. */
  #bookmarkLines(lines: readonly number[]): void {
    const document = this.#active();
    const view = this.#focusView();
    if (!document || !view) return;
    const wanted = bookmarkLines(view.state, lines);
    // N++'s "Bookmark line" *adds* to what is bookmarked; it does not clear first.
    const union = [...new Set([...bookmarkPositions(view.state), ...wanted])].sort((a, b) => a - b);
    this.#eachView(document, (target) =>
      target.dispatch({ effects: setBookmarksEffect.of(union) }),
    );
    this.#render();
  }

  #toggleBookmark(): boolean {
    const document = this.#active();
    const view = this.#focusView();
    if (!document || !view) return false;
    toggleBookmark(view, document.runtime.views);
    this.#render();
    return true;
  }

  #gotoBookmark(forward: boolean): boolean {
    const document = this.#active();
    const view = this.#focusView();
    if (!document || !view) return false;
    // N++ returns early when a document has no bookmarks at all (`bookmarkNext`) — no
    // "not found" message, nothing moves.
    if (gotoBookmark(view, forward) === null) return false;
    this.#render();
    return true;
  }

  clearBookmarks(): void {
    const document = this.#active();
    const view = this.#focusView();
    if (!document || !view) return;
    clearAllBookmarks(view, document.runtime.views);
    this.#render();
  }

  /** View ▸ Bookmark Margin — N++'s `_bookMarkMarginShow` preference (`Parameters.h:902`). */
  toggleBookmarkMargin(): boolean {
    const document = this.#active();
    if (!document) return false;
    this.#bookmarkMargin = !this.#bookmarkMargin;
    const effect = bookmarkMarginCompartment.reconfigure(
      bookmarkMarginExtension(this.#bookmarkMargin),
    );
    this.#eachView(document, (view) => view.dispatch({ effects: effect }));
    return this.#bookmarkMargin;
  }

  /**
   * Keep every pane showing the same bookmarks.
   *
   * The split dispatcher forwards **document changes** only, and a bookmark is state, not text —
   * so a bookmark toggled by a click in the clone's margin would be invisible in the primary
   * pane and would vanish when the split closed (the clone's state is built fresh each time).
   * Reconciling here means every path — keymap, menu, dialog, margin click — agrees, without
   * `split-view.ts` having to know that bookmarks exist.
   *
   * What is compared is a *change*, not a state: a view reconciles its peers only when the
   * bookmarks it holds moved since the last transaction it was asked about. Comparing states
   * instead is what Task 7 found to be wrong — a freshly mounted clone has no bookmarks yet and
   * its first transaction (the mount-time handover, or a language load) would read as "this
   * document has no bookmarks", silently clearing the other pane's. `verify-task7.py` covers the
   * sequence that exposed it: bookmark line 1, fold a function, then open the split.
   */
  #mirrorBookmarks(document: OpenDocument, view: EditorView): void {
    const mine = bookmarkPositions(view.state);
    const signature = mine.join(",");
    const previous = this.#bookmarkSignatures.get(view);
    this.#bookmarkSignatures.set(view, signature);
    if (previous === undefined || previous === signature) return;

    for (const peer of [...document.runtime.views]) {
      if (peer === view) continue;
      const theirs = bookmarkPositions(peer.state);
      if (theirs.length === mine.length && theirs.every((position, index) => position === mine[index])) {
        continue;
      }
      peer.dispatch({ effects: setBookmarksEffect.of(mine) });
    }
  }

  /* ---------------------------------------------------------------- folding */

  /**
   * Keep every pane's folds in step — the same problem as bookmarks, and the same shape of
   * answer (S7).
   *
   * Fold state is a per-view `StateField` (`@codemirror/language`'s `foldState`), and the
   * split dispatcher forwards *document changes* only, so a function folded in the clone
   * would silently reappear in the primary pane, and would be lost when the split closed
   * (the clone's state is rebuilt from the text on every mount). Task 3 deferred this to
   * Task 6 with the note "which is when there will be languages to fold" — this is that.
   *
   * The two sets are compared as a whole and, when they differ, the peer is reset to the
   * source view's folds. Folding is a user action, not a hot path, and a wholesale reset
   * cannot drift the way an incremental diff could.
   */
  #mirrorFolds(document: OpenDocument, view: EditorView): void {
    const mine = foldRanges(view.state);
    // Same rule as bookmarks above, and it is the fix for the bug this task found: a freshly
    // mounted clone's first transaction must not be read as "the document has no folds". Only a
    // view whose own fold set actually moved says anything to its peers.
    const signature = mine.map((range) => `${range.from}:${range.to}`).join(",");
    const previous = this.#foldSignatures.get(view);
    this.#foldSignatures.set(view, signature);
    if (previous === undefined || previous === signature) return;

    for (const peer of [...document.runtime.views]) {
      if (peer === view) continue;
      const theirs = foldRanges(peer.state);
      if (sameRanges(mine, theirs)) continue;
      peer.dispatch({
        effects: [
          ...theirs.map((range) => unfoldEffect.of(range)),
          ...mine.map((range) => foldEffect.of(range)),
        ],
      });
    }
  }

  /* ---------------------------------------------------------------- closing */

  #closeActive(): void {
    const document = this.#active();
    if (!document) return;
    void this.#close(document);
  }

  async #close(document: OpenDocument): Promise<void> {
    this.#noteUserAction();
    if (document.dirty) {
      // N++'s three-way prompt. Task 4 made Save real, so offering only
      // Discard/Cancel here would hide the safe option.
      const choice = await this.#chrome.confirmSave({
        title: `Save changes to ${document.name}?`,
        body: `${document.name} has unsaved changes.`,
        canSave: this.#capabilities.fileSystemAccess,
      });
      if (choice === "cancel") return;
      if (choice === "save") {
        // A failed or dismissed save must keep the document open, not lose it.
        const saved = await this.saveFile();
        if (!saved) return;
      }
    }

    const index = this.#documents.indexOf(document);
    if (index === -1) return;
    const wasActive = document.id === this.#activeId;
    if (wasActive) this.#captureViewState(document);
    if (wasActive) this.#teardownActive();
    this.#documents.splice(index, 1);
    this.#emitPluginEvent("document:closed", document);
    // N++ deletes a closed document's backup (`FileManager::deleteBufferBackup`, Buffer.cpp:1409),
    // whatever the close did with its edits: a discarded change must not come back on the next
    // restore, and a saved one has nothing left to protect.
    this.#forgetBackup(document);

    if (wasActive) {
      this.#activeId = null;
      // Land on the neighbour N++ would pick; none left means an empty window.
      const next = this.#documents[Math.min(index, this.#documents.length - 1)];
      if (next) this.#show(next.id);
    }
    this.#render();
    this.#scheduleSessionWrite(0);
  }

  /* ──────────────────────────────────────────────── Task 7: preferences & session ── */

  /** The preferences in force. Exposed for the verification handle and for callers that need them. */
  get preferences(): Preferences {
    return { ...this.#preferences };
  }

  /**
   * Make the preferences *do* something, as opposed to merely storing them. Called once at startup
   * before the session is put back (so a hidden toolbar never flashes on screen) and again whenever
   * the dialog or a Zoom command writes.
   */
  #applyPreferences(): void {
    this.#chrome.setToolbarVisible(this.#preferences.toolbarVisible);
    this.#chrome.setToolbarLayout(this.#preferences.toolbarLayout);
    const theme = this.#preferences.theme;
    // The chrome is CSS: one attribute on the document switches every variable `style.css`
    // defines (Task 10). The editor's colours travel through the two compartments below.
    const palette = PALETTES[theme] ?? PALETTES.notepadpp;
    document.documentElement.dataset.theme = palette.dark ? "dark" : "light";
    const look = editorLookCompartment.reconfigure(
      nppEditorLook({ zoom: this.#preferences.zoom, theme }),
    );
    const highlight = highlightCompartment.reconfigure(nppHighlighting(tokenColoursFor(theme)));
    for (const document of this.#documents) {
      this.#eachView(document, (view) => view.dispatch({ effects: [look, highlight] }));
    }
  }

  /** Settings ▸ Preferences… Nothing is applied until OK, which is what Cancel promises. */
  async openPreferences(): Promise<Preferences | null> {
    if (this.#preferencesOpen) return null;
    this.#preferencesOpen = true;
    try {
      return await openPreferencesDialog({
        current: this.#preferences,
        apply: (patch) => this.applyPreferences(patch),
      });
    } finally {
      this.#preferencesOpen = false;
    }
  }

  /** Store a preference change and make it take effect; returns what is now in force. */
  async applyPreferences(patch: Partial<Preferences>): Promise<Preferences> {
    this.#preferences = await savePreferences(patch);
    this.#applyPreferences();
    // A changed backup interval applies to the documents already open, not only to the next edit.
    for (const document of this.#documents) {
      if (document.dirty) this.#scheduleSnapshot(document);
    }
    this.#render();
    return { ...this.#preferences };
  }

  /** View ▸ Zoom ▸ Zoom In / Zoom Out — N++'s `IDM_VIEW_ZOOMIN` / `IDM_VIEW_ZOOMOUT`. */
  async zoomBy(delta: number): Promise<number> {
    return this.setZoom(this.#preferences.zoom + delta);
  }

  /** View ▸ Zoom ▸ Restore Default Zoom — N++'s `IDM_VIEW_ZOOMRESTORE`. */
  async setZoom(zoom: number): Promise<number> {
    this.#preferences = await savePreferences({ zoom: clampZoom(zoom) });
    this.#applyPreferences();
    return this.#preferences.zoom;
  }

  /* ------------------------------------------------------------- the session */

  /** How long a burst of changes settles before the session (not the bodies) is written. */
  #scheduleSessionWrite(delay: number = SESSION_WRITE_DELAY_MS): void {
    if (this.#restoring) return; // a restore is still assembling the truth; do not write over it
    if (this.#sessionTimer !== null) window.clearTimeout(this.#sessionTimer);
    this.#sessionTimer = window.setTimeout(() => {
      this.#sessionTimer = null;
      void this.#writeSession();
    }, delay);
  }

  /**
   * The session as N++ shapes it: one `mainView` holding every open file and the index of the
   * active one, a `subView` that carries the split, and per file everything
   * `getSessionFromXmlTree` reads back out (`Parameters.cpp:3408-3533`).
   *
   * The active document's caret and viewport are read live from its view; every other document
   * carries the values captured when it was last left — reading a caret out of a view that does
   * not exist is not possible, which is why N++ asks each buffer as it is switched away from.
   */
  #sessionRecord(): SessionRecord {
    const record = emptySession();
    for (const document of this.#documents) {
      const view = document.id === this.#activeId ? ownerView(document.runtime) : undefined;
      if (view) {
        document.selection = selectionOf(view);
        document.position = positionOf(view);
      }
      const state = view?.state ?? document.state;
      record.mainView.files.push({
        name: document.name,
        handle: document.handle,
        backupPath: document.backupPath,
        originalFileLastModifTimestamp: document.originalFileLastModifTimestamp,
        format: { ...document.format },
        assumedEncoding: document.assumedEncoding ?? false,
        language: document.language?.id ?? null,
        selection: { ...document.selection },
        position: { ...document.position },
        wordWrap: document.wordWrap,
        readOnly: document.readOnly,
        marks: offsetsToLineNumbers(state.doc, bookmarkPositions(state)),
        folds: offsetsToLineNumbers(
          state.doc,
          foldRanges(state).map((range) => range.from),
        ),
        dirty: document.dirty,
        untitled: document.handle === undefined,
      });
      if (document.id === this.#activeId) {
        record.mainView.activeIndex = record.mainView.files.length - 1;
      }
    }

    // The split (S5) shows the active document in both panes, so the sub view carries that one
    // file and nothing else — a restored split is "the sub view is not empty".
    const views = this.#documents.find((document) => document.id === this.#activeId)?.runtime.views ?? [];
    if (this.#split && views.length > 1) {
      const active = record.mainView.files[record.mainView.activeIndex];
      if (active) record.subView.files.push({ ...active });
      record.activeView = views[1]?.hasFocus ? 1 : 0;
    }
    return record;
  }

  async #writeSession(): Promise<void> {
    if (!this.#preferences.rememberLastSession) return;
    const record = this.#sessionRecord();
    if (await saveSessionRecord(record)) this.#lastSession = record;
  }

  /**
   * Write everything now: the session, and the body of every dirty document. Called when a tab is
   * switched or closed, when the tab is hidden and when it is going away — the moments a page
   * cannot afford to wait for a timer, and exactly when N++ syncs ("before switch off to another
   * tab (or close files on exit), check 1 & 2").
   */
  async #flushSession(): Promise<void> {
    if (this.#sessionTimer !== null) {
      window.clearTimeout(this.#sessionTimer);
      this.#sessionTimer = null;
    }
    for (const document of this.#documents) {
      if (this.#snapshotTimers.get(document.id) !== undefined) {
        window.clearTimeout(this.#snapshotTimers.get(document.id));
        this.#snapshotTimers.delete(document.id);
        await this.#syncBackup(document);
      }
    }
    await this.#writeSession();
  }

  /** Dev/verification handle: flush the session and the backups, and wait for them to land. */
  async flushSession(): Promise<void> {
    await this.#flushSession();
  }

  /* -------------------------------------------------------------- snapshots */

  /**
   * N++'s periodic sync: while a document is dirty its body belongs in `backup/`, and it is written
   * every `snapshotBackupTiming` ms (7000 by default — `Parameters.h:869`) rather than on every
   * keystroke. A document that is not dirty has no timer at all.
   */
  #scheduleSnapshot(document: OpenDocument): void {
    if (!this.#snapshotMode()) return;
    const pending = this.#snapshotTimers.get(document.id);
    if (pending !== undefined) window.clearTimeout(pending);
    this.#snapshotTimers.set(
      document.id,
      window.setTimeout(() => {
        this.#snapshotTimers.delete(document.id);
        void this.#syncBackup(document);
      }, this.#preferences.snapshotBackupTiming),
    );
  }

  /**
   * N++'s own condition, `Parameters.h:867`:
   * `_isSnapshotMode && _rememberLastSession && !_isCmdlineNosessionActivated`. Snapshotting while
   * "remember the session" is off would write bodies nothing is ever going to read back.
   */
  #snapshotMode(): boolean {
    return this.#preferences.snapshotMode && this.#preferences.rememberLastSession;
  }

  /** Write a dirty document's body, or delete the backup of one that is back at its save point. */
  async #syncBackup(document: OpenDocument): Promise<void> {
    if (!this.#snapshotMode()) return;

    if (document.dirty) {
      const path = await writeBackup(document.name, this.#documentText(document), {
        path: document.backupPath ?? null,
      });
      // The record has to name the file it points at, so a fresh backup schedules a session write.
      if (path && path !== document.backupPath) {
        document.backupPath = path;
        this.#scheduleSessionWrite(0);
      }
    } else if (document.backupPath) {
      const path = document.backupPath;
      document.backupPath = undefined;
      await deleteBackup(path);
      this.#scheduleSessionWrite(0);
    }
  }

  /**
   * Drop a document's backup: cancel the pending write and delete the body. N++'s
   * `FileManager::deleteBufferBackup` (`Buffer.cpp:1409`), called when a buffer is closed and when
   * a save leaves it clean.
   */
  #forgetBackup(document: OpenDocument): void {
    const timer = this.#snapshotTimers.get(document.id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.#snapshotTimers.delete(document.id);
    }
    const path = document.backupPath;
    document.backupPath = undefined;
    if (path) void deleteBackup(path);
  }

  /** The document's current text — its owner view when it is mounted, its own state otherwise. */
  #documentText(document: OpenDocument): string {
    return (ownerView(document.runtime)?.state.doc ?? document.state.doc).toString();
  }

  /**
   * Read a mounted document's caret and viewport back into the document, where the session writer
   * finds them. Called as a tab is left and as it is closed — the two moments N++ asks a buffer for
   * its position (`buf->getPosition(editView)`, `Notepad_plus.cpp:6572`).
   */
  #captureViewState(document: OpenDocument): void {
    const view = ownerView(document.runtime);
    if (!view) return;
    document.selection = selectionOf(view);
    document.position = positionOf(view);
  }

  /* ---------------------------------------------------------------- restore */

  /**
   * Put the last session back — N++'s `Notepad_plus::loadSession` (`NppIO.cpp:2494`) with its order
   * of business intact: preferences first (they decide whether there is a session at all), then
   * every recorded file in order, then the active tab, then the split.
   *
   * The two questions N++ asks at this point are both asked here, word for word: whether to make
   * placeholders for files it cannot reach, and whether a file that changed behind our back should
   * be reloaded over the edits the backup holds.
   */
  async #restoreSession(startup: OpenDocument): Promise<void> {
    this.#restoring = true;
    const report: RestoreReport = {
      complete: false,
      restored: 0,
      dropped: 0,
      placeholders: 0,
      unsavedLost: 0,
    };
    /** True once a session was actually read — the condition for pruning at the end. */
    let sawSession = false;
    try {
      this.#preferences = await loadPreferences();
      this.#applyPreferences();
      this.#persistence = await requestPersistentStorage();

      if (!this.#preferences.rememberLastSession) {
        // "Don't load session.xml if not required in order to speed up!!" — Parameters.cpp:1827.
        return;
      }

      const record = await loadSessionRecord();
      if (!record || record.mainView.files.length === 0) return; // nothing stored: welcome stays
      sawSession = true;

      const plans = await Promise.all(record.mainView.files.map((entry) => this.#planSessionFile(entry)));

      // N++ asks *once* per session whether it may make placeholders, and remembers the answer
      // (`newPlaceholderDocument`'s `theWarningHasBeenGiven`, Buffer.cpp:1723-1749). It drops the
      // entries if the answer is no, which is also what `keepSessionAbsentFileEntries=false` does
      // without asking.
      const absent = plans.filter((plan) => plan.outcome === "placeholder");
      if (absent.length > 0) {
        const keep = await this.#chrome.confirm({
          title: "File inaccessible",
          body:
            "Some files from your past session are inaccessible. They can be opened as empty and " +
            "read-only documents as placeholders.\n\nWould you like to create those placeholders?",
          confirmLabel: "Yes",
          cancelLabel: "No",
        });
        for (const plan of absent) if (!keep) plan.outcome = "drop";
      }

      const names = record.mainView.files.map((entry) => entry.name);
      // N++ numbers the next scratch buffer past every one it restored (`nextUntitledNewNumber`),
      // so a restored "new 3" cannot collide with the next document the user creates.
      this.#nextDocumentNumber = Math.max(
        this.#nextDocumentNumber,
        nextUntitledNumber(names),
      );

      const adopted: OpenDocument[] = [];
      /** Documents whose unsaved edits could not be brought back — named in the alert below. */
      const lostWork: string[] = [];
      for (const plan of plans) {
        if (plan.outcome === "drop") {
          report.dropped += 1;
          // A dirty entry that is dropped loses whatever was typed into it, and scope §8 criterion
          // 6 says nothing may be lost *silently*. With snapshot mode off there is no body to
          // restore, so the honest answer is to say so rather than open the file and hope nobody
          // notices the edits are gone.
          if (plan.entry.dirty && !plan.fromBackup) lostWork.push(plan.entry.name);
          continue;
        }
        if (plan.outcome === "placeholder") {
          const placeholder = this.#createPlaceholder(plan.entry);
          this.#documents.push(placeholder);
          adopted.push(placeholder);
          report.placeholders += 1;
          continue;
        }

        const state: RestoreState = {
          wordWrap: plan.entry.wordWrap,
          readOnly: plan.entry.readOnly,
          language: plan.language,
          languageExtension: plan.languageExtension,
          format: { ...plan.format },
          assumedEncoding: plan.assumedEncoding,
          selection: { ...plan.entry.selection },
          position: { ...plan.entry.position },
          marks: plan.entry.marks,
          folds: plan.entry.folds,
        };
        const document = this.#createDocument(plan.entry.name, plan.text, undefined, state);
        if (plan.entry.handle) {
          document.handle = plan.entry.handle;
          document.originalFileLastModifTimestamp = plan.lastModified ?? plan.entry.originalFileLastModifTimestamp;
        }
        document.backupPath = plan.entry.backupPath;
        document.dirty = plan.fromBackup;
        // The save point is the *file's* text, not the body we opened: that is what makes a
        // document restored from a backup dirty exactly until the user saves it, which is N++'s
        // "if backup … is loaded, set it dirty (red)" (Buffer.cpp:1240). Where the file could not
        // be read at all there is no baseline, so the document is dirty against nothing — N++
        // keeps such a document dirty too.
        document.savedText =
          plan.fileText !== undefined ? Text.of(plan.fileText.split("\n")) : Text.empty;
        this.#documents.push(document);
        this.#pendingRestore.set(document.id, state);
        adopted.push(document);
        report.restored += 1;
        if (plan.entry.dirty && !plan.fromBackup && !plan.discardedByUser) lostWork.push(plan.entry.name);
      }

      report.unsavedLost = lostWork.length;

      // Said before anything else, and on every path out — including the one where nothing at all
      // could be restored. A document whose edits are gone is the one thing a restore must never
      // do quietly (scope §8 criterion 6).
      if (lostWork.length > 0) {
        const named = lostWork.slice(0, 5).join(", ");
        await this.#chrome.alert({
          title: "Some unsaved changes could not be restored",
          body:
            `${lostWork.length} document(s) had unsaved changes and no backup, because "Enable ` +
            `session snapshot and periodic backup" is off: ${named}. ` +
            "A file-backed document has been reopened from its file, so the edits made in it are " +
            "gone; an untitled document is gone with them. Notepad++ cannot lose work this way " +
            "because it asks before closing — a web page has no way to stop a reload, which is " +
            "exactly what the snapshot setting above exists to prevent.",
        });
      }

      if (adopted.length === 0) return; // everything was dropped: the welcome document stays

      // The welcome buffer only exists for the no-session case (see `start()`).
      this.#discardStartup(startup);

      const active = adopted[Math.min(record.mainView.activeIndex, adopted.length - 1)] ?? adopted[0];
      if (!active) return;
      // `#show` mounts it, and the mount applies the restored caret, marks and folds — but only if
      // the user has not already made a choice of their own while this was in flight. A restore that
      // lands late must not switch the tab out from under them; the tabs themselves are still right.
      if (!this.#userActedDuringRestore) this.#show(active.id);
      if (record.subView.files.length > 0 && !this.#split) {
        this.#openSplit();
        // N++ restores which view was in front (`Session activeView`).
        if (!this.#userActedDuringRestore && record.activeView === 1) {
          active.runtime.views[1]?.focus();
        }
      }
      this.#render();
    } finally {
      this.#restoring = false;
      report.complete = true;
      this.#restore = report;
      // In the `finally` on purpose: every path out of the try — including the early ones for "no
      // session" — has to leave the record describing what is actually open. The session is
      // rewritten from what actually opened (a dropped entry, a placeholder, a file that turned out
      // to be missing are all the truth now); N++ does the same on its way out ("your session WILL
      // BE MODIFIED ON EXIT!").
      await this.#writeSession();
      if (sawSession) {
        // A backup nobody claims is stale by definition — N++ deletes one as its document closes —
        // and this is the only quiet moment to look, before any document can be dirty again.
        await pruneBackups(
          this.#documents
            .map((document) => document.backupPath)
            .filter((path): path is string => typeof path === "string"),
        );
      }
    }
  }

  /**
   * Ask storage and the file system what one recorded entry is worth, without opening anything
   * yet — the questions N++'s `loadSession` asks (`NppIO.cpp:2538-2553`), asked before any
   * document exists so that the order of the tabs is the order it recorded.
   */
  async #planSessionFile(entry: SessionFile): Promise<RestorePlan> {
    const backupText =
      this.#snapshotMode() && entry.backupPath ? await readBackup(entry.backupPath) : null;

    let fileText: string | undefined;
    let accessible = false;
    let lastModified: number | undefined;

    if (entry.handle) {
      // A restore is not a click, and the browser only lets a page *ask* for permission during
      // one. A handle whose permission is merely "prompt" is therefore inaccessible this time
      // round — which is N++'s missing-file case, with the same two answers.
      if (await hasAccessWithoutAsking(entry.handle)) {
        try {
          const decoded = await readHandle(entry.handle);
          if (!decoded.unsupported) {
            fileText = toEditorLineEndings(decoded.text);
            accessible = true;
            lastModified = await fileTimestamp(entry.handle);
          }
        } catch {
          accessible = false; // the file is gone, or unreadable
        }
      }
    }

    const outcome = restoreOutcome({
      untitled: entry.untitled,
      accessible,
      hasBackup: backupText !== null,
      keepAbsentFileEntries: this.#preferences.keepSessionAbsentFileEntries,
    });

    // N++ prefers the backup over the file: "load backup\FILENAME@CREATION_TIMESTAMP if exist,
    // otherwise load FILENAME" (Buffer.cpp:1239).
    let text = backupText ?? fileText ?? "";
    let fromBackup = backupText !== null;
    let discardedByUser = false;

    // "if backup … is loaded, last modif timestamp of FILENAME … compare with tracked timestamp.
    // in the case of unequal result, tell user the FILENAME was modified. ask user if he want to
    // reload FILENAME" (Buffer.cpp:1241-1242) — with N++'s own wording from `doReloadOrNot`
    // (Notepad_plus.cpp:2593,2601).
    if (
      fromBackup &&
      accessible &&
      fileText !== undefined &&
      entry.originalFileLastModifTimestamp !== undefined &&
      lastModified !== undefined &&
      lastModified !== entry.originalFileLastModifTimestamp
    ) {
      const reload = await this.#chrome.confirm({
        title: "Reload",
        body:
          `"${entry.name}"\n\nThis file has been modified by another program.\n` +
          "Do you want to reload it and lose the changes made in Notepad++?",
        confirmLabel: "Yes",
        cancelLabel: "No",
      });
      if (reload) {
        text = fileText;
        fromBackup = false;
        discardedByUser = true;
      }
    }

    const language = entry.language ? (byId(entry.language) ?? null) : null;
    // The grammar is loaded here, while there is still nothing on screen to reconfigure — see
    // `RestoreState.languageExtension`. A language that fails to load leaves the document as
    // "Normal text file" in effect, but says so in the console exactly as the lazy path does.
    let languageExtension: Extension | undefined;
    if (language) {
      try {
        languageExtension = await language.load();
      } catch (error) {
        console.error(`[task 7] ${language.id} (${language.origin}) failed to load on restore`, error);
      }
    }

    return {
      entry,
      outcome,
      text,
      fromBackup,
      fileText,
      format: { ...entry.format },
      assumedEncoding: entry.assumedEncoding,
      lastModified,
      language,
      languageExtension,
      discardedByUser,
    };
  }

  /**
   * An empty, read-only document standing in for a file that could not be opened — N++'s
   * placeholder (`FileManager::newPlaceholderDocument`, `Buffer.cpp:1754-1760`): the *name* is
   * kept, the content is empty, and `DOC_INACCESSIBLE` is what `inaccessible` records here.
   */
  #createPlaceholder(entry: SessionFile): OpenDocument {
    const document = this.#createDocument(entry.name, "", undefined, {
      wordWrap: false,
      readOnly: true,
      language: null,
      format: { ...entry.format },
      assumedEncoding: false,
      selection: { anchor: 0, head: 0, mode: "stream" },
      position: { firstVisibleLine: 1, xOffset: 0 },
      marks: [],
      folds: [],
    });
    document.inaccessible = true;
    return document;
  }

  /**
   * Close the welcome buffer a restore has made redundant. It is only ever the document this
   * run's `start()` created, and only while it is untouched, so nothing can be lost by it.
   */
  #discardStartup(document: OpenDocument): void {
    if (document.dirty) return;
    if (this.#documents[0] !== document) return;
    if (document.id === this.#activeId) this.#teardownActive();
    this.#documents.shift();
    if (document.id === this.#activeId) this.#activeId = null;
  }

  /**
   * Put a restored document's caret, viewport, bookmarks and folds back — once it has a view to
   * put them in. Called from the mount path, because a document that is not on screen has no view
   * and N++'s `setPosition`/`setHeaderLineState` also run against the view a buffer was opened in.
   */
  #applyRestoredViewState(document: OpenDocument, restore: RestoreState): void {
    const owner = ownerView(document.runtime);
    if (!owner) return;
    const doc = owner.state.doc;

    // Caret first, explicitly without scrolling: `scrollIntoView` would fight the viewport
    // position below, which N++ records separately (`startPos`/`endPos` vs `firstVisibleLine`).
    owner.dispatch({
      selection: {
        anchor: Math.min(restore.selection.anchor, doc.length),
        head: Math.min(restore.selection.head, doc.length),
      },
      scrollIntoView: false,
    });

    const marks = lineNumbersToOffsets(doc, restore.marks);
    if (marks.length > 0) {
      this.#eachView(document, (view) => view.dispatch({ effects: setBookmarksEffect.of(marks) }));
    }

    // Folds are recorded as header lines (N++'s `<Fold line="…"/>`), so each one is turned back
    // into the range the language folds for that line — the same range a click on the gutter makes.
    const foldRangesToApply: FoldRange[] = [];
    for (const line of restore.folds) {
      const start = lineStartOffset(doc, line);
      const end = doc.line(line).to;
      const range = foldable(owner.state, start, end);
      if (range) foldRangesToApply.push({ from: range.from, to: range.to });
    }
    if (foldRangesToApply.length > 0) {
      this.#eachView(document, (view) =>
        view.dispatch({ effects: foldRangesToApply.map((range) => foldEffect.of(range)) }),
      );
    }

    const top = lineStartOffset(doc, restore.position.firstVisibleLine);
    owner.dispatch({ effects: EditorView.scrollIntoView(top, { y: "start" }) });
    owner.scrollDOM.scrollLeft = restore.position.xOffset;
  }

  /** The stored session, with handles replaced by names so it can be read and asserted on. */
  async debugSession(): Promise<unknown> {
    const record = this.#lastSession ?? (await loadSessionRecord());
    if (!record) return null;
    return {
      activeView: record.activeView,
      writtenAt: record.writtenAt,
      mainView: {
        activeIndex: record.mainView.activeIndex,
        files: record.mainView.files.map((file) => ({
          name: file.name,
          file: file.handle?.name ?? null,
          backupPath: file.backupPath ?? null,
          language: file.language,
          encoding: file.format.encoding,
          eol: file.format.eol,
          bom: file.format.bom,
          wordWrap: file.wordWrap,
          readOnly: file.readOnly,
          dirty: file.dirty,
          untitled: file.untitled,
          caret: file.selection.head,
          anchor: file.selection.anchor,
          firstVisibleLine: file.position.firstVisibleLine,
          xOffset: file.position.xOffset,
          marks: file.marks,
          folds: file.folds,
        })),
      },
      subView: { activeIndex: record.subView.activeIndex, files: record.subView.files.length },
    };
  }

  /** The files in `backup/`, for the acceptance check and for anyone debugging lost work. */
  async debugBackups(): Promise<string[]> {
    return listBackups();
  }

  /* --------------------------------------------------------------- rendering */

  #active(): OpenDocument | null {
    return this.#documents.find((document) => document.id === this.#activeId) ?? null;
  }

  #render(): void {
    const document = this.#active();

    this.#chrome.renderTabs(this.#primary, this.#tabDescriptors(), {
      activate: (id) => {
        this.#noteUserAction();
        this.#show(id);
      },
      close: (id) => {
        const target = this.#documents.find((candidate) => candidate.id === id);
        if (target) void this.#close(target);
      },
    });

    // The status bar changes on every cursor move; skip the DOM write when the
    // text is unchanged (renderTabs short-circuits on its own signature).
    const signature = this.#status(document).join("|");
    if (signature !== this.#lastStatusSignature) {
      this.#lastStatusSignature = signature;
      this.#chrome.setStatus(this.#status(document));
    }

    this.#chrome.setTitle(document ? `${tabLabel(document)} - Notepad++ Web` : "Notepad++ Web");
    this.#chrome.setButtonActive("wordwrap", document?.wordWrap ?? false);
    this.#chrome.setButtonActive("split", this.#split);
  }

  #tabDescriptors(): TabDescriptor[] {
    return this.#documents.map((document) => ({
      id: document.id,
      label: tabLabel(document),
      dirty: document.dirty,
      active: document.id === this.#activeId,
    }));
  }

  /**
   * N++'s status bar fields. The encoding and line-ending columns only appear for
   * a document that has a file: a scratch buffer has no encoding on disk, and
   * stating one would be a guess (which is exactly what D4 forbids).
   *
   * Task 6 puts the **language first**, because that is where N++ puts it:
   * `NPPM_SETSTATUSBAR`'s part list (`Notepad_plus_msgs.h:185`) numbers the language
   * `STATUSBAR_DOC_TYPE = 0`, ahead of the document size, the caret position, the EOL format
   * and the encoding — and `setLangStatus()` (`Notepad_plus.cpp:3174`) is what writes it.
   * The wording is N++'s long name ("C++ source file"), which is what `getLangDesc()` hands
   * the status bar (`getName = false`); "Normal text file" is its `L_TEXT` row.
   */
  #status(document: OpenDocument | null): string[] {
    if (!document) return ["No document"];

    const { selection, tabSize } = document.state;
    const range = selection.main;
    const line = document.state.doc.lineAt(range.head);
    const parts = [
      document.language?.label ?? PLAIN_TEXT.label,
      `Ln ${line.number}, Col ${range.head - line.from + 1}`,
      `Sel: ${range.empty ? 0 : range.to - range.from}`,
      "Text",
      `Tab ${tabSize}`,
    ];

    if (document.handle) {
      const label = document.assumedEncoding
        ? `${document.format.encoding} (assumed)`
        : document.format.encoding;
      // A decode-only encoding is worth flagging in the status bar: the user finds
      // out here rather than when a save is refused.
      parts.push(canEncode(document.format.encoding) ? label : `${label} (save as UTF-8)`);
      parts.push(document.format.eol === "mixed" ? "Mixed EOL" : document.format.eol);
    }

    parts.push(document.wordWrap ? "Wrap on" : "Wrap off");
    return parts;
  }
}

/** Error text for a dialog — never a raw object dump. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * How long a burst of edits settles before the session is written. The *bodies* follow N++'s own
 * interval (`snapshotBackupTiming`); the record itself is small and is what a reload reads first,
 * so it is written far sooner than 7 s — the point of the delay is only to keep a burst of
 * keystrokes from being one IndexedDB transaction each.
 */
const SESSION_WRITE_DELAY_MS = 500;

/** What a restored document brings back with it — N++'s per-`File` session attributes. */
interface RestoreState {
  wordWrap: boolean;
  readOnly: boolean;
  language: LanguageDefinition | null;
  /**
   * The language's loaded extension, when the restore could wait for it. A restored document
   * loads its grammar *before* it is created rather than after it is mounted: `#loadLanguage`
   * reconfigures the views that exist at the time it resolves, and during a restore none exist
   * yet — so a lazy load here would leave the document unhighlighted (and unfoldable, since
   * `foldable()` needs a grammar) until the next reload happened to win the race.
   */
  languageExtension?: Extension;
  format: DocumentFormat;
  assumedEncoding: boolean;
  selection: SessionSelection;
  position: SessionPosition;
  marks: number[];
  folds: number[];
}

/** One session entry, after storage and the file system have been asked about it. */
interface RestorePlan {
  entry: SessionFile;
  outcome: "restore" | "placeholder" | "drop";
  /** The body to open with: a backup when there is one, otherwise the file's own text. */
  text: string;
  /** True when `text` came from `backup/` — which is what makes the document dirty. */
  fromBackup: boolean;
  /** The file's text, read anyway so the "modified by another program" question can be answered. */
  fileText: string | undefined;
  format: DocumentFormat;
  assumedEncoding: boolean;
  lastModified: number | undefined;
  language: LanguageDefinition | null;
  /** The grammar, already loaded — see `RestoreState.languageExtension` for why it is awaited. */
  languageExtension?: Extension;
  /**
   * True when the user answered N++'s reload question with *yes* — "reload it and lose the changes
   * made in Notepad++". That answer **is** the warning, so such a document must not also be counted
   * as work the restore failed to bring back.
   */
  discardedByUser: boolean;
}

/** What the last restore did. Read by `inspect()`, so the acceptance check asserts on numbers. */
interface RestoreReport {
  complete: boolean;
  restored: number;
  dropped: number;
  placeholders: number;
  unsavedLost: number;
}

/** The caret and selection as session numbers — N++'s `startPos`/`endPos`/`selMode`. */
function selectionOf(view: EditorView): SessionSelection {
  const range = view.state.selection.main;
  return {
    anchor: range.anchor,
    head: range.head,
    // N++ records the selection *mode*; a rectangular selection is the one worth distinguishing,
    // because restoring it as a plain range would silently change what is selected.
    mode: view.state.selection.ranges.length > 1 ? "column" : "stream",
  };
}

/** The viewport's top line and horizontal offset — N++'s `firstVisibleLine` and `xOffset`. */
function positionOf(view: EditorView): SessionPosition {
  const top = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
  return {
    firstVisibleLine: offsetToLine(view.state.doc, top.from),
    xOffset: Math.round(view.scrollDOM.scrollLeft),
  };
}

/**
 * A handle's file mtime, or `undefined` when it cannot be read. N++ tracks this to notice a file
 * that another program changed while the session was closed (`originalFileLastModifTimestamp`).
 */
async function fileTimestamp(handle: FileSystemFileHandle): Promise<number | undefined> {
  try {
    return (await handle.getFile()).lastModified;
  } catch {
    return undefined;
  }
}

/** A folded range, as `foldEffect`/`unfoldEffect` want it. */
interface FoldRange {
  from: number;
  to: number;
}

/** The ranges a view currently has folded. */
function foldRanges(state: EditorState): FoldRange[] {
  const ranges: FoldRange[] = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    ranges.push({ from, to });
  });
  return ranges;
}

/** Fold these ranges in a view — used to hand a document's folds to a freshly mounted clone. */
function applyFolds(target: EditorView, ranges: readonly FoldRange[]): void {
  if (ranges.length === 0) return;
  target.dispatch({ effects: ranges.map((range) => foldEffect.of(range)) });
}

function sameRanges(left: readonly FoldRange[], right: readonly FoldRange[]): boolean {
  return (
    left.length === right.length &&
    left.every((range, index) => range.from === right[index]?.from && range.to === right[index]?.to)
  );
}
