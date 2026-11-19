#!/usr/bin/env node
/**
 * P2 — the plugin model and store, checked without a browser.
 *
 *     node --experimental-strip-types scripts/test-plugins.mjs
 *
 * What this pins is the *policy* a plugin is admitted under: the id and version
 * shapes, the API gate, the source cap counted in UTF-8 bytes rather than
 * characters, the shortcut-conflict rules (browser-reserved first, then the app's
 * own bindings, then other plugins), and the store's fail-soft contract in an
 * environment with no IndexedDB at all — which is exactly Node.
 *
 * The browser half (`scripts/verify-task-plugins.py`, P7) proves the loader and
 * the UI. This file proves the decisions they rely on, so a later change to a cap
 * or a conflict rule has to say what it changed.
 */
import {
  BROWSER_RESERVED_SHORTCUTS,
  MAX_AUTHOR_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
  MAX_SETTINGS_BYTES,
  MAX_SOURCE_BYTES,
  SUPPORTED_API_VERSION,
  commandIdFor,
  compareVersions,
  expandShortcut,
  findShortcutConflicts,
  isCommandId,
  normaliseRecord,
  normaliseShortcut,
  sourceBytes,
  sourceProblem,
  toKeymapKey,
  validateMetadata,
  validateModule,
} from "../src/plugins/model.ts";
import {
  countPlugins,
  deletePlugin,
  listPlugins,
  putPlugin,
  readSettings,
  removeSetting,
  settingsBytes,
  writeSetting,
} from "../src/plugins/store.ts";
import { PluginRegistry } from "../src/plugins/registry.ts";
import { PluginLoader } from "../src/plugins/loader.ts";

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`PASS  ${name}${detail ? `  [${detail}]` : ""}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`FAIL  ${name}${detail ? `  [${detail}]` : ""}`);
  }
}

const base = {
  id: "example.base64",
  name: "Base64 (example)",
  version: "1.0.0",
  apiVersion: SUPPORTED_API_VERSION,
  activate() {},
};

/* ---------------------------------------------------------------- metadata */

check("a minimal valid module is accepted", validateMetadata(base).ok === true);
check("the supported API version is 1", SUPPORTED_API_VERSION === 1);

const defaults = validateMetadata(base);
check("description defaults to empty", defaults.metadata?.description === "");
check("author defaults to empty", defaults.metadata?.author === "");

check("short id rejected", validateMetadata({ ...base, id: "ab" }).ok === false);
check("uppercase id rejected", validateMetadata({ ...base, id: "Example.Base64" }).ok === false);
check("id starting with a dot rejected", validateMetadata({ ...base, id: ".hidden" }).ok === false);
check("path traversal in id rejected", validateMetadata({ ...base, id: "../escape" }).ok === false);
check("empty name rejected", validateMetadata({ ...base, name: "" }).ok === false);
check(
  "over-long name rejected",
  validateMetadata({ ...base, name: "x".repeat(MAX_NAME_LENGTH + 1) }).ok === false,
);
check("two-part version rejected", validateMetadata({ ...base, version: "1.0" }).ok === false);
check(
  "pre-release version accepted",
  validateMetadata({ ...base, version: "1.0.0-rc.1" }).ok === true,
);

const wrongApi = validateMetadata({ ...base, apiVersion: 2 });
check("a plugin for API 2 is refused", wrongApi.ok === false);
check(
  "the refusal names the supported version",
  wrongApi.errors.some((error) => error.includes("API version 1")),
  wrongApi.errors.join("; "),
);
check("API version 0 rejected", validateMetadata({ ...base, apiVersion: 0 }).ok === false);
check(
  'API version "1" (a string) rejected',
  validateMetadata({ ...base, apiVersion: "1" }).ok === false,
);
check(
  "an empty description is allowed",
  validateMetadata({ ...base, description: "" }).ok === true,
);
check(
  "an over-long description is refused",
  validateMetadata({ ...base, description: "x".repeat(MAX_DESCRIPTION_LENGTH + 1) }).ok === false,
);
check(
  "an over-long author is refused",
  validateMetadata({ ...base, author: "x".repeat(MAX_AUTHOR_LENGTH + 1) }).ok === false,
);
check("a non-object is refused", validateMetadata("not a module").ok === false);

/* ------------------------------------------------------------------ module */

check("a module with activate is accepted", validateModule(base).ok === true);
check(
  "a module without activate is refused",
  validateModule({ ...base, activate: undefined }).ok === false,
);
check(
  "a non-function deactivate is refused",
  validateModule({ ...base, deactivate: 42 }).ok === false,
);
check(
  "a module with deactivate is accepted",
  validateModule({ ...base, deactivate() {} }).ok === true,
);

/* ------------------------------------------------------------------ source */

check("an empty source is refused", sourceProblem("") !== null);
check("a whitespace-only source is refused", sourceProblem("   \n\t ") !== null);
check(
  "a source at the cap is accepted",
  sourceProblem("a".repeat(MAX_SOURCE_BYTES)) === null,
  `${MAX_SOURCE_BYTES} bytes`,
);
check(
  "a source one byte over the cap is refused",
  sourceProblem("a".repeat(MAX_SOURCE_BYTES + 1)) !== null,
);
const multibyte = "é".repeat(Math.ceil(MAX_SOURCE_BYTES / 2) + 1);
check(
  "the cap counts UTF-8 bytes, not characters",
  sourceBytes(multibyte) > MAX_SOURCE_BYTES && sourceProblem(multibyte) !== null,
  `${multibyte.length} chars, ${sourceBytes(multibyte)} bytes`,
);

/* ------------------------------------------------------------------ record */

const record = normaliseRecord(validateMetadata(base).metadata, "export default {}");
check("the record is frozen", Object.isFrozen(record) === true);
check("a new record is enabled by default", record.enabled === true);
check("a new record has no error", record.lastError === null);
check("the install time is recorded", typeof record.installedAt === "number");
const disabled = normaliseRecord(validateMetadata(base).metadata, "x", {
  enabled: false,
  installedAt: 123,
  lastError: "boom",
});
check(
  "options override the defaults",
  disabled.enabled === false && disabled.installedAt === 123 && disabled.lastError === "boom",
);

/* ----------------------------------------------------------------- commands */

check(
  "command ids are namespaced by plugin",
  commandIdFor("example.base64", "encode") === "example.base64/encode",
);
check("a valid command id is accepted", isCommandId("encode-selection") === true);
check("a command id with a space is refused", isCommandId("encode selection") === false);
check("an uppercase command id is refused", isCommandId("Encode") === false);

/* ---------------------------------------------------------------- shortcuts */

check(
  "modifiers are sorted and lower-cased",
  normaliseShortcut("Shift+Ctrl+B") === "ctrl+shift+b",
);
check("a bare key is not a chord", normaliseShortcut("b") === null);
check("an unknown modifier is refused", normaliseShortcut("Hyper+B") === null);
check("an unknown key is refused", normaliseShortcut("Ctrl+Banana") === null);
check(
  "Mod expands to both Ctrl and Meta",
  JSON.stringify(expandShortcut("Mod+Z")) === JSON.stringify(["ctrl+z", "meta+z"]),
);

// The host's own conflict list comes from `nppKeymap()`, i.e. CodeMirror's
// dash-shaped `Alt-F` / `Ctrl-Shift-z`. Parsing only `+` would leave every app
// binding invisible, which is how this bug was found.
check("CodeMirror's dash notation is parsed", normaliseShortcut("Alt-F") === "alt+f");
check(
  "CodeMirror modifier order is canonicalised",
  normaliseShortcut("Ctrl-Shift-z") === "ctrl+shift+z",
);
check("CodeMirror key names are aliased", normaliseShortcut("Shift-ArrowLeft") === "shift+left");
check("a plus-shaped shortcut becomes a CodeMirror key", toKeymapKey("Ctrl+Alt+U") === "Ctrl-Alt-u");
check("a dash-shaped shortcut keeps its spelling", toKeymapKey("Ctrl-Shift-z") === "Ctrl-Shift-z");
check(
  "named keys are spelled the CodeMirror way",
  toKeymapKey("Shift-ArrowLeft") === "Shift-ArrowLeft",
);
check("Mod stays Mod for CodeMirror's own alias", toKeymapKey("Mod+Z") === "Mod-z");
check("an invalid shortcut has no keymap key", toKeymapKey("Nonsense") === null);

const appKeys = ["Ctrl+S", "Alt-F", "Ctrl-Shift-F", "F2", "Mod-z", "Ctrl+Alt+K"];
const conflicts = (bindings) => findShortcutConflicts(bindings, appKeys);

check(
  "a browser-reserved chord is refused",
  conflicts([{ pluginId: "p.one", commandId: "save", shortcut: "Ctrl+S" }])[0]?.reason === "browser",
);
check(
  "Ctrl+F is refused — the page cannot cancel Chrome's find bar (S6)",
  conflicts([{ pluginId: "p.one", commandId: "find", shortcut: "Ctrl+F" }])[0]?.reason === "browser",
);
check(
  "an app binding is refused",
  conflicts([{ pluginId: "p.one", commandId: "find", shortcut: "Alt+F" }])[0]?.reason === "app",
);
check(
  "a plus-form chord is checked against a dash-form app key",
  conflicts([{ pluginId: "p.one", commandId: "reindent", shortcut: "Ctrl+Shift+F" }])[0]?.reason ===
    "app",
);
check(
  "Ctrl+Alt+K collides with the app's own chord",
  conflicts([{ pluginId: "p.one", commandId: "x", shortcut: "Ctrl+Alt+K" }])[0]?.reason === "app",
);
check(
  "Mod conflicts with the app's Mod binding on both platforms",
  conflicts([{ pluginId: "p.one", commandId: "undo", shortcut: "Meta+Z" }])[0]?.reason === "app",
);
check(
  "two plugins cannot share a chord",
  conflicts([
    { pluginId: "p.one", commandId: "a", shortcut: "Ctrl+Alt+B" },
    { pluginId: "p.two", commandId: "b", shortcut: "Ctrl+Alt+B" },
  ]).length === 1,
);
const duplicate = conflicts([
  { pluginId: "p.one", commandId: "a", shortcut: "Ctrl+Alt+B" },
  { pluginId: "p.two", commandId: "b", shortcut: "Ctrl+Alt+B" },
]);
check("the second plugin is the one refused", duplicate[0]?.pluginId === "p.two");
check(
  "an unparseable shortcut is refused as invalid",
  conflicts([{ pluginId: "p.one", commandId: "a", shortcut: "Nonsense" }])[0]?.reason === "invalid",
);
check(
  "a free chord is allowed",
  conflicts([{ pluginId: "p.one", commandId: "a", shortcut: "Ctrl+Alt+B" }]).length === 0,
);
check(
  "the reserved list is concrete chords, not prose",
  BROWSER_RESERVED_SHORTCUTS.every((chord) => normaliseShortcut(chord) === chord),
  `${BROWSER_RESERVED_SHORTCUTS.length} chords`,
);

/* ----------------------------------------------------------------- versions */

check("a patch increment is newer", compareVersions("1.2.3", "1.2.2") === 1);
check("numeric comparison, not lexical", compareVersions("1.10.0", "1.9.9") === 1);
check("a release beats its own pre-release", compareVersions("1.0.0", "1.0.0-rc.1") === 1);
check("equal versions compare equal", compareVersions("2.0.0", "2.0.0") === 0);
check("a lower version is lower", compareVersions("0.9.9", "1.0.0") === -1);

/* -------------------------------------------------------------------- store */

check("the settings cap is 64 KB", MAX_SETTINGS_BYTES === 64 * 1024);
check("settings bytes are measured as JSON", settingsBytes({ a: 1 }) === '{"a":1}'.length);
const circular = {};
circular.self = circular;
check("a circular settings value is refused as too big", settingsBytes(circular) === Infinity);

const plugins = await listPlugins();
check("no IndexedDB: the plugin list is empty, not a throw", Array.isArray(plugins) && plugins.length === 0);
check("no IndexedDB: the count is 0", (await countPlugins()) === 0);
check("no IndexedDB: a write reports false", (await putPlugin(record)) === false);
check("no IndexedDB: settings read as empty", Object.keys(await readSettings("p.one")).length === 0);
check("no IndexedDB: a settings write reports false", (await writeSetting("p.one", "k", 1)) === false);
check(
  "no IndexedDB: removing an absent setting is a no-op success",
  (await removeSetting("p.one", "k")) === true,
);
check("no IndexedDB: deleting is not an error", (await deletePlugin("p.one")) === false);
check("an over-long settings key is refused before any write", (await writeSetting("p.one", "k".repeat(65), 1)) === false);
check("an empty settings key is refused", (await writeSetting("p.one", "", 1)) === false);

/* ---------------------------------------------------------------- registry */

function throwsWith(fn, needle) {
  try {
    fn();
  } catch (error) {
    return String(error?.message ?? error).includes(needle);
  }
  return false;
}

let commandChanges = 0;
let panelChanges = 0;
let publishedExtensions = [];
let extensionPublishes = 0;

const registry = new PluginRegistry({
  knownKeys: ["Ctrl+Shift+K", "Mod-z"],
  onCommandsChanged: () => {
    commandChanges += 1;
  },
  onPanelsChanged: () => {
    panelChanges += 1;
  },
  onExtensionsChanged: (extensions) => {
    publishedExtensions = extensions;
    extensionPublishes += 1;
  },
});

registry.activate("p.one");
check("a plugin can be activated", registry.isActive("p.one") === true);
check("activating twice is idempotent", registry.activate("p.one") === undefined && registry.count() === 1);

const encode = registry.addCommand("p.one", {
  id: "encode",
  label: "Encode",
  run: () => true,
});
check(
  "a command is registered under a namespaced key",
  registry.commands()[0]?.key === "p.one/encode",
);
check("findCommand resolves the namespaced key", registry.findCommand("p.one/encode") !== null);
check("a command change is announced", commandChanges === 1);

check(
  "a duplicate command id is refused",
  throwsWith(
    () => registry.addCommand("p.one", { id: "encode", label: "Again", run() {} }),
    "already registered",
  ),
);
check(
  "an invalid command id is refused",
  throwsWith(
    () => registry.addCommand("p.one", { id: "Not Valid", label: "x", run() {} }),
    "must be 1–64 characters",
  ),
);
check(
  "a command without a label is refused",
  throwsWith(() => registry.addCommand("p.one", { id: "nolabel", label: " ", run() {} }), "label"),
);
check(
  "a shortcut that collides with the app is refused",
  throwsWith(
    () => registry.addCommand("p.one", { id: "k", label: "K", shortcut: "Ctrl+Shift+K", run() {} }),
    "application",
  ),
);
check(
  "a browser-reserved shortcut is refused",
  throwsWith(
    () => registry.addCommand("p.one", { id: "save", label: "Save", shortcut: "Ctrl+S", run() {} }),
    "browser",
  ),
);
const bound = registry.addCommand("p.one", {
  id: "j",
  label: "J",
  shortcut: "Ctrl+Alt+J",
  run() {},
});
check("a free shortcut is accepted", registry.findCommand("p.one/j")?.shortcut === "Ctrl+Alt+J");
registry.activate("p.two");
check(
  "a chord already taken by another plugin is refused",
  throwsWith(
    () => registry.addCommand("p.two", { id: "j", label: "J", shortcut: "Ctrl+Alt+J", run() {} }),
    "another plugin",
  ),
);
bound.dispose();
check("disposing a command removes it", registry.findCommand("p.one/j") === null);

/* extensions */

const fakeExtension = { fake: true };
const extensionHandle = registry.addExtension("p.one", fakeExtension);
check(
  "an extension is published to the app",
  publishedExtensions.length === 1 && extensionPublishes === 1,
);
extensionHandle.dispose();
check("disposing an extension retracts it", publishedExtensions.length === 0);

/* events */

const received = [];
const off = registry.subscribe("p.one", "document:opened", (payload) => received.push(payload.type));
registry.emit("document:opened", { language: null });
check("an event reaches its subscriber", received.length === 1 && received[0] === "document:opened");
off.dispose();
registry.emit("document:opened", { language: null });
check("an unsubscribed handler stops receiving", received.length === 1);

const seenBySecond = [];
registry.subscribe("p.one", "document:changed", () => {
  throw new Error("handler boom");
});
registry.subscribe("p.two", "document:changed", (payload) => seenBySecond.push(payload.type));
registry.emit("document:changed", {});
check("a throwing handler does not stop the next plugin", seenBySecond.length === 1);
check(
  "a throwing handler is recorded against its plugin",
  (registry.lastError("p.one") ?? "").includes("handler boom"),
);

/* panels */

let shown = 0;
let hidden = 0;
const panel = registry.addPanel("p.one", {
  id: "counts",
  title: "Counts",
  render() {},
  onShow() {
    shown += 1;
  },
  onHide() {
    hidden += 1;
  },
});
check("a panel starts hidden", panel.visible === false);
check("registering a panel announces it", panelChanges === 1);
panel.show();
check("show toggles and notifies", panel.visible === true && shown === 1);
panel.show();
check("show is idempotent", shown === 1);
panel.hide();
check("hide toggles and notifies", panel.visible === false && hidden === 1);
panel.dispose();
check("disposing a panel removes it", registry.panels().length === 0);

/* teardown */

let cleaned = false;
registry.setCleanup("p.one", () => {
  cleaned = true;
});
registry.disposePlugin("p.one");
check("cleanup runs when a plugin is disposed", cleaned === true);
check("a disposed plugin is not active", registry.isActive("p.one") === false);
check(
  "registration after disposal is refused",
  throwsWith(() => registry.addCommand("p.one", { id: "late", label: "Late", run() {} }), "not active"),
);
check("the other plugin is untouched", registry.isActive("p.two") === true);
registry.clear();
check("clear removes every plugin", registry.count() === 0 && registry.commands().length === 0);

/* ------------------------------------------------------------------ loader */

const loaderRegistry = new PluginRegistry({ knownKeys: [] });
const loader = new PluginLoader({
  registry: loaderRegistry,
  context: () => {
    throw new Error("no context is built in Node");
  },
  log: () => {},
});

const emptyInstall = await loader.install("   ");
check(
  "an empty source is refused before any import",
  emptyInstall.ok === false && /empty/.test(emptyInstall.error ?? ""),
);
const bigInstall = await loader.install("a".repeat(MAX_SOURCE_BYTES + 1));
check(
  "an oversize source is refused before any import",
  bigInstall.ok === false && /larger than/.test(bigInstall.error ?? ""),
);

const noStorageStart = await loader.start();
check(
  "start with no storage loads nothing and reports nothing",
  noStorageStart.skipped === false &&
    noStorageStart.loaded.length === 0 &&
    noStorageStart.failed.length === 0,
);

const offLoader = new PluginLoader({
  registry: new PluginRegistry(),
  context: () => {
    throw new Error("unused");
  },
  disabled: true,
  log: () => {},
});
const offReport = await offLoader.start();
check("?plugins=off skips every plugin", offReport.skipped === true && offReport.loaded.length === 0);

const missing = await loader.enable("missing.plugin");
check(
  "enabling an uninstalled plugin is an error, not a throw",
  missing.ok === false && /not installed/.test(missing.error ?? ""),
);
check("disabling an unknown plugin reports false", (await loader.disable("missing.plugin")) === false);
check("uninstalling an unknown plugin reports false", (await loader.uninstall("missing.plugin")) === false);
const missingReload = await loader.reload("missing.plugin");
check(
  "reloading an uninstalled plugin is an error",
  missingReload.ok === false && /not installed/.test(missingReload.error ?? ""),
);

// Node's ESM loader cannot import a blob: URL, and there is no IndexedDB either.
// What this pins is the containment contract: install() resolves with an error
// instead of rejecting, which is what the manager depends on.
const unrunnable = await loader.install(
  'export default { id: "node.only", name: "Node only", version: "1.0.0", apiVersion: 1, activate() {} };',
);
check(
  "install resolves with an error when the module cannot load",
  unrunnable.ok === false && typeof unrunnable.error === "string" && unrunnable.error.length > 0,
  String(unrunnable.error).slice(0, 60),
);
loader.stopAll();
check("stopping every plugin leaves none active", loader.activeIds().length === 0);

/* ------------------------------------------------------------------ summary */

console.log();
console.log(`${passed}/${passed + failed} checks passed  (${failed} failed)`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const name of failures) console.log(`  - ${name}`);
}
process.exit(failed === 0 ? 0 : 1);
