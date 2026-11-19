/**
 * What a plugin registered while it is active, and what has to be undone when it
 * stops (plan task P3).
 *
 * The registry owns *registration*, not UI and not CodeMirror: it keeps commands,
 * panel specs, toolbar buttons, event handlers and extensions, validates what it
 * is given, and tells the app when any of those changed. The app's response —
 * rebuilding a menu, reconfiguring a compartment — is wired in P4. That split is
 * what lets `scripts/test-plugins.mjs` exercise every rule in Node: this module
 * imports no DOM and no CodeMirror (the `Extension` import is a type).
 *
 * A registration made after its plugin was disposed throws rather than silently
 * succeeding. That matters because activation can time out while the plugin's own
 * async work is still running: a late `addCommand` must not resurrect a plugin the
 * manager has already marked failed.
 */
import type { Extension } from "@codemirror/state";

import type {
  CommandSpec,
  Disposable,
  PanelHandle,
  PanelSpec,
  PluginEventPayload,
  PluginEventType,
  ToolbarButtonSpec,
} from "./api.ts";
import { commandIdFor, findShortcutConflicts, isCommandId } from "./model.ts";

export class PluginRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginRegistrationError";
  }
}

export interface RegisteredCommand {
  readonly pluginId: string;
  readonly commandId: string;
  /** Namespaced: `<plugin id>/<command id>`. */
  readonly key: string;
  readonly label: string;
  readonly shortcut?: string;
  readonly toolbar?: { readonly title?: string };
  readonly checked?: () => boolean;
  run(): boolean | void;
  enabled: boolean;
}

export interface RegisteredPanel {
  readonly pluginId: string;
  readonly spec: PanelSpec;
  visible: boolean;
}

export interface RegisteredButton {
  readonly pluginId: string;
  readonly spec: ToolbarButtonSpec;
}

interface ExtensionEntry {
  readonly pluginId: string;
  readonly extension: Extension;
}

interface ActiveState {
  readonly id: string;
  readonly commands: Map<string, RegisteredCommand>;
  readonly panels: Map<string, RegisteredPanel>;
  readonly buttons: Map<string, RegisteredButton>;
  readonly handlers: Map<PluginEventType, Set<(payload: PluginEventPayload) => void>>;
  readonly disposables: Disposable[];
  cleanup: (() => void) | null;
  lastError: string | null;
}

export interface RegistryOptions {
  /** The app's own bindings, in either notation — see `model.ts`'s `splitChord`. */
  readonly knownKeys?: readonly string[];
  readonly onCommandsChanged?: () => void;
  readonly onPanelsChanged?: () => void;
  readonly onButtonsChanged?: () => void;
  readonly onExtensionsChanged?: (extensions: readonly Extension[]) => void;
}

const REASON_TEXT: Readonly<Record<string, string>> = {
  browser: "is reserved by the browser",
  app: "is already used by the application",
  plugin: "is already used by another plugin",
  invalid: "is not a valid shortcut",
};

export class PluginRegistry {
  readonly #options: RegistryOptions;
  readonly #states = new Map<string, ActiveState>();
  #extensions: ExtensionEntry[] = [];

  constructor(options: RegistryOptions = {}) {
    this.#options = options;
  }

  isActive(pluginId: string): boolean {
    return this.#states.has(pluginId);
  }

  /** Begin accepting registrations for a plugin. Idempotent. */
  activate(pluginId: string): void {
    if (this.#states.has(pluginId)) return;
    this.#states.set(pluginId, {
      id: pluginId,
      commands: new Map(),
      panels: new Map(),
      buttons: new Map(),
      handlers: new Map(),
      disposables: [],
      cleanup: null,
      lastError: null,
    });
  }

  #state(pluginId: string): ActiveState {
    const state = this.#states.get(pluginId);
    if (!state) throw new PluginRegistrationError(`plugin ${pluginId} is not active`);
    return state;
  }

  setCleanup(pluginId: string, cleanup: () => void): void {
    this.#state(pluginId).cleanup = cleanup;
  }

  /* --------------------------------------------------------------- commands */

  addCommand(pluginId: string, spec: CommandSpec): Disposable {
    const state = this.#state(pluginId);
    if (!isCommandId(spec.id)) {
      throw new PluginRegistrationError(
        `command id "${String(spec.id)}" must be 1–64 characters of a–z, 0–9, dot, dash or underscore`,
      );
    }
    if (state.commands.has(spec.id)) {
      throw new PluginRegistrationError(`command "${spec.id}" is already registered by ${pluginId}`);
    }
    if (typeof spec.label !== "string" || spec.label.trim().length === 0) {
      throw new PluginRegistrationError(`command "${spec.id}" needs a label`);
    }
    if (spec.shortcut) {
      // Check against the app's bindings *and* every other plugin's, so two plugins
      // cannot silently share a chord. The new binding is the one reported.
      const existing = this.commands()
        .filter((command) => command.shortcut !== undefined)
        .map((command) => ({
          pluginId: command.pluginId,
          commandId: command.commandId,
          shortcut: command.shortcut as string,
        }));
      const conflicts = findShortcutConflicts(
        [...existing, { pluginId, commandId: spec.id, shortcut: spec.shortcut }],
        this.#options.knownKeys ?? [],
      );
      const own = conflicts.find(
        (conflict) => conflict.pluginId === pluginId && conflict.commandId === spec.id,
      );
      if (own) {
        throw new PluginRegistrationError(
          `command "${spec.id}": shortcut "${spec.shortcut}" ${REASON_TEXT[own.reason] ?? "conflicts"}`,
        );
      }
    }

    const command: RegisteredCommand = {
      pluginId,
      commandId: spec.id,
      key: commandIdFor(pluginId, spec.id),
      label: spec.label,
      shortcut: spec.shortcut,
      toolbar: spec.toolbar,
      checked: spec.checked,
      run: spec.run,
      enabled: true,
    };
    state.commands.set(spec.id, command);
    this.#options.onCommandsChanged?.();
    return {
      dispose: () => {
        if (state.commands.delete(spec.id)) this.#options.onCommandsChanged?.();
      },
    };
  }

  /** Every registered command, in registration order (plugin activation order). */
  commands(): RegisteredCommand[] {
    const all: RegisteredCommand[] = [];
    for (const state of this.#states.values()) all.push(...state.commands.values());
    return all;
  }

  findCommand(key: string): RegisteredCommand | null {
    for (const state of this.#states.values()) {
      for (const command of state.commands.values()) if (command.key === key) return command;
    }
    return null;
  }

  /* ----------------------------------------------------------------- panels */

  addPanel(pluginId: string, spec: PanelSpec): PanelHandle {
    const state = this.#state(pluginId);
    if (state.panels.has(spec.id)) {
      throw new PluginRegistrationError(`panel "${spec.id}" is already registered by ${pluginId}`);
    }
    if (typeof spec.title !== "string" || spec.title.trim().length === 0) {
      throw new PluginRegistrationError(`panel "${spec.id}" needs a title`);
    }
    const panel: RegisteredPanel = { pluginId, spec, visible: false };
    state.panels.set(spec.id, panel);
    const notify = (): void => this.#options.onPanelsChanged?.();

    const safe = (fn: (() => void) | undefined): void => {
      if (!fn) return;
      try {
        fn();
      } catch (error) {
        this.noteError(pluginId, error);
      }
    };

    notify();
    return {
      get visible() {
        return panel.visible;
      },
      show: () => {
        if (panel.visible) return;
        panel.visible = true;
        safe(spec.onShow);
        notify();
      },
      hide: () => {
        if (!panel.visible) return;
        panel.visible = false;
        safe(spec.onHide);
        notify();
      },
      dispose: () => {
        if (state.panels.delete(spec.id)) {
          panel.visible = false;
          notify();
        }
      },
    };
  }

  panels(): RegisteredPanel[] {
    const all: RegisteredPanel[] = [];
    for (const state of this.#states.values()) all.push(...state.panels.values());
    return all;
  }

  /* ---------------------------------------------------------------- toolbar */

  addButton(pluginId: string, spec: ToolbarButtonSpec): Disposable {
    const state = this.#state(pluginId);
    if (state.buttons.has(spec.id)) {
      throw new PluginRegistrationError(`toolbar button "${spec.id}" is already registered by ${pluginId}`);
    }
    state.buttons.set(spec.id, { pluginId, spec });
    this.#options.onButtonsChanged?.();
    return {
      dispose: () => {
        if (state.buttons.delete(spec.id)) this.#options.onButtonsChanged?.();
      },
    };
  }

  buttons(): RegisteredButton[] {
    const all: RegisteredButton[] = [];
    for (const state of this.#states.values()) all.push(...state.buttons.values());
    return all;
  }

  /* ------------------------------------------------------------------ events */

  subscribe(
    pluginId: string,
    type: PluginEventType,
    handler: (payload: PluginEventPayload) => void,
  ): Disposable {
    const state = this.#state(pluginId);
    let handlers = state.handlers.get(type);
    if (!handlers) {
      handlers = new Set();
      state.handlers.set(type, handlers);
    }
    handlers.add(handler);
    return {
      dispose: () => {
        handlers?.delete(handler);
      },
    };
  }

  /**
   * Deliver an event to every subscriber. A handler that throws is contained and
   * recorded against its plugin: one plugin's bug must not stop the others, and
   * must not reach the editor's own dispatch path.
   */
  emit(type: PluginEventType, payload: Omit<PluginEventPayload, "type"> = {}): void {
    for (const state of [...this.#states.values()]) {
      const handlers = state.handlers.get(type);
      if (!handlers) continue;
      for (const handler of [...handlers]) {
        try {
          handler({ type, ...payload });
        } catch (error) {
          this.noteError(state.id, error);
        }
      }
    }
  }

  /* -------------------------------------------------------------- extensions */

  addExtension(pluginId: string, extension: Extension): Disposable {
    this.#state(pluginId);
    const entry: ExtensionEntry = { pluginId, extension };
    this.#extensions = [...this.#extensions, entry];
    this.#publishExtensions();
    return {
      dispose: () => {
        const next = this.#extensions.filter((candidate) => candidate !== entry);
        if (next.length !== this.#extensions.length) {
          this.#extensions = next;
          this.#publishExtensions();
        }
      },
    };
  }

  extensions(): readonly Extension[] {
    return this.#extensions.map((entry) => entry.extension);
  }

  #publishExtensions(): void {
    this.#options.onExtensionsChanged?.(this.extensions());
  }

  /* ------------------------------------------------------------------ errors */

  /** Record a plugin's error and return the message the manager will show. */
  noteError(pluginId: string, error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const state = this.#states.get(pluginId);
    if (state) state.lastError = message;
    return message;
  }

  lastError(pluginId: string): string | null {
    return this.#states.get(pluginId)?.lastError ?? null;
  }

  errors(): Record<string, string> {
    const all: Record<string, string> = {};
    for (const state of this.#states.values()) if (state.lastError) all[state.id] = state.lastError;
    return all;
  }

  /* ---------------------------------------------------------------- teardown */

  /**
   * Undo everything one plugin registered, then forget it. Idempotent: disposing
   * a plugin that is not active is a no-op, which is what makes the loader's
   * "disable an already-disabled plugin" path harmless.
   */
  disposePlugin(pluginId: string): void {
    const state = this.#states.get(pluginId);
    if (!state) return;

    for (const disposable of [...state.disposables].reverse()) {
      try {
        disposable.dispose();
      } catch (error) {
        this.noteError(pluginId, error);
      }
    }
    state.disposables.length = 0;

    const before = this.#extensions.length;
    this.#extensions = this.#extensions.filter((entry) => entry.pluginId !== pluginId);
    const extensionsChanged = this.#extensions.length !== before;

    state.commands.clear();
    state.panels.clear();
    state.buttons.clear();
    state.handlers.clear();
    this.#states.delete(pluginId);

    if (state.cleanup) {
      try {
        state.cleanup();
      } catch (error) {
        // The plugin is already gone from the registry; keep the message for the log.
        console.warn(`[plugins] ${pluginId} cleanup threw`, error);
      }
    }

    if (extensionsChanged) this.#publishExtensions();
    this.#options.onCommandsChanged?.();
    this.#options.onPanelsChanged?.();
    this.#options.onButtonsChanged?.();
  }

  /** Drop every plugin — a reload, or a test's reset. */
  clear(): void {
    for (const pluginId of [...this.#states.keys()]) this.disposePlugin(pluginId);
  }

  count(): number {
    return this.#states.size;
  }
}
