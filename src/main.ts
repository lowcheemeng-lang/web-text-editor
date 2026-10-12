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
 *
 * Task 8 adds one thing to the entry point: a production build registers the offline
 * shell (`src/pwa/service-worker.js`). It is registered *after* the app is up, so the
 * first paint never waits on a worker installing, and it is production-only because the
 * dev server serves unbundled modules that must not be cached (see `src/pwa/register.ts`).
 */
import { Workspace } from "./editor/workspace";
import { registerOfflineShell } from "./pwa/register";

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

if (import.meta.env.PROD) {
  // The page that registers the worker is not yet controlled by it; every load after this one is.
  void registerOfflineShell();
} else {
  window.__workspace = workspace;
  console.info("[task 3] Notepad++ Web workspace mounted; exposed as window.__workspace");
}
