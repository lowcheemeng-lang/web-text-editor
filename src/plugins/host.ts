/**
 * The `PluginContext` factory (plan task P3).
 *
 * This is the only place a plugin's capabilities are assembled, and it is
 * deliberately thin: `registry` owns what a plugin registers, `workspace` owns the
 * documents, `ui` owns dialogs and notices, and `store` owns settings. A plugin
 * never receives the `OpenDocument`, the `EditorView` or the chrome — it receives
 * this object, and everything it can reach is visible in `api.ts`.
 *
 * `docs/plugins.md` §4 is the prose contract; when this file and that table
 * disagree, `api.ts` is authoritative.
 */
import type { Extension } from "@codemirror/state";

import type { DocumentInfo, PluginContext, SelectionInfo, UiApi } from "./api.ts";
import { cm } from "./cm.ts";
import type { PluginRecord } from "./model.ts";
import type { PluginRegistry } from "./registry.ts";
import { readSettings, writeSetting } from "./store.ts";

/**
 * The document operations a plugin may perform. `Workspace` implements this in P4;
 * keeping it an interface means this module can be typed and reasoned about
 * without importing the editor, and a test can hand it a fake.
 */
export interface WorkspaceBridge {
  documents(): DocumentInfo[];
  active(): DocumentInfo | null;
  text(documentId?: string): string | null;
  setText(text: string, documentId?: string): boolean;
  selections(documentId?: string): SelectionInfo[];
  replaceSelections(
    map: (text: string, index: number) => string,
    documentId?: string,
  ): boolean;
}

export interface ContextOptions {
  readonly record: PluginRecord;
  readonly registry: PluginRegistry;
  readonly workspace: WorkspaceBridge;
  readonly ui: UiApi;
  readonly log?: (...args: unknown[]) => void;
}

export function createPluginContext(options: ContextOptions): PluginContext {
  const { record, registry, workspace, ui } = options;
  const pluginId = record.id;
  const log = options.log ?? ((...args: unknown[]) => console.info(`[plugin ${pluginId}]`, ...args));

  const commandKey = (id: string): string => `${pluginId}/${id}`;

  return {
    apiVersion: 1,
    plugin: Object.freeze({ id: pluginId, name: record.name, version: record.version }),
    cm,

    commands: {
      register: (spec) => registry.addCommand(pluginId, spec),
      run(id) {
        const command = registry.findCommand(commandKey(id));
        if (!command || !command.enabled) return false;
        try {
          return command.run() !== false;
        } catch (error) {
          registry.noteError(pluginId, error);
          return false;
        }
      },
      setEnabled(id, enabled) {
        const command = registry.findCommand(commandKey(id));
        if (command) command.enabled = enabled;
      },
    },

    editor: {
      documents: () => workspace.documents(),
      active: () => workspace.active(),
      text: (documentId) => workspace.text(documentId),
      setText: (text, documentId) => workspace.setText(text, documentId),
      selections: (documentId) => workspace.selections(documentId),
      replaceSelections: (map, documentId) => workspace.replaceSelections(map, documentId),
      addExtension: (extension: Extension) => registry.addExtension(pluginId, extension),
    },

    panels: {
      register: (spec) => registry.addPanel(pluginId, spec),
    },

    toolbar: {
      addButton: (spec) => registry.addButton(pluginId, spec),
    },

    events: {
      on: (type, handler) => registry.subscribe(pluginId, type, handler),
    },

    ui,

    settings: {
      async get<T = unknown>(key: string, fallback?: T): Promise<T | undefined> {
        const all = await readSettings(pluginId);
        return (key in all ? all[key] : fallback) as T | undefined;
      },
      async set(key: string, value: unknown): Promise<void> {
        if (!(await writeSetting(pluginId, key, value))) {
          throw new Error("the plugin's settings could not be saved (storage unavailable or over its cap)");
        }
      },
      all: () => readSettings(pluginId),
    },

    log,
  };
}
