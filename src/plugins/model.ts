/**
 * Plugin records, validation and shortcut conflicts — the half of the plugin host
 * that can be checked without a browser (plan task P2).
 *
 * Deliberately imports no CodeMirror and touches no DOM, so
 * `scripts/test-plugins.mjs` can run it under `node --experimental-strip-types`
 * and pin the rules that decide whether a plugin is accepted *before* any loader
 * exists. The same rule the theme tables follow (S18): data and policy in a
 * dependency-free module, browser wiring in another.
 */

/** The shape a plugin module's default export must have (docs/plugins.md §4). */
export interface PluginModule {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly apiVersion: number;
  readonly description?: string;
  readonly author?: string;
  activate(ctx: unknown): void | (() => void) | Promise<void | (() => void)>;
  deactivate?(): void;
}

/** What the app stores per installed plugin. `source` is the module text as installed. */
export interface PluginRecord {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly apiVersion: number;
  readonly description: string;
  readonly author: string;
  readonly source: string;
  readonly enabled: boolean;
  readonly installedAt: number;
  readonly lastError: string | null;
}

export interface PluginMetadata {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly apiVersion: number;
  readonly description: string;
  readonly author: string;
}

/** The one API version this build speaks. A plugin written for another is refused. */
export const SUPPORTED_API_VERSION = 1;

/** A source cap, not a storage quota: plugin code is text and should stay small. */
export const MAX_SOURCE_BYTES = 512 * 1024;
/** Enough to be useful, few enough that the manager stays a list. */
export const MAX_PLUGINS = 100;
/** Per-plugin settings cap; the app itself never stores this much per feature. */
export const MAX_SETTINGS_BYTES = 64 * 1024;

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const COMMAND_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export const MAX_NAME_LENGTH = 64;
export const MAX_DESCRIPTION_LENGTH = 200;
export const MAX_AUTHOR_LENGTH = 80;

/* ------------------------------------------------------------------ metadata */

export interface ValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
  /** Present only when `ok`. */
  readonly metadata?: PluginMetadata;
}

function text(value: unknown, limit: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= limit ? value : null;
}

/** An optional text field: absent or empty is fine, too long is not. */
function optionalText(value: unknown, limit: number): string | null {
  if (value === undefined || value === null) return "";
  return typeof value === "string" && value.length <= limit ? value : null;
}

/**
 * Validate a module's declared metadata. Unknown extra keys are ignored rather
 * than rejected: a plugin may carry its own fields, and refusing them would make
 * the host the arbiter of naming it does not own.
 */
export function validateMetadata(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null) {
    return { ok: false, errors: ["a plugin module must export an object"] };
  }
  const candidate = input as Record<string, unknown>;

  const id = typeof candidate.id === "string" ? candidate.id : "";
  if (!ID_PATTERN.test(id)) {
    errors.push(
      "id must be 3–64 characters of a–z, 0–9, dot, dash or underscore, starting with a letter or digit",
    );
  }

  const name = text(candidate.name, MAX_NAME_LENGTH);
  if (!name) errors.push(`name must be 1–${MAX_NAME_LENGTH} characters`);

  const version = typeof candidate.version === "string" ? candidate.version : "";
  if (!VERSION_PATTERN.test(version)) errors.push("version must be a semantic version, e.g. 1.2.0");

  const apiVersion = candidate.apiVersion;
  if (typeof apiVersion !== "number" || !Number.isInteger(apiVersion) || apiVersion < 1) {
    errors.push("apiVersion must be a positive integer");
  } else if (apiVersion !== SUPPORTED_API_VERSION) {
    errors.push(
      `apiVersion ${apiVersion} is not supported; this build speaks API version ${SUPPORTED_API_VERSION}`,
    );
  }

  const description =
    candidate.description === undefined
      ? ""
      : optionalText(candidate.description, MAX_DESCRIPTION_LENGTH);
  if (description === null) {
    errors.push(`description must be at most ${MAX_DESCRIPTION_LENGTH} characters`);
  }

  const author =
    candidate.author === undefined ? "" : optionalText(candidate.author, MAX_AUTHOR_LENGTH);
  if (author === null) errors.push(`author must be at most ${MAX_AUTHOR_LENGTH} characters`);

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    metadata: {
      id: id as string,
      name: name as string,
      version,
      apiVersion: apiVersion as number,
      description: description ?? "",
      author: author ?? "",
    },
  };
}

/** Validate the module *shape*: metadata plus a callable `activate`. */
export function validateModule(input: unknown): ValidationResult {
  const metadata = validateMetadata(input);
  const errors = [...metadata.errors];
  if (typeof input === "object" && input !== null) {
    const activate = (input as Record<string, unknown>).activate;
    if (typeof activate !== "function") errors.push("the module must export an activate(ctx) function");
    const deactivate = (input as Record<string, unknown>).deactivate;
    if (deactivate !== undefined && typeof deactivate !== "function") {
      errors.push("deactivate, when present, must be a function");
    }
  }
  return errors.length > 0 ? { ok: false, errors } : metadata;
}

/* -------------------------------------------------------------------- source */

export function sourceBytes(source: string): number {
  return new TextEncoder().encode(source).length;
}

/** `null` when the source is acceptable, otherwise the reason it is not. */
export function sourceProblem(source: unknown): string | null {
  if (typeof source !== "string" || source.trim().length === 0) return "the plugin source is empty";
  if (sourceBytes(source) > MAX_SOURCE_BYTES) {
    return `the plugin source is larger than ${Math.round(MAX_SOURCE_BYTES / 1024)} KB`;
  }
  return null;
}

/* -------------------------------------------------------------------- record */

export interface RecordOptions {
  readonly enabled?: boolean;
  readonly installedAt?: number;
  readonly lastError?: string | null;
}

/** Build the stored record from validated metadata and source text. */
export function normaliseRecord(
  metadata: PluginMetadata,
  source: string,
  options: RecordOptions = {},
): PluginRecord {
  return Object.freeze({
    id: metadata.id,
    name: metadata.name,
    version: metadata.version,
    apiVersion: metadata.apiVersion,
    description: metadata.description,
    author: metadata.author,
    source,
    enabled: options.enabled ?? true,
    installedAt: options.installedAt ?? Date.now(),
    lastError: options.lastError ?? null,
  });
}

/* ------------------------------------------------------------------ commands */

/** Namespacing a command id is what makes two plugins unable to collide. */
export function commandIdFor(pluginId: string, commandId: string): string {
  return `${pluginId}/${commandId}`;
}

export function isCommandId(value: unknown): value is string {
  return typeof value === "string" && COMMAND_PATTERN.test(value);
}

/* ----------------------------------------------------------------- shortcuts */

export interface ShortcutBinding {
  readonly pluginId: string;
  readonly commandId: string;
  readonly shortcut: string;
}

export interface ShortcutConflict {
  readonly pluginId: string;
  readonly commandId: string;
  readonly shortcut: string;
  /** `invalid` = the chord cannot be parsed at all. */
  readonly reason: "browser" | "app" | "plugin" | "invalid";
}

/**
 * Chords the page never receives, or receives without the ability to cancel them.
 * Ctrl+F is measured rather than assumed (S6 / `scripts/probe-reserved-keys.py`):
 * `preventDefault` cannot suppress Chrome's find bar. The rest are Chrome's own
 * standard bindings, listed so a plugin author gets a clear refusal instead of a
 * shortcut that silently does nothing.
 */
export const BROWSER_RESERVED_SHORTCUTS: readonly string[] = Object.freeze([
  "ctrl+f",
  "ctrl+p",
  "ctrl+n",
  "ctrl+o",
  "ctrl+s",
  "ctrl+t",
  "ctrl+w",
  "ctrl+shift+n",
  "ctrl+shift+t",
  "ctrl+shift+w",
  "ctrl+shift+p",
  "ctrl+shift+i",
  "ctrl+shift+j",
  "ctrl+tab",
  "ctrl+shift+tab",
  "ctrl+1",
  "ctrl+2",
  "ctrl+3",
  "ctrl+4",
  "ctrl+5",
  "ctrl+6",
  "ctrl+7",
  "ctrl+8",
  "ctrl+9",
  "ctrl+0",
  "f5",
  "f6",
  "f11",
  "f12",
  "alt+left",
  "alt+right",
]);

const MODIFIER_ORDER = ["ctrl", "alt", "shift", "meta"] as const;
const MODIFIER_ALIASES: Readonly<Record<string, string>> = {
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  option: "alt",
  shift: "shift",
  meta: "meta",
  cmd: "meta",
  command: "meta",
  mod: "mod", // resolved per platform by expandShortcut
};

const NAMED_KEY = /^f\d{1,2}$|^(left|right|up|down|home|end|pageup|pagedown|space|enter|tab|backspace|delete|escape)$/;

/**
 * CodeMirror writes chords as `Mod-z`, `Ctrl-Shift-z`, `Alt-F` (dash), this
 * module's own notation uses `Ctrl+Shift+Z` (plus). Both are accepted, because
 * the host's conflict list comes from `nppKeymap()` and is dash-shaped — a
 * plus-only parser silently finds no conflicts at all, which a plugin would
 * discover only after its shortcut shadowed Ctrl+S.
 */
function splitChord(shortcut: string): string[] {
  return shortcut
    .split(/[+-]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** CodeMirror's key names mapped onto the canonical names this module uses. */
const KEY_ALIASES: Readonly<Record<string, string>> = {
  arrowleft: "left",
  arrowright: "right",
  arrowup: "up",
  arrowdown: "down",
  esc: "escape",
};

/** Normalise one concrete chord: modifiers sorted, key lower-cased. */
export function normaliseShortcut(shortcut: string): string | null {
  const parts = splitChord(shortcut);
  if (parts.length === 0) return null;
  const rawKey = (parts[parts.length - 1] ?? "").toLowerCase();
  const key = KEY_ALIASES[rawKey] ?? rawKey;
  if (parts.length === 1) {
    // A bare chord is only a function or named key (F2, Home, Escape). A bare
    // letter would make typing impossible, so it is not a shortcut at all.
    return NAMED_KEY.test(key) ? key : null;
  }
  if (!/^[a-z0-9]$/.test(key) && !NAMED_KEY.test(key)) return null;
  const modifiers = new Set<string>();
  for (const part of parts.slice(0, -1)) {
    const canonical = MODIFIER_ALIASES[part.toLowerCase()];
    if (!canonical) return null;
    modifiers.add(canonical);
  }
  if (modifiers.has("mod")) {
    // Resolved by expandShortcut; a lone "Mod+X" is not a concrete chord.
    modifiers.delete("mod");
    modifiers.add("ctrl");
    return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key].join("+");
  }
  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key].join("+");
}

/**
 * Every concrete chord a shortcut can mean. `Mod` is this app's cross-platform
 * alias: Ctrl on Windows/Linux, Meta on macOS — a plugin using it must conflict
 * with both, or a macOS collision would slip through on a Linux check.
 */
export function expandShortcut(shortcut: string): string[] {
  const parts = splitChord(shortcut);
  const usesMod = parts.slice(0, -1).some((part) => part.toLowerCase() === "mod");
  if (!usesMod) {
    const normalised = normaliseShortcut(shortcut);
    return normalised ? [normalised] : [];
  }
  const withoutMod = parts.filter((part) => part.toLowerCase() !== "mod").join("+");
  const variants = new Set<string>();
  for (const replacement of ["Ctrl", "Meta"]) {
    const normalised = normaliseShortcut(`${replacement}+${withoutMod}`);
    if (normalised) variants.add(normalised);
  }
  return [...variants];
}

/**
 * Which of these bindings cannot be registered, and why. `knownKeys` is the
 * app's own binding list (the host passes `nppKeymap({})`'s keys plus
 * `SEARCH_KEYS`/`WEB_PORT_KEYS`); it is a parameter rather than an import so
 * this module stays free of CodeMirror and Node can test it.
 */
export function findShortcutConflicts(
  bindings: readonly ShortcutBinding[],
  knownKeys: readonly string[],
): ShortcutConflict[] {
  const appChords = new Set<string>();
  for (const key of knownKeys) for (const chord of expandShortcut(key)) appChords.add(chord);

  const seen = new Map<string, ShortcutBinding>();
  const conflicts: ShortcutConflict[] = [];

  for (const binding of bindings) {
    const chords = expandShortcut(binding.shortcut);
    if (chords.length === 0) {
      conflicts.push({ ...binding, reason: "invalid" });
      continue;
    }
    let reason: ShortcutConflict["reason"] | null = null;
    for (const chord of chords) {
      if (BROWSER_RESERVED_SHORTCUTS.includes(chord)) {
        reason = "browser";
        break;
      }
      if (appChords.has(chord)) {
        reason = "app";
        break;
      }
      if (seen.has(chord)) {
        reason = "plugin";
        break;
      }
    }
    if (reason) {
      conflicts.push({ ...binding, reason });
      continue;
    }
    for (const chord of chords) seen.set(chord, binding);
  }

  return conflicts;
}

/* ------------------------------------------------------------------- versions */

/**
 * Compare two semantic-ish versions: numeric parts first, then a pre-release
 * suffix sorts *below* the release it belongs to (`1.0.0-rc.1 < 1.0.0`). Enough
 * for a manager's "newer than" note; full semver range semantics are not needed.
 */
export function compareVersions(left: string, right: string): number {
  const split = (value: string): { numbers: number[]; pre: string } => {
    const [main = "", pre = ""] = value.split("-", 2);
    return {
      numbers: main.split(".").map((part) => Number.parseInt(part, 10) || 0),
      pre,
    };
  };
  const a = split(left);
  const b = split(right);
  for (let index = 0; index < Math.max(a.numbers.length, b.numbers.length); index += 1) {
    const difference = (a.numbers[index] ?? 0) - (b.numbers[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  if (a.pre === b.pre) return 0;
  if (a.pre === "") return 1;
  if (b.pre === "") return -1;
  return a.pre > b.pre ? 1 : -1;
}
