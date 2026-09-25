/**
 * Application entry point.
 *
 * Scope of Task 2: prove the toolchain end to end — a real CodeMirror 6 instance
 * rendering in the browser, built by Vite, type-checked by tsc. The Notepad++
 * chrome, keymaps, tabs and file I/O arrive in Tasks 3–5; this file is
 * deliberately thin so those tasks have an obvious place to grow into.
 *
 * Editor core is CodeMirror 6 per decision D2 (see docs/editor-core-decision.md).
 */
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";

import "./style.css";

declare global {
  interface Window {
    /** Dev-only handle, used for manual poking and automated verification. */
    __editor?: EditorView;
  }
}

const WELCOME = `Notepad++ Web — Task 2 scaffold

The toolchain works: Vite served this page, tsc type-checked it, and CodeMirror 6
is rendering this document with syntax highlighting and line numbers.

Deliberately absent so far (they are later tasks, not omissions):
  - Notepad++ chrome: menu bar, toolbar, tab strip, status bar   (Task 3)
  - open / save / save-as without a backend                      (Task 4)
  - find / replace, bookmarks, go-to-line                        (Task 5)
  - the ~20 first-class languages + legacy-modes long tail       (Task 6)
  - session restore and preferences                              (Task 7)
  - PWA / offline packaging                                      (Task 8)

Progress ledger: PROGRESS.md   |   Reporter: npm run status
`;

const mount = document.querySelector<HTMLElement>("#app");

if (!mount) {
  throw new Error("index.html is missing the #app mount point");
}

export const view = new EditorView({
  state: EditorState.create({
    doc: WELCOME,
    // basicSetup is provisional: Task 3 replaces it with an explicit extension
    // list tuned to Notepad++ defaults (indent unit, line wrapping, gutters).
    extensions: [basicSetup],
  }),
  parent: mount,
});

if (import.meta.env.DEV) {
  window.__editor = view;
  console.info("[scaffold] CodeMirror 6 mounted; view exposed as window.__editor");
}
