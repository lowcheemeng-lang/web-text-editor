/**
 * Application entry point.
 *
 * The page is the Notepad++-style application assembled by `Workspace`: menu bar,
 * toolbar, per-pane tab strips, status bar, multi-document editing, split/clone
 * view, and — since Task 4 — real files through the File System Access API.
 *
 * Editor core is CodeMirror 6 per decision D2 (docs/editor-core-decision.md).
 * There is no backend of any kind (decision D1), which is why every file
 * operation lives in `src/file/file-io.ts` and nothing here fetches anything.
 *
 * `Workspace.start()` also reports an unsupported browser, so this file needs no
 * capability logic of its own.
 */
import { Workspace } from "./editor/workspace";

import "./style.css";

declare global {
  interface Window {
    /** Dev-only handle, used for manual poking and automated verification. */
    __workspace?: Workspace;
  }
}

const mount = document.querySelector<HTMLElement>("#app");

if (!mount) {
  throw new Error("index.html is missing the #app mount point");
}

export const workspace = new Workspace(mount);
workspace.start();

if (import.meta.env.DEV) {
  window.__workspace = workspace;
  console.info("[task 3] Notepad++ Web workspace mounted; exposed as window.__workspace");
}
