/**
 * The orchestrator for Task 3: it ties the four existing pieces together.
 *
 *   chrome.ts             pure-DOM shell (toolbar, panes, tab strips, status bar)
 *   tabs.ts               document model (dirty flag, save point, tab captions)
 *   notepadpp-config.ts   Notepad++ defaults: states, theme, keymaps
 *   split-view.ts         two views over one document with one undo history
 *
 * It is the only module that mutates documents, so the chrome stays free of
 * editor state and `tabs.ts` stays free of DOM.
 *
 * ── The split model, stated plainly ──────────────────────────────────────────
 * Split view shows the *active document* in two panes (Notepad++'s "clone to
 * other view"). Both panes therefore show the same document, edits appear in
 * both, and there is one undo history — `views[0]` owns it. Notepad++'s other
 * flavour of split — each pane carrying its own independent tab set — is Tier 2
 * in `docs/scope.md` and is deliberately not built here; a single shared tab
 * strip plus a mirrored pane is what the plan's step 3 asks for ("a second view
 * over the same state").
 *
 * Keyboard: `WEB_PORT_KEYS` because Chrome owns Ctrl+N / Ctrl+W / Ctrl+Tab and
 * no page can intercept them (recorded in `DEVIATIONS_FROM_NPP`).
 */
import { EditorView } from "@codemirror/view";
import { indentUnit } from "@codemirror/language";

import { Chrome, type PaneElements, type TabDescriptor } from "./chrome";
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

/** Shown in the first document so a fresh clone explains what it can do. */
const WELCOME = `Notepad++ Web — Task 3

Multi-document tabs, Notepad++'s editor defaults, and split view.

Keys (the N++ ones are deliberately different — see below):
  Alt+N          new document          Alt+W   close document
  Alt+PageUp     previous document     Alt+PageDown  next document
  Alt+Z          toggle word wrap      Alt+S   split / clone this document
  Ctrl+Z / Ctrl+Y                      undo / redo
  Tab                                    indent by a real tab character

Why not Ctrl+N and Ctrl+W? Chrome owns them (new window / close tab) and no web
page can intercept them, so the menu-key equivalents move to Alt. N++'s Ctrl+N,
Ctrl+W and Ctrl+Tab are listed in DEVIATIONS_FROM_NPP.

Nothing here talks to a server: open and save arrive in Task 4 via the File
System Access API, and this editor has no backend at all (decision D1).
`;

export class Workspace {
  /** Key handlers live in a field so states created later close over them. */
  readonly #handlers: NppCommandHandlers = {
    newDocument: () => {
      this.newDocument();
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
    toggleSplitView: () => {
      this.toggleSplit();
      return true;
    },
    cloneToOtherView: () => {
      this.toggleSplit();
      return true;
    },
  };

  readonly #chrome: Chrome;
  readonly #primary: PaneElements;
  #secondary: PaneElements | null = null;
  #disposeSplitterDrag: (() => void) | null = null;

  readonly #documents: OpenDocument[] = [];
  #activeId: string | null = null;
  #nextDocumentNumber = 0;
  #split = false;
  #lastStatusSignature = "";

  constructor(host: HTMLElement) {
    this.#chrome = new Chrome(host);
    this.#primary = this.#chrome.addPane("primary", "before-splitter");

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
      title: `Split view — show this document in a second pane (${WEB_PORT_KEYS.toggleSplitView})`,
      onClick: () => {
        this.toggleSplit();
        return this.#split;
      },
    });
  }

  /** Create the first document. Call once, after construction. */
  start(): void {
    this.newDocument(WELCOME);
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
   * Dev/verification handle — the numbers `scripts/verify-task3.py` asserts on.
   * Read-only; exposed on `window.__workspace` in dev builds.
   */
  inspect(): {
    documents: number;
    tabs: string[];
    activeName: string | null;
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
  } {
    const document = this.#active();
    const owner = document ? ownerView(document.runtime) : undefined;
    return {
      documents: this.#documents.length,
      tabs: this.#documents.map(tabLabel),
      activeName: document?.name ?? null,
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
    };
  }

  #createDocument(name: string, content: string): OpenDocument {
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
    };
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
      // N++ offers Save / Don't Save / Cancel. Saving is Task 4, so offering it
      // now would be a button that lies — only discard and cancel exist yet.
      const discard = await this.#chrome.confirm({
        title: `Close ${document.name}?`,
        body: `${document.name} has unsaved changes. Closing it now discards them. Saving a file arrives with Task 4 (open / save).`,
        confirmLabel: "Discard",
        cancelLabel: "Cancel",
      });
      if (!discard) return;
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
   * N++'s status bar fields. Line ending and encoding belong to the document's
   * file, which does not exist until Task 4, so they are deliberately absent
   * rather than guessed.
   */
  #status(document: OpenDocument | null): string[] {
    if (!document) return ["No document", "Tab 4", "Wrap off"];
    const { selection, tabSize } = document.state;
    const range = selection.main;
    const line = document.state.doc.lineAt(range.head);
    return [
      `Ln ${line.number}, Col ${range.head - line.from + 1}`,
      `Sel: ${range.empty ? 0 : range.to - range.from}`,
      "Text",
      `Tab ${tabSize}`,
      document.wordWrap ? "Wrap on" : "Wrap off",
    ];
  }
}
