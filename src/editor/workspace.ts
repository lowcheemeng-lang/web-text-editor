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
import { EditorView } from "@codemirror/view";
import { indentUnit } from "@codemirror/language";

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
import { ensureAccess, forgetRecent, listRecent, rememberRecent } from "../file/recent-files";
import type { RecentFile } from "../file/recent-files";
import type { DocumentFormat } from "../file/types";
import { detectCapabilities, unsupportedNotice } from "../platform/capabilities";

import { Chrome, type MenuEntry, type PaneElements, type TabDescriptor } from "./chrome";
import {
  NPP_WORD_WRAP,
  WEB_PORT_KEYS,
  createCloneState,
  createDocumentState,
  wordWrapCompartment,
  wordWrapExtension,
  type NppCommandHandlers,
} from "./notepadpp-config";
import {
  createDocumentRuntime,
  makeSyncDispatcher,
  ownerView,
  registerView,
  unregisterView,
} from "./split-view";
import { backAtSavePoint, newDocumentName, tabLabel, type OpenDocument } from "./tabs";

/** What a scratch buffer claims until it is given a file of its own. */
const DEFAULT_FORMAT: DocumentFormat = { encoding: "utf-8", bom: "none", eol: "LF" };

/** Shown in the first document so a fresh clone explains what it can do. */
const WELCOME = `Notepad++ Web — Task 4

Multi-document tabs, Notepad++'s editor defaults, split view, and real files.

Keys (the N++ ones are deliberately different — see below):
  Alt+N          new document          Alt+O   open a file
  Alt+S          save                  Alt+Shift+S  save as
  Alt+W          close document        Alt+C   clone this document to a second pane
  Alt+PageUp     previous document     Alt+PageDown  next document
  Alt+Z          toggle word wrap      Ctrl+Z / Ctrl+Y  undo / redo
  Tab            indent by a real tab character

Why not Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+W? Chrome owns all four (new window,
open, save page, close tab) and no web page can intercept them, so the
substitutes move to Alt. The originals are listed in DEVIATIONS_FROM_NPP.

Files are read and written with the File System Access API, which is what makes
a byte-identical round-trip possible: the encoding, byte-order mark and line
endings a file arrives with are the ones it is saved with, unless you change
them. Nothing here talks to a server — there is no backend at all (decision D1).
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
  };

  readonly #chrome: Chrome;
  readonly #primary: PaneElements;
  readonly #capabilities = detectCapabilities();
  #secondary: PaneElements | null = null;
  #disposeSplitterDrag: (() => void) | null = null;

  readonly #documents: OpenDocument[] = [];
  #activeId: string | null = null;
  #nextDocumentNumber = 0;
  #split = false;
  #lastStatusSignature = "";
  /**
   * File ▸ Recent renders synchronously and IndexedDB does not, so the list is
   * cached here and refreshed on startup and after every open or save. A file
   * changed in another tab therefore appears after the next refresh rather than
   * instantly — an acceptable lag for a convenience list.
   */
  #recent: RecentFile[] = [];

  constructor(host: HTMLElement) {
    this.#chrome = new Chrome(host);
    this.#primary = this.#chrome.addPane("primary", "before-splitter");
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

  /** Create the first document, load the recent list, and report a browser we cannot use. */
  start(): void {
    this.newDocument(WELCOME);
    void this.#refreshRecent();
    const notice = unsupportedNotice(this.#capabilities);
    if (notice) this.#chrome.showNotice(notice.title, notice.body);
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
        ],
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

  async #refreshRecent(): Promise<void> {
    this.#recent = await listRecent();
  }

  /* ------------------------------------------------------------ documents */

  /** Open a new document and switch to it (N++ File ▸ New). */
  newDocument(content = ""): OpenDocument {
    this.#nextDocumentNumber += 1;
    const document = this.#createDocument(newDocumentName(this.#nextDocumentNumber), content);
    this.#documents.push(document);
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
  } {
    const document = this.#active();
    const owner = document ? ownerView(document.runtime) : undefined;
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
    };
  }

  #createDocument(
    name: string,
    content: string,
    file?: { handle: FileSystemFileHandle; format: DocumentFormat; assumedEncoding: boolean },
  ): OpenDocument {
    const runtime = createDocumentRuntime();
    const state = createDocumentState(content, {
      handlers: this.#handlers,
      wordWrap: NPP_WORD_WRAP,
    });
    const document: OpenDocument = {
      id: `d${this.#documents.length + 1}-${this.#nextDocumentNumber}`,
      name,
      savedText: state.doc,
      dirty: false,
      wordWrap: NPP_WORD_WRAP,
      runtime,
      state,
      format: file?.format ?? { ...DEFAULT_FORMAT },
    };
    if (file) {
      document.handle = file.handle;
      document.assumedEncoding = file.assumedEncoding;
    }
    // Fired by split-view's dispatcher, once per transaction, for every view.
    runtime.onUpdate = (view) => this.#onUpdate(document, view);
    return document;
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

    this.#render();
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
   */
  async #adopt(handle: FileSystemFileHandle): Promise<boolean> {
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
    });
    this.#documents.push(document);
    this.#show(document.id);

    await rememberRecent(handle);
    await this.#refreshRecent();

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
    // Save As can land on a file that was not in the list before.
    await rememberRecent(handle);
    await this.#refreshRecent();
    this.#render();
    return true;
  }

  async #showUnsupported(): Promise<void> {
    const notice = unsupportedNotice(this.#capabilities);
    if (notice) await this.#chrome.alert({ title: notice.title, body: notice.body });
  }

  /* ----------------------------------------------------------- tab switches */

  #show(id: string): void {
    if (this.#activeId === id) return;
    this.#teardownActive();
    this.#activeId = id;
    this.#mountActive();
    this.#render();
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
      }),
      parent: this.#secondary.editorHost,
      dispatch: makeSyncDispatcher(document.runtime),
    });
    registerView(document.runtime, view);
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

  /* ---------------------------------------------------------------- closing */

  #closeActive(): void {
    const document = this.#active();
    if (!document) return;
    void this.#close(document);
  }

  async #close(document: OpenDocument): Promise<void> {
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
    if (wasActive) this.#teardownActive();
    this.#documents.splice(index, 1);

    if (wasActive) {
      this.#activeId = null;
      // Land on the neighbour N++ would pick; none left means an empty window.
      const next = this.#documents[Math.min(index, this.#documents.length - 1)];
      if (next) this.#show(next.id);
    }
    this.#render();
  }

  /* --------------------------------------------------------------- rendering */

  #active(): OpenDocument | null {
    return this.#documents.find((document) => document.id === this.#activeId) ?? null;
  }

  #render(): void {
    const document = this.#active();

    this.#chrome.renderTabs(this.#primary, this.#tabDescriptors(), {
      activate: (id) => this.#show(id),
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
   */
  #status(document: OpenDocument | null): string[] {
    if (!document) return ["No document"];

    const { selection, tabSize } = document.state;
    const range = selection.main;
    const line = document.state.doc.lineAt(range.head);
    const parts = [
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
