/**
 * Install, enable, disable, reload, uninstall, start (plan task P3).
 *
 * A plugin is source text in IndexedDB; "loading" it means importing that text as
 * an ES module from a blob URL, validating what it exports, and letting it
 * register through the `PluginContext`. Every failure is contained: the loader
 * resolves with `{ ok: false, error }`, records the message against the record for
 * the manager, and leaves the app running. Nothing here throws at the caller.
 *
 * Two behaviours worth knowing before reading the code:
 *
 *   - **Activation is time-boxed.** `activate()` may be async, and a page cannot
 *     block on it the way N++ blocks loading a DLL. A plugin that hangs is marked
 *     failed after `activationTimeoutMs`, its registrations are disposed, and any
 *     late `addCommand` is refused by the registry (which is why the registry
 *     refuses registration for a disposed plugin rather than accepting it quietly).
 *   - **Each enable is a new module instance.** A fresh blob URL is created on every
 *     enable, so a plugin edited on disk and re-enabled runs the new code; the old
 *     URL is revoked when the plugin stops. A module cannot be unloaded from the JS
 *     engine, so "disable" means "dispose everything and revoke the URL" — the
 *     manager says as much rather than implying more.
 */
import { MAX_PLUGINS, normaliseRecord, sourceProblem, validateModule, type PluginRecord } from "./model.ts";
import { countPlugins, deletePlugin, getPlugin, listPlugins, putPlugin } from "./store.ts";
import type { PluginContext } from "./api.ts";
import type { PluginRegistry } from "./registry.ts";

export interface PluginLoaderOptions {
  readonly registry: PluginRegistry;
  /** Build the context for a record — `createPluginContext` in `host.ts`. */
  readonly context: (record: PluginRecord) => PluginContext;
  /** True when the page asked for no plugins (`?plugins=off`). */
  readonly disabled?: boolean;
  /** Default 1500 ms — long enough for real work, short enough not to delay a start. */
  readonly activationTimeoutMs?: number;
  readonly log?: (...args: unknown[]) => void;
}

export interface PluginActionResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly id?: string;
}

export interface StartReport {
  readonly skipped: boolean;
  readonly loaded: string[];
  readonly failed: { readonly id: string; readonly error: string }[];
}

interface ActiveEntry {
  readonly record: PluginRecord;
  readonly url: string;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const DEFAULT_ACTIVATION_TIMEOUT_MS = 1500;

export class PluginLoader {
  readonly #registry: PluginRegistry;
  readonly #context: (record: PluginRecord) => PluginContext;
  readonly #disabled: boolean;
  readonly #timeout: number;
  readonly #log: (...args: unknown[]) => void;
  readonly #active = new Map<string, ActiveEntry>();

  constructor(options: PluginLoaderOptions) {
    this.#registry = options.registry;
    this.#context = options.context;
    this.#disabled = options.disabled ?? false;
    this.#timeout = options.activationTimeoutMs ?? DEFAULT_ACTIVATION_TIMEOUT_MS;
    this.#log = options.log ?? ((...args: unknown[]) => console.info("[plugins]", ...args));
  }

  isActive(id: string): boolean {
    return this.#active.has(id);
  }

  activeIds(): string[] {
    return [...this.#active.keys()];
  }

  /** Load every enabled plugin. Never throws; failures are reported per plugin. */
  async start(): Promise<StartReport> {
    const report: StartReport = { skipped: this.#disabled, loaded: [], failed: [] };
    if (this.#disabled) {
      this.#log("plugins are disabled for this page (?plugins=off)");
      return report;
    }
    for (const record of await listPlugins()) {
      if (!record.enabled) continue;
      const result = await this.enable(record.id);
      if (result.ok) report.loaded.push(record.id);
      else report.failed.push({ id: record.id, error: result.error ?? "unknown error" });
    }
    return report;
  }

  /**
   * Validate and store a plugin from source text, then enable it. The module is
   * imported once to read its metadata — which means its top-level code runs at
   * install time, exactly as Windows runs a DLL's `DllMain` to call `setInfo`. The
   * install dialog says so before the file picker opens.
   */
  async install(source: string, options: { enabled?: boolean } = {}): Promise<PluginActionResult> {
    // Recovery mode installs nothing: `?plugins=off` exists to get the app back,
    // and the manager's install controls are hidden while it is in force.
    if (this.#disabled) {
      return { ok: false, error: "plugins are disabled for this page (?plugins=off)" };
    }
    const problem = sourceProblem(source);
    if (problem) return { ok: false, error: problem };

    const temporaryUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    try {
      const module = (await import(/* @vite-ignore */ temporaryUrl)) as { default?: unknown };
      const checked = validateModule(module.default);
      if (!checked.ok || !checked.metadata) {
        return { ok: false, error: checked.errors.join("; ") };
      }
      const metadata = checked.metadata;
      const existing = await getPlugin(metadata.id);
      if (!existing && (await countPlugins()) >= MAX_PLUGINS) {
        return { ok: false, error: `only ${MAX_PLUGINS} plugins can be installed` };
      }
      const record = normaliseRecord(metadata, source, {
        enabled: options.enabled ?? true,
        installedAt: existing?.installedAt ?? Date.now(),
      });
      if (!(await putPlugin(record))) {
        return { ok: false, error: "the plugin could not be stored (storage is unavailable)" };
      }
      // Replacing a running copy: stop it first, without persisting "disabled".
      this.#teardown(record.id);
      if (!record.enabled) return { ok: true, id: record.id };
      return await this.enable(record.id);
    } catch (error) {
      return { ok: false, error: describe(error) };
    } finally {
      URL.revokeObjectURL(temporaryUrl);
    }
  }

  async enable(id: string): Promise<PluginActionResult> {
    if (this.#disabled) {
      return { ok: false, error: "plugins are disabled for this page (?plugins=off)" };
    }
    if (this.#active.has(id)) return { ok: true, id };
    const record = await getPlugin(id);
    if (!record) return { ok: false, error: `plugin ${id} is not installed` };

    const url = URL.createObjectURL(new Blob([record.source], { type: "text/javascript" }));
    let module: { default?: unknown };
    try {
      module = (await import(/* @vite-ignore */ url)) as { default?: unknown };
    } catch (error) {
      URL.revokeObjectURL(url);
      const message = describe(error);
      await this.#noteError(record, message);
      return { ok: false, error: message, id };
    }

    const checked = validateModule(module.default);
    if (!checked.ok || !checked.metadata || checked.metadata.id !== record.id) {
      URL.revokeObjectURL(url);
      const message = checked.ok
        ? `the installed source now declares id "${checked.metadata?.id}", not "${record.id}"`
        : checked.errors.join("; ");
      await this.#noteError(record, message);
      return { ok: false, error: message, id };
    }

    this.#registry.activate(id);
    const context = this.#context(record);
    try {
      const cleanup = await this.#activate(module.default as { activate(ctx: unknown): unknown }, context);
      if (typeof cleanup === "function") this.#registry.setCleanup(id, cleanup as () => void);
      this.#active.set(id, { record, url });
      // Persist the flag: `disable` writes `enabled: false`, so re-enabling must
      // write `true` or the plugin runs now and does not come back on reload.
      // Measured in P6: the manager showed "Enable" for a plugin that was running.
      if (!record.enabled || record.lastError) {
        await putPlugin({ ...record, enabled: true, lastError: null });
      }
      this.#log(`loaded ${record.name} ${record.version}`);
      return { ok: true, id };
    } catch (error) {
      this.#registry.disposePlugin(id);
      URL.revokeObjectURL(url);
      const message = describe(error);
      await this.#noteError(record, message);
      this.#log(`failed to load ${record.name}: ${message}`);
      return { ok: false, error: message, id };
    }
  }

  /** Stop a plugin and remember that it is off. */
  async disable(id: string): Promise<boolean> {
    const record = await getPlugin(id);
    this.#teardown(id);
    if (!record) return false;
    return putPlugin({ ...record, enabled: false });
  }

  /** Stop a plugin and delete its record and settings. */
  async uninstall(id: string): Promise<boolean> {
    this.#teardown(id);
    return deletePlugin(id);
  }

  /** Stop and start again, for an edited source or after a failure. */
  async reload(id: string): Promise<PluginActionResult> {
    const record = await getPlugin(id);
    if (!record) return { ok: false, error: `plugin ${id} is not installed` };
    this.#teardown(id);
    return this.enable(id);
  }

  /** Stop everything — page teardown, or a test's reset. */
  stopAll(): void {
    for (const id of [...this.#active.keys()]) this.#teardown(id);
  }

  #teardown(id: string): void {
    const entry = this.#active.get(id);
    if (entry) {
      URL.revokeObjectURL(entry.url);
      this.#active.delete(id);
    }
    this.#registry.disposePlugin(id);
  }

  async #noteError(record: PluginRecord, message: string): Promise<void> {
    await putPlugin({ ...record, lastError: message });
  }

  /**
   * Await `activate()` with a deadline. The still-running promise is not
   * cancelled — a promise cannot be — so it is left to settle with a swallowed
   * rejection, and its registrations are refused by the registry once disposed.
   */
  async #activate(plugin: { activate(ctx: unknown): unknown }, context: PluginContext): Promise<unknown> {
    const started = Promise.resolve().then(() => plugin.activate(context));
    started.catch(() => {
      /* a late rejection after the deadline must not become an unhandled one */
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`activate() did not finish within ${this.#timeout} ms`)),
        this.#timeout,
      );
    });
    try {
      return await Promise.race([started, deadline]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
