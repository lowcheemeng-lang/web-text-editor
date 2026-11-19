/**
 * Dev-only harness for the **plugin host spike** (plan task P1).
 *
 * What it exists to measure, before any host code is designed in:
 *
 *   1. a plugin can be loaded as an ES module from a **blob URL** (`import()`),
 *      in the dev server and in a production build;
 *   2. an extension the plugin builds from the **host's own** CodeMirror modules
 *      is accepted by a mounted view — the "singleton" rule, because CM6 keys
 *      extension behaviour on class identity and a second copy of the library
 *      would be rejected or silently ignored;
 *   3. the same extension reaches **both panes** of a split view, through one
 *      `Compartment` that both states carry (the mechanism P4 wires into
 *      `editorCoreExtensions`);
 *   4. disposing a plugin's registrations removes its effect from both panes;
 *   5. a module that throws in `activate` is contained: the editor still works;
 *   6. a persisted source re-imports on the next page load with a **fresh** blob
 *      URL (the storage half is P2's; this measures the module cache behaviour).
 *
 * Not reachable from `index.html` → `main.ts`, so it never enters the production
 * bundle; `scripts/spike-plugin-host.py` imports it straight from the dev server.
 * Keep it that way: it is evidence, not an app feature.
 */
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import * as cmState from "@codemirror/state";
import * as cmView from "@codemirror/view";
import * as cmCommands from "@codemirror/commands";
import * as cmSearch from "@codemirror/search";
import * as cmLanguage from "@codemirror/language";

import { cloneHistoryKeymap, editorCoreExtensions, nppKeymap } from "./notepadpp-config";
import {
  createDocumentRuntime,
  makeSyncDispatcher,
  registerView,
  type DocumentRuntime,
} from "./split-view";

const SPIKE_DOC = [
  "Notepad++ Web — plugin host spike",
  "",
  "Two views over one document, as in the real split view: an owner pane that",
  "holds the undo history and a clone without one. A plugin added through the",
  "shared plugin compartment must appear in both, and disappear from both when",
  "it is disposed.",
  "",
  ...Array.from({ length: 20 }, (_, i) => `filler ${i + 1}`),
].join("\n");

export interface SpikePluginResults {
  [key: string]: unknown;
}

export interface SpikePluginSnapshot {
  /** Every blob URL this page created, in order — two enables must differ. */
  urls: string[];
  /** Whatever the plugin wrote into `ctx.results`. */
  results: SpikePluginResults;
  ownerText: string;
  cloneText: string;
  ownerHasClass: boolean;
  cloneHasClass: boolean;
  ownerMarks: number;
  cloneMarks: number;
  extensions: number;
}

interface SpikeContext {
  apiVersion: 1;
  plugin: { id: string; name: string; version: string };
  cm: {
    state: typeof cmState;
    view: typeof cmView;
    commands: typeof cmCommands;
    search: typeof cmSearch;
    language: typeof cmLanguage;
  };
  editor: {
    addExtension(extension: Extension): { dispose(): void };
    hostView(): EditorView | null;
  };
  results: SpikePluginResults;
  log(...args: unknown[]): void;
}

export interface SpikePluginHarness {
  runtime: DocumentRuntime;
  owner: EditorView;
  clone: EditorView;
  /** Import a plugin module from source text and activate it. */
  load(source: string): Promise<{ ok: boolean; error?: string; id?: string; url?: string }>;
  /** Dispose everything the active plugins registered, and clear their extensions. */
  unload(): void;
  snapshot(): SpikePluginSnapshot;
  destroy(): void;
}

declare global {
  interface Window {
    __spikePlugin?: SpikePluginHarness;
  }
}

function pane(host: HTMLElement, id: string, label: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.id = id;
  wrap.style.flex = "1 1 50%";
  wrap.style.minWidth = "0";
  wrap.style.minHeight = "0";
  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";
  wrap.style.background = "#fff";

  const title = document.createElement("div");
  title.textContent = label;
  title.style.font = "12px sans-serif";
  title.style.padding = "2px 6px";
  title.style.background = "#e4e4e4";

  const body = document.createElement("div");
  body.style.flex = "1 1 auto";
  body.style.minHeight = "0";
  body.style.display = "flex";
  body.style.flexDirection = "column";

  wrap.append(title, body);
  host.appendChild(wrap);
  return body;
}

/** Mount the spike over the whole viewport so Playwright can reach both panes. */
export function runSpikePluginHost(host: HTMLElement = document.body): SpikePluginHarness {
  const overlay = document.createElement("div");
  overlay.id = "spike-plugin";
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.zIndex = "9999";
  overlay.style.display = "flex";
  overlay.style.gap = "1px";
  overlay.style.background = "#666";
  host.appendChild(overlay);

  const left = pane(overlay, "spike-plugin-owner", "owner pane (history)");
  const right = pane(overlay, "spike-plugin-clone", "clone pane (no history)");

  /**
   * The one compartment both states carry. P4 puts this same shape into
   * `editorCoreExtensions`; here it is local so the spike measures the mechanism
   * without changing application code first.
   */
  const pluginCompartment = new Compartment();

  const ownerState = EditorState.create({
    doc: SPIKE_DOC,
    extensions: [
      ...editorCoreExtensions({}),
      keymap.of(nppKeymap({})),
      pluginCompartment.of([]),
    ],
  });

  const runtime = createDocumentRuntime();
  const owner = new EditorView({
    state: ownerState,
    parent: left,
    dispatch: makeSyncDispatcher(runtime),
  });
  registerView(runtime, owner);

  const cloneState = EditorState.create({
    doc: ownerState.doc,
    extensions: [
      ...editorCoreExtensions({}),
      keymap.of(cloneHistoryKeymap(() => runtime.views[0])),
      pluginCompartment.of([]),
    ],
  });
  const clone = new EditorView({
    state: cloneState,
    parent: right,
    dispatch: makeSyncDispatcher(runtime),
  });
  registerView(runtime, clone);

  /** Extensions the active plugins contributed, in registration order. */
  let active: Extension[] = [];
  const urls: string[] = [];
  const results: SpikePluginResults = {};
  const cleanups: Array<() => void> = [];
  /** The blob URL of the most recent successful import, for `ctx.plugin`. */
  let current: { id: string; name: string; version: string; url: string } | null = null;

  const apply = (): void => {
    const effect = pluginCompartment.reconfigure(active);
    for (const view of [owner, clone]) view.dispatch({ effects: effect });
  };

  const context: SpikeContext = {
    apiVersion: 1,
    get plugin() {
      return {
        id: current?.id ?? "spike.unknown",
        name: current?.name ?? "Spike plugin",
        version: current?.version ?? "0.0.0",
      };
    },
    cm: {
      state: cmState,
      view: cmView,
      commands: cmCommands,
      search: cmSearch,
      language: cmLanguage,
    },
    editor: {
      addExtension(extension: Extension) {
        active = [...active, extension];
        apply();
        return {
          dispose() {
            active = active.filter((candidate) => candidate !== extension);
            apply();
          },
        };
      },
      hostView: () => owner,
    },
    results,
    log: (...args: unknown[]) => console.info("[spike plugin]", ...args),
  };

  async function load(
    source: string,
  ): Promise<{ ok: boolean; error?: string; id?: string; url?: string }> {
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    urls.push(url);
    try {
      // `@vite-ignore` keeps Vite from trying to resolve a runtime URL.
      const module = (await import(/* @vite-ignore */ url)) as {
        default?: {
          id?: string;
          name?: string;
          version?: string;
          activate?: (ctx: SpikeContext) => unknown;
        };
      };
      const plugin = module.default;
      if (!plugin || typeof plugin.activate !== "function") {
        return { ok: false, error: "no default export with activate()", url };
      }
      current = {
        id: plugin.id ?? "spike.unknown",
        name: plugin.name ?? "Spike plugin",
        version: plugin.version ?? "0.0.0",
        url,
      };
      const cleanup = await plugin.activate(context);
      if (typeof cleanup === "function") cleanups.push(cleanup as () => void);
      return { ok: true, id: current.id, url };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        url,
      };
    }
  }

  function unload(): void {
    while (cleanups.length > 0) {
      const cleanup = cleanups.pop();
      try {
        cleanup?.();
      } catch (error) {
        console.error("[spike plugin] cleanup threw", error);
      }
    }
    active = [];
    apply();
  }

  function snapshot(): SpikePluginSnapshot {
    return {
      urls: [...urls],
      results: { ...results },
      ownerText: owner.state.doc.toString(),
      cloneText: clone.state.doc.toString(),
      ownerHasClass: owner.dom.classList.contains("plugin-probe"),
      cloneHasClass: clone.dom.classList.contains("plugin-probe"),
      ownerMarks: owner.dom.querySelectorAll(".plugin-probe-mark").length,
      cloneMarks: clone.dom.querySelectorAll(".plugin-probe-mark").length,
      extensions: active.length,
    };
  }

  const harness: SpikePluginHarness = {
    runtime,
    owner,
    clone,
    load,
    unload,
    snapshot,
    destroy() {
      for (const view of [owner, clone]) view.destroy();
      overlay.remove();
      delete window.__spikePlugin;
    },
  };

  window.__spikePlugin = harness;
  return harness;
}

export default runSpikePluginHost;
