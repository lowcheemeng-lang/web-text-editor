/**
 * Application entry point.
 *
 * Task 3 replaces the Task 2 scaffold: `basicSetup` is gone, and the page is now
 * the Notepad++-style application — toolbar, per-pane tab strips, status bar,
 * multi-document editing and split/clone view — assembled by `Workspace`.
 *
 * Editor core is CodeMirror 6 per decision D2 (docs/editor-core-decision.md);
 * there is no backend of any kind (decision D1).
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
