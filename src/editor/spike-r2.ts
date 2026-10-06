/**
 * Dev-only harness for the **R2 spike** — see PROGRESS.md, "Do R2 first".
 *
 * Risk R2 asks whether two CodeMirror 6 views can present one document as N++'s
 * split view / clone-to-other-view. This module mounts that experiment in a real
 * browser so `scripts/spike-r2-split.py` can drive it with real keystrokes:
 *
 *   - a *synced* pair using the production mechanism (`src/editor/split-view.ts`),
 *   - a *naive* pair (two views, one initial state, no sync) as the control that
 *     reproduces the divergence the CM6 docs describe.
 *
 * Layout: top row = the synced pair (fills the viewport), bottom strip = control.
 * It is not reachable from `index.html` → `main.ts`, so it never enters the
 * production bundle; `scripts/spike-r2-split.py` imports it straight from the dev
 * server. Keep it that way: it is evidence, not an app feature.
 */
import { EditorView } from "@codemirror/view";
import type { Transaction } from "@codemirror/state";

import { createCloneState, createDocumentState, NPP_WORD_WRAP } from "./notepadpp-config";
import {
  createDocumentRuntime,
  makeSyncDispatcher,
  registerView,
  type DocumentRuntime,
} from "./split-view";

const SPIKE_DOC = [
  "Notepad++ Web — R2 spike document",
  "",
  "This buffer is shown by two CodeMirror views at once: the left one owns the",
  "undo history, the right one is a clone without a history of its own.",
  "",
  "Typing in either pane must appear in the other; Ctrl+Z in either pane must undo",
  "the shared edit exactly once; selection and scroll must stay per-view.",
  "",
  // Enough lines that the panes actually scroll (check 7 needs a scrollable view).
  ...Array.from({ length: 60 }, (_, i) => `filler line ${String(i + 1).padStart(2, "0")} — scroll independence needs a long document`),
  "",
].join("\n");

export interface SpikeCounts {
  source: number;
  clone: number;
}

export interface SpikeHarness {
  runtime: DocumentRuntime;
  source: EditorView;
  clone: EditorView;
  counts: SpikeCounts;
  naive: { initial: string; a: EditorView; b: EditorView };
  wordWrap: boolean;
  destroy(): void;
}

declare global {
  interface Window {
    __spikeR2?: SpikeHarness;
  }
}

function row(host: HTMLElement, flex: string, height?: string): HTMLElement {
  const el = document.createElement("div");
  el.style.display = "flex";
  el.style.flex = flex;
  el.style.minHeight = "0";
  el.style.gap = "1px";
  el.style.background = "#666";
  if (height) el.style.height = height;
  host.appendChild(el);
  return el;
}

function pane(host: HTMLElement, id: string, label: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.id = id;
  wrap.style.flex = "1 1 50%";
  wrap.style.minWidth = "0";
  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";
  wrap.style.background = "#fff";

  const title = document.createElement("div");
  title.textContent = label;
  title.style.font = "12px sans-serif";
  title.style.padding = "2px 6px";
  title.style.background = "#e4e4e4";
  title.style.flex = "0 0 auto";

  const body = document.createElement("div");
  body.style.flex = "1 1 auto";
  body.style.minHeight = "0";
  body.style.display = "flex";
  body.style.flexDirection = "column";

  wrap.append(title, body);
  host.appendChild(wrap);
  return body;
}

/** Mount the R2 spike over the whole viewport so Playwright can click either pane. */
export function runSpikeR2(host: HTMLElement = document.body): SpikeHarness {
  const overlay = document.createElement("div");
  overlay.id = "spike-r2";
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.zIndex = "9999";
  overlay.style.display = "flex";
  overlay.style.flexDirection = "column";
  overlay.style.background = "#666";
  overlay.style.gap = "1px";
  host.appendChild(overlay);

  const top = row(overlay, "1 1 auto");
  const bottom = row(overlay, "0 0 auto", "130px");

  const left = pane(top, "spike-source", "split view — owner (history)");
  const right = pane(top, "spike-clone", "clone to other view (no history)");
  const naiveLeft = pane(bottom, "spike-naive-a", "control: two views, one state, no sync (A)");
  const naiveRight = pane(bottom, "spike-naive-b", "control (B)");

  const runtime = createDocumentRuntime();
  const counts: SpikeCounts = { source: 0, clone: 0 };
  const sync = makeSyncDispatcher(runtime);
  const counting = (which: keyof SpikeCounts) => (tr: Transaction, view: EditorView) => {
    counts[which] += 1;
    sync(tr, view);
  };

  const sourceState = createDocumentState(SPIKE_DOC, { wordWrap: NPP_WORD_WRAP });
  const source = new EditorView({
    state: sourceState,
    parent: left,
    dispatch: counting("source"),
  });
  registerView(runtime, source);

  const cloneState = createCloneState(source.state.doc, () => runtime.views[0], {
    wordWrap: NPP_WORD_WRAP,
  });
  const clone = new EditorView({
    state: cloneState,
    parent: right,
    dispatch: counting("clone"),
  });
  registerView(runtime, clone);

  // Control group: the naive "two views, one state, no sync" that R2 warned about.
  const naiveState = createDocumentState(SPIKE_DOC, { wordWrap: NPP_WORD_WRAP });
  const naiveA = new EditorView({ state: naiveState, parent: naiveLeft });
  const naiveB = new EditorView({ state: naiveState, parent: naiveRight });

  const harness: SpikeHarness = {
    runtime,
    source,
    clone,
    counts,
    naive: { initial: naiveState.doc.toString(), a: naiveA, b: naiveB },
    wordWrap: NPP_WORD_WRAP,
    destroy() {
      for (const view of [source, clone, naiveA, naiveB]) view.destroy();
      overlay.remove();
      delete window.__spikeR2;
    },
  };

  window.__spikeR2 = harness;
  return harness;
}

export default runSpikeR2;
