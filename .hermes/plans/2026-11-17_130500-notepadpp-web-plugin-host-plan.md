# Notepad++-Style Plugin Host — Assessment and Implementation Plan

> **Status:** D5 **accepted as amended by the user on 2026-11-17** ("accept D5 as amended"), and the
> build **scheduled after phase-2 Task 22** ("schedule it after phase-2 Task 22"). **P0 is done** —
> the decision is recorded in `docs/scope.md` §3/§4/§10 and the settled design (trust model, v1
> limits, API surface, N++ mapping) is in `docs/plugins.md`. **P1–P8 are not started**: Task 11 is
> still the next unit of work. Nothing in `src/` mentions plugins yet, and no `DONE` row exists for
> this plan until its checks do.
>
> **For Hermes:** when the phase-2 queue reaches Task 22, start at **P1 (the loader spike)** and work
> one task per session with a reproducible check, appending a row to `PROGRESS.md` — the project's
> standing rules (S1–S18) apply unchanged. Do not build around a spike result: if P1 measures
> something the design assumes wrongly, record the measurement and amend this plan, the way R2
> produced S5.

**Goal:** give the editor a **Plugins** menu, an install/enable/disable/uninstall manager, and a
documented JavaScript host API — so third-party code can add commands, toolbar buttons, docked
panels, editor decorations and document-event handlers, installed from a local file, persisted
offline, with no backend.

**Architecture:** one ES module per plugin, stored as source text in IndexedDB and loaded with
`import(blobURL)`; a singleton `PluginContext` built by the app over `Workspace`/`Chrome`, exposing
the app's **own** CodeMirror 6 module instances (never a plugin's copy); one `pluginCompartment` in
every document state so extensions reach both split panes; a right-hand dock for panels; a
`plugins` + `plugin-settings` IndexedDB store (DB version 3).

**Tech stack:** unchanged — TypeScript (strict) + Vite 8 (Rolldown) + CodeMirror 6, IndexedDB,
File System Access, no network, no new runtime dependency.

**Scope authority:** `docs/scope.md` §4 Tier 3, row **"Plugin host API — sandboxed ES module loader
with a documented hostAPI (commands, decorations, panels, dialogs)"**; decision **D5**. This plan
**amends two words of that row** (§1.5) and invents no feature outside it.

**Reference target:** Notepad++ 8.9.8 plugin model (`PluginInterface.h`:
`setInfo` / `getName` / `getFuncsArray` / `beNotified` / `messageProc`; docking via
`NPPM_DMM_REGISTERPANEL` / `NPPM_DMM_SHOWPANEL`).

---

## 1. The answer, first

### 1.1 Is it possible?

**Yes — for everything a plugin can do *through the editor*, and no for three things that are
structural to Notepad++ and absent from a browser.**

The browser can load third-party code at runtime, give it a documented API over the editor, and keep
it across reloads offline. What it cannot do is load a Windows DLL, download from a central plugin
catalogue with auto-update, or start a process. Those are the same three walls the project already
ruled out (D7, D1), so no new impossibility appears.

Concretely, this is achievable with the code that exists today:

| Capability | Why it works here | Confidence |
|---|---|---|
| Plugins menu + per-plugin commands | `Chrome.addMenus` already accepts `() => MenuEntry[]`, which is how the Language menu stays live | High |
| Toolbar buttons | `Chrome.addButton` exists; only a `removeButton` is missing | High |
| Docked panels | New UI: a right-hand dock with a tab strip. Nothing in the editor core blocks it | Medium — the only structural UI change |
| Editor decorations / gutters / overlays | CM6 extensions built from `host.cm`; a `pluginCompartment` follows the pattern of the four compartments already in `notepadpp-config.ts` | High |
| Document lifecycle events (N++ `beNotified` / `SCN_*`) | Direct hooks at `#adopt`, `saveFile`, `#close`, `#show`, `#onUpdate`, `setLanguage` | High |
| Read/modify text, selections, undoably | Plugin edits are ordinary transactions dispatched into the owner view | High |
| Install from a local file, persist, work offline | File text → IndexedDB → `import(blobURL)`; the PWA already runs offline | High |
| Per-plugin settings, enable/disable/uninstall/reload | IndexedDB + a manager dialog | High |

**Estimated effort:** 6–8 focused sessions, roughly **1,400–1,800 lines** of new source and
**800–1,000 lines** of Node + Playwright checks — comparable to Task 5 (search) in size, smaller in
algorithmic risk. No dependency is added.

### 1.2 What "like Notepad++" cannot mean here

| N++ mechanism | Status in this port | Why |
|---|---|---|
| Native plugin `.dll`, Plugin Admin, Win32 ABI | **Impossible** — already D7 | No native code loading, no OS shell |
| Plugin Admin catalogue, remote install/update | **Out of scope** — D1 | No backend, and the app must work with no network |
| `NppExec` / run external command | **Impossible** — D7 | Needs a process |
| Scintilla messages (`SCI_*`, `NPPM_*`, `SCN_*`) as a binary protocol | **Replaced** | The port exposes typed JS methods instead; an N++ plugin cannot be recompiled mechanically |
| Plugins compiled against Scintilla | **Not portable** | Same reason; source can be *ported* by hand, not linked |
| Plugins that hook the OS (registry, shell menu, windows) | **Impossible** | Browser sandbox |

The honest sentence for the docs: **this is a plugin model in Notepad++'s spirit — a Plugins menu, a
manager, and trusted third-party modules against a published API — not a binary-compatible plugin
system.**

### 1.3 The trust model, stated plainly

A plugin is an ES module. In v1 it runs **in the page**, which means it has exactly the privileges
the app has: the DOM, `fetch`, IndexedDB, and the ability to touch any file whose handle the user has
granted the app. **There is no enforcement boundary.** A "permissions" field in the manifest would
be documentation, not a sandbox.

That is not a regression against Notepad++, whose plugins are DLLs running with the user's
privileges; it *is* a difference in blast radius, because this app holds handles to the user's files.
So the port must be explicit where N++ is implicit:

- The install dialog says, in one sentence, that a plugin runs with the page's full privileges and
  can read or modify anything the editor can.
- Nothing installs without a deliberate file selection.
- A failing plugin is isolated: activation is wrapped, commands and event handlers are wrapped, one
  plugin's exception never reaches the app's own code, and the manager shows the error.
- `?plugins=off` starts the app with every plugin skipped — the escape hatch when a plugin is broken.
- No claim of "sandboxed" anywhere in the UI or docs. The Tier-3 row's word is corrected (§1.5).

A real sandbox would require a sandboxed `<iframe>` or a Worker with a declarative-only API
(decorations described as data, not as CM6 objects). That is a different product with a much smaller
API; §9 records why, and it is **not** planned work.

### 1.4 Decision — **CLOSED 2026-11-17**

> **D5 — amend and accept:** *Plugins are trusted, runtime-loaded ES modules against a documented
> host API. One module file per plugin (the analogue of one DLL). Installed from a local file,
> stored in IndexedDB, loaded by `import()` of a blob URL. No native ABI, no remote catalogue, no
> sandbox claim.*

**The user accepted it as written and scheduled it after phase-2 Task 22.** Recorded in
`docs/scope.md` §3 and §10, in `PROGRESS.md`'s decision log, and in `docs/plugins.md`. P0 below is
that recording; P1–P8 are the build, and they wait for the phase-2 queue.

### 1.5 Two corrections to `docs/scope.md` Tier 3 — **APPLIED (P0, 2026-11-17)**

1. **"Sandboxed ES module loader" → "ES module loader".** In-page modules cannot be sandboxed; the
   word would be a promise the code cannot keep. Replace it with the trust paragraph above.
2. **"Chromium can load them from a user-picked local folder; elsewhere, paste-source install" →
   "installed from a single local `.js` file; folder packages are a later task."** A plain
   `<input type="file">` works in every browser the app targets, needs no File System Access
   permission, and — unlike a native directory picker — is automatable, which the project's checks
   require (Task 4's OS-chooser script is 43 assertions of pain; there is no reason to repeat it for
   plugins).

Also applied in P0, beyond the two corrections: `docs/scope.md` §2's non-goals now name the two
plugin absences explicitly (no remote catalogue/auto-update, no sandboxed plugins), §10 records D5 as
the fifth resolved decision, and `docs/plugins.md` carries the trust model, the v1 limits and the API
surface — so the decision is readable from the scope doc without opening this plan.

---

## 2. Feasibility, mechanism by mechanism

### 2.1 How a plugin gets into the running app

Four mechanisms were considered.

| Option | How it works | Verdict |
|---|---|---|
| **A. Blob module** | Read the file's text, `new Blob([source], {type:"text/javascript"})`, `URL.createObjectURL`, `await import(url)` | **Chosen for v1.** Works in dev and production, no service-worker dependency, a fresh URL per enable gives a fresh module instance, teardown is under our control |
| B. Service-worker virtual origin | Store plugin files in IndexedDB; an SW fetch handler serves `./plugins/<id>/<path>`; `import()` resolves relative imports naturally | **Deferred, not planned.** The right answer for multi-file packages, but plugin loading would then depend on an active worker — the app deliberately registers none in dev — and it enlarges the worker's job from "shell cache" to "second origin" |
| C. Static import map | `<script type="importmap">` maps `@codemirror/*` to host modules | **Rejected.** Import maps must be present before module resolution starts, and the app is bundled, so a mapped specifier resolves to a *second* copy of CM6 anyway — exactly the duplication trap `host.cm` exists to prevent |
| D. Bundle at install time | Ship esbuild-wasm (~10 MB) and compile the plugin in the page | **Rejected.** D1's payload discipline; and it does not solve trust, only syntax |

**The consequence of A, stated as a limit:** a v1 plugin is **one module file**. Relative imports
between plugin files do not resolve from a blob URL, and bare specifiers such as
`@codemirror/view` are not resolvable at all. A plugin that needs CM6 takes it from `ctx.cm`; one
that needs its own helper code inlines it. That is the same shape as Notepad++'s one-DLL-per-plugin,
which is why it is a defensible v1 rather than a shortcut.

**The singleton rule.** `ctx.cm` exposes the app's own `@codemirror/state`, `@codemirror/view`,
`@codemirror/commands`, `@codemirror/search` and `@codemirror/language` exports, captured where the
app already imports them. CM6 extensions are objects whose behaviour is keyed on class identity
(`instanceof`, facet objects); a second copy of `@codemirror/state` would be rejected by the view or,
worse, silently ignored. The host must therefore import those modules in **one** place
(`src/plugins/cm.ts`) and hand them to every plugin. A plugin that imports CM6 itself fails at
import time with a clear message ("bare specifier"), and the manager reports it.

### 2.2 Where plugins attach in the existing code

| Concern | File today | Change |
|---|---|---|
| Per-document extension list | `src/editor/notepadpp-config.ts` → `editorCoreExtensions`, `createDocumentState`, `createCloneState` | Add a `pluginCompartment` to `editorCoreExtensions` (both owner and clone states are built from it, so a split pane gets plugin extensions for free) |
| Applying a change to every live view | `workspace.ts` `#applyPreferences` | Same pattern: reconfigure the compartment on every view of every document |
| Menus | `workspace.ts` `#addMenus` / `#languageMenu` (dynamic `items` function) | Add a Plugins menu whose `items` calls the host |
| Toolbar | `chrome.ts` `addButton` / `setButtonActive` | Add `removeButton`, and return a disposable from `addButton` |
| Notices / dialogs | `chrome.ts` `showNotice`, `dialog`-based prompts; `preferences-dialog.ts` | Reuse; expose a small `ui` façade to plugins |
| Events | `#adopt`, `saveFile`, `#close`, `#show`, `#onUpdate`, `setLanguage` | Emit document events at those points |
| Storage | `src/storage/idb.ts` (`DB_VERSION = 2`, additive upgrade) | Bump to 3; add `plugins` + `plugin-settings` |
| Verification handle | `workspace.ts` `inspect()` | Add a `plugins` block |
| Layout | `style.css` `.npp-workspace` (flex row), `chrome.ts` `enableSplitterDrag` | Add the dock as a flex sibling and clamp the splitter drag against its width |

### 2.3 The one structural UI change: the dock

Today `.npp-workspace` is a flex row holding `[primary][splitter][clone?]`, and
`enableSplitterDrag` clamps the clone pane's width against `workspace.width - 120`. Appending the
dock as another flex child would let a drag squeeze it to nothing, so the drag clamp must subtract
the dock's width. That is a five-line change, but it touches the split-view path that
`verify-task3.py` and `spike-r2-split.py` already cover — so it is its own task (P5) with those
checks re-run.

The dock itself: a `flex: 0 0 <width>px` column on the right, a tab strip of panel titles, one panel
body, a 4px handle, and a close button. It is hidden until a plugin registers a panel or a plugin
command calls `show()`. Width persists in `localStorage` (`npp-web.dock-width`) — a web-only view
preference, deliberately kept out of the N++-keyed `Preferences` table, whose rule is that every key
is N++'s.

### 2.4 What a plugin can do in v1 — and what it cannot

**Can:** register commands (menu + optional shortcut + optional toolbar button), register a docked
panel, add CM6 **view-level** extensions (decorations, gutters, tooltips, themes scoped to a class),
read documents and their metadata, replace selections or whole documents undoably, listen to
document open/save/close/activate/change and language changes, show dialogs/notices, store
per-plugin settings.

**Cannot, in v1, on purpose:**

- **Document-level `StateField`s** (the analogue of bookmarks/marks). A state field in a cloned
  pane is per-view and must be reconciled by hand — the exact trap `codemirror-6-web-editor` records
  and that Task 6 had to solve for folds. A plugin API that hands that problem to strangers will
  produce split views that silently disagree. v1 offers view-level extensions only; document state
  is a later, deliberate design.
- **Adding a language to the Language menu.** The registry is generated and every entry is a lazy
  import (`scripts/gen-language-registry.mjs --check` fails on an unaccounted export); runtime
  registration is a separate feature, not a plugin-host afterthought.
- **Replacing core keybindings.** A plugin shortcut that collides with the app's own or with a
  browser-reserved chord is **rejected at registration** and reported in the manager. No silent
  shadowing of Ctrl+S.
- **Multi-file packages, WASM, remote install, auto-update, cross-plugin communication.**
- **Anything outside the page** — the D7 wall.

---

## 3. The API, concretely

### 3.1 Plugin module contract

`plugins/examples/base64.js` is the shape every plugin follows:

```js
/** @type {import("../../src/plugins/api").PluginModule} */
export default {
  id: "example.base64",
  name: "Base64 (example)",
  version: "1.0.0",
  apiVersion: 1,
  description: "Base64-encode or decode the selection.",
  author: "Notepad++ Web",

  activate(ctx) {
    ctx.commands.register({
      id: "example.base64.encode",
      label: "Base64 Encode Selection",
      run: () => ctx.editor.replaceSelections((text) => btoa(String.fromCharCode(...new TextEncoder().encode(text)))),
    });
    ctx.commands.register({
      id: "example.base64.decode",
      label: "Base64 Decode Selection",
      run: () => ctx.editor.replaceSelections((text) => new TextDecoder().decode(Uint8Array.from(atob(text.trim()), (c) => c.charCodeAt(0)))),
    });
  },
};
```

Rules:

- **Default export**, not named: one shape, one way to check it.
- `id` is stable and namespaced (`/^[a-z0-9][a-z0-9._-]{2,63}$/`); it keys storage, settings and the
  command namespace (`<plugin id>/<command id>`), so two plugins cannot collide.
- `apiVersion` must be exactly `1`; anything else is refused with a message naming the version the
  app supports.
- `activate` may be `async`; the host awaits it (with a timeout) before reporting the plugin active.
- Every registration returns a `Disposable`; `activate`'s return value may also be a cleanup
  function. On disable/uninstall the host disposes registrations **and** calls `deactivate()` if
  present.
- Top-level module code runs at install time (the host must import the module to read its metadata),
  and the install dialog says so — same as Windows loading a DLL to call `setInfo`.

### 3.2 `PluginContext` (the public surface)

```ts
export interface PluginContext {
  readonly apiVersion: 1;
  readonly plugin: Readonly<{ id: string; name: string; version: string }>;
  /** The app's own CM6 modules. Not a re-export, not a copy. */
  readonly cm: {
    state: typeof import("@codemirror/state");
    view: typeof import("@codemirror/view");
    commands: typeof import("@codemirror/commands");
    search: typeof import("@codemirror/search");
    language: typeof import("@codemirror/language");
  };

  readonly commands: {
    register(spec: {
      id: string;
      label: string;
      run: () => boolean | void;
      shortcut?: string;          // "Ctrl+Alt+B"; rejected on conflict
      toolbar?: { title?: string };
      checked?: () => boolean;    // N++'s checked menu item
    }): Disposable;
    run(id: string): boolean;
    setEnabled(id: string, enabled: boolean): void;
  };

  readonly editor: {
    documents(): DocumentInfo[];          // read-only snapshots, never OpenDocument
    active(): DocumentInfo | null;
    text(documentId?: string): string | null;
    setText(text: string, documentId?: string): boolean;      // one undoable transaction
    selections(documentId?: string): SelectionInfo[];
    replaceSelections(map: (text: string, index: number) => string, documentId?: string): boolean;
    addExtension(extension: unknown): Disposable;             // view-level; every view, every doc
    onDidChange(handler: (info: DocumentInfo) => void): Disposable; // debounced 250 ms
  };

  readonly panels: {
    register(spec: {
      id: string;
      title: string;
      render(host: HTMLElement): void | (() => void);
      onShow?(): void;
      onHide?(): void;
    }): PanelHandle;                      // show(), hide(), dispose()
  };

  readonly toolbar: { addButton(spec: { id: string; label: string; title: string; onClick: () => boolean }): Disposable };

  readonly events: {
    on(
      type: "document:opened" | "document:saved" | "document:closed" | "document:activated"
          | "document:changed" | "language:changed" | "ready",
      handler: (payload: EventPayload) => void,
    ): Disposable;
  };

  readonly ui: {
    dialog(spec: { title: string; body?: string; content?: HTMLElement; actions?: { id: string; label: string }[] }): Promise<string | null>;
    confirm(message: string, options?: { title?: string; confirmLabel?: string }): Promise<boolean>;
    notice(title: string, body: string, options?: { kind?: string }): Disposable;
  };

  readonly settings: {
    get<T = unknown>(key: string, fallback?: T): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    all(): Promise<Record<string, unknown>>;
  };

  readonly log: (...args: unknown[]) => void;   // prefixed with the plugin id
}
```

Deliberate omissions: no raw `OpenDocument`, no `EditorView` for the *active* pane (only
`addExtension`), no chrome internals, no direct IndexedDB. A plugin that genuinely needs a view can
obtain one through `ctx.cm.view.EditorView.findFromDOM(...)`; that is its own decision, not the
contract's.

### 3.3 `PluginModule`, records and storage

```ts
export interface PluginModule {
  id: string; name: string; version: string; apiVersion: number;
  description?: string; author?: string;
  activate(ctx: PluginContext): void | (() => void) | Promise<void | (() => void)>;
  deactivate?(): void;
}

export interface PluginRecord {
  id: string; name: string; version: string; apiVersion: number;
  description: string; author: string;
  source: string;                 // exactly as installed
  enabled: boolean;
  installedAt: number;
  lastError: string | null;
}
```

`idb.ts` changes: `DB_VERSION` 2 → 3; the upgrade handler creates `plugins` (out-of-line key `id`)
and `plugin-settings` (out-of-line key `pluginId`, value: a plain object). The existing rule holds —
additive upgrades, fail-soft, never throw.

Caps: source ≤ **512 KB**, ≤ **100** installed plugins, settings ≤ 64 KB per plugin. Over a cap the
manager refuses with a message; nothing is truncated silently.

### 3.4 Notepad++ plugin API → this host

This table belongs in `docs/plugins.md`; it is the porting guide.

| Notepad++ | This port |
|---|---|
| `setInfo`, `getName`, `getVersion`, `getPluginConfigPath` | module `id` / `name` / `version`; settings via `ctx.settings` |
| `getFuncsArray` → `FuncItem` (menu label, shortcut, checked, toolbar icon) | `ctx.commands.register({ label, shortcut, checked, toolbar })` |
| `beNotified(NppNotification)` / `SCN_*` / `NPPN_*` | `ctx.events.on("document:opened" \| "document:saved" \| …)` |
| `messageProc` + `NPPM_GETCURRENTBUFFERID`, `NPPM_GETFILENAME`, `NPPM_GETLANGUAGENAME`, `NPPM_SETSTATUSBAR` | `ctx.editor.documents()` / `active()`, `DocumentInfo`; notices via `ctx.ui.notice` |
| Scintilla `SCI_GETTEXT` / `SCI_SETTEXT` / `SCI_GETSELTEXT` / `SCI_REPLACESEL` | `ctx.editor.text()` / `setText()` / `selections()` / `replaceSelections()` |
| `SCI_*` markers, indicators, margin clicks | `ctx.editor.addExtension(new ctx.cm.view.ViewPlugin(...))` with `Decoration`s |
| `NPPM_DMM_REGISTERPANEL`, `NPPM_DMM_SHOWPANEL` | `ctx.panels.register(...)` → `show()` / `hide()` |
| `NPPM_ADDTOOLBARICON` (bitmap) | `ctx.toolbar.addButton({ label })` — text button; the app's toolbar is text-only (deviation) |
| Plugin reads/writes its own INI via `getPluginConfigPath` | `ctx.settings.get/set/all` |
| `NPPM_MSGTOPLUGIN` (plugin-to-plugin messages) | Not in v1 — no cross-plugin API |

---

## 4. Implementation tasks

Each task is one session-sized unit with a reproducible check (S2). Commit per task, `task-Pn: …`,
and append the evidence to `PROGRESS.md`. P-numbers, not 23+, because this plan is not part of the
phase-2 document; the user scheduled the build after Task 22 (2026-11-17), so a single ledger row can
carry `P1–P8` when it starts.

**There is no P9, on purpose.** Multi-file packages (the service-worker virtual origin of §2.1's
option B) and any sandbox route (§1.3, §9) are recorded so a future request starts from evidence, not
from a fresh design — and neither is planned work.

### Task P0 — Decision and scope correction (no code) — **DONE 2026-11-17**

**Objective:** D5 accepted; `docs/scope.md` Tier-3 row corrected; a `docs/plugins.md` skeleton that
states the trust model before any API exists.

**Files:**
- Modify: `docs/scope.md` §4 (Tier 3 plugin row), §2 (non-goals: native plugins already there)
- Modify: `PROGRESS.md` decision log (D5 → Accepted, with the amendment)
- Create: `docs/plugins.md` (trust model, v1 limits, N++ mapping stub)

**Steps:**
1. Get the user's word on D5 (one line in the ledger quoting it, as D12 did).
2. Apply §1.5's two corrections, preserving the Tier-3 priority (still unscheduled by default).
3. Write the trust paragraph (§1.3) into `docs/plugins.md`.

**Verification:** `node scripts/status.mjs` still exits 0; the decision row says `Accepted`.

**Result (2026-11-17):** applied. `docs/scope.md` — D5's §3 row rewritten as the amendment, the
header now reads "D1, D8 remain proposed", §2 gained the two plugin non-goals, the Tier-3 row lost
"sandboxed" and gained the schedule, §10 lists D5 as the fifth resolved decision. `docs/plugins.md`
created (trust model, v1 limits, API surface with the N++ mapping, install/storage/lifecycle, porting
guidance, open items), headed **DECIDED, NOT BUILT**. `PROGRESS.md` — D5 → Accepted with the user's
words, the artifact map, Next action item 6, Blockers item 7, and Session 11's log entry. `README.md`
— the docs list. No `src/`, `index.html`, `vite.config.ts` or `scripts/` file was touched.

**Commit:** `task-P0: accept D5 — trusted ES-module plugins, file install, no sandbox claim`

---

### Task P1 — Loader spike (throwaway evidence, kept as a script)

**Objective:** prove the four mechanics nobody should assume: blob import, singleton CM6, extension
in both panes, teardown.

**Files:**
- Create: `scripts/spike-plugin-host.py`
- Create: `scripts/fixtures/plugin-probe.js` (temporary; becomes `plugins/examples/probe.js` in P7)

**What the spike must measure (each a printed number, not an opinion):**
1. `import(blobURL)` succeeds in the **dev server** and in a **production build**.
2. An extension built from `host.cm` is accepted by an existing view (no "Unrecognized extension"
   throw) and its `ViewPlugin` runs — proving one CM6 instance. Assert with a class the plugin adds
   to `.cm-editor`.
3. The same extension appears in **both** panes after "Clone to other view" — mount a clone first,
   then enable, then assert both.
4. Disabling removes the class from both panes and leaves no listener (check `getEventListeners` is
   not available; assert the DOM class and that the panel body is gone).
5. A module that throws in `activate` does not stop the app: the editor still types and `inspect()`
   still answers.
6. Reload: the plugin record survives, the module re-imports from a **new** blob URL (assert two
   different URLs in the console log), and its command still runs.

**Verification:** `python3 scripts/spike-plugin-host.py` → `PLUGIN_SPIKE: PASS (n/n)`.
Record the numbers (timings, accepted/rejected extension) in `docs/plugins.md` §Spike.

**Abort condition:** if (2) or (3) fails, stop and re-plan before P2. Deferring the spike would make
P3–P5 speculation.

**Commit:** `task-P1: spike — blob-loaded plugin, CM6 singleton, both panes, teardown`

---

### Task P2 — Model and store (Node-testable, no DOM)

**Objective:** plugin metadata, validation, conflict rules and persistence, all assertable without a
browser.

**Files:**
- Create: `src/plugins/model.ts` — `PluginModule`/`PluginRecord` types, `normaliseRecord()`,
  `validateMetadata()`, `isApiCompatible()`, `commandIdFor()`, `findShortcutConflicts()`,
  `compareVersions()`; **no CodeMirror and no DOM imports** (same rule as `palettes.ts` and
  `storage/*`, which is what lets `scripts/test-*.mjs` run in Node)
- Create: `src/plugins/store.ts` — `listPlugins()`, `getPlugin()`, `putPlugin()`, `deletePlugin()`,
  `readSettings()`, `writeSetting()`, all fail-soft over `storage/idb.ts`
- Modify: `src/storage/idb.ts` — `DB_VERSION = 3`, two new stores, additive upgrade
- Create: `scripts/test-plugins.mjs`
- Test: `scripts/test-plugins.mjs` (Node, `--experimental-strip-types`)

**Steps:**
1. Write the failing tests first: id pattern (reject `../x`, uppercase, empty), apiVersion mismatch,
   oversize source (512 KB + 1), version comparison, duplicate command ids across plugins, shortcut
   conflict against a supplied known-key list (including `Ctrl+S`, `Ctrl+F`, `F2`).
2. Implement `model.ts` until they pass.
3. Add the store functions; unit-test only the pure merge/normalise half (IndexedDB does not exist in
   Node — `test-session.mjs` sets the precedent).
4. `npm run typecheck`.

**Verification:**
- `node --experimental-strip-types scripts/test-plugins.mjs` → `PASS (n/n)`
- `npm run typecheck` → exit 0

**Commit:** `task-P2: plugin records, validation and shortcut conflicts; DB v3`

---

### Task P3 — Host API, registry and loader

**Objective:** the runtime: install → validate → import → activate → register → dispose, with a
registry that owns every disposable.

**Files:**
- Create: `src/plugins/cm.ts` — the single import site for the five CM6 modules; exports them as the
  `cm` namespace object
- Create: `src/plugins/api.ts` — the public types from §3.2 (declaration only, plus `Disposable`)
- Create: `src/plugins/registry.ts` — `PluginRegistry`: active plugins, commands, panels, toolbar
  buttons, event subscriptions, extensions, per-plugin `lastError`; `disposePlugin(id)` runs every
  disposable and calls `deactivate()`
- Create: `src/plugins/loader.ts` — `installFromSource()`, `enable()`, `disable()`, `uninstall()`,
  `reload()`, `start()`; blob URL creation/revocation; `import(/* @vite-ignore */ url)`; activation
  timeout (1500 ms) and error capture; `?plugins=off` short-circuit
- Create: `src/plugins/host.ts` — builds a `PluginContext` per plugin over `Workspace`, `Chrome` and
  the registry
- Test: extend `scripts/test-plugins.mjs` for registry/disposable logic with a fake context (no DOM)

**Implementation notes:**
- **Every callback the host gives a plugin is wrapped**: command `run`, event handlers, panel render,
  settings callbacks. A throw is logged with the plugin id, stored on the record as `lastError`, and
  surfaced once as a notice — never rethrown into the editor's dispatch path.
- **Commands are namespaced** as `<pluginId>/<commandId>` internally, so a collision between plugins
  is impossible; a collision *within* one plugin is a registration error.
- **Shortcut validation** needs the app's own bindings: `host.ts` passes
  `nppKeymap({}).map((binding) => binding.key)` plus `SEARCH_KEYS`/`WEB_PORT_KEYS` values into
  `findShortcutConflicts()`. `model.ts` stays CM-free by taking the list as a parameter.
- **Enable** creates a fresh blob URL; **disable** disposes then revokes. A module graph cannot be
  unloaded from the JS engine — state that in the manager ("disabled; code stays loaded until
  reload") rather than implying more.
- **Install** imports the module once to read metadata (top-level code runs; the dialog says so),
  then stores and, if enabled, activates. A module whose metadata is invalid is never stored.

**Verification:**
- `node --experimental-strip-types scripts/test-plugins.mjs` → `PASS`
- `npm run typecheck` → exit 0
- `npm run dev` + manual: install `scripts/fixtures/plugin-probe.js` through a temporary
  `window.__workspace.plugins.installForTest(source)` handle — a dev-only affordance the P7 check
  replaces with the real dialog. **This temporary handle must be removed in P6** (record it in the
  ledger so it cannot leak into a release).

**Commit:** `task-P3: plugin loader, registry, host API v1`

---

### Task P4 — Workspace, menu, toolbar, events, inspect

**Objective:** plugins become visible and useful: a Plugins menu, toolbar buttons, document events,
and the compartment that carries extensions into every view.

**Files:**
- Modify: `src/editor/notepadpp-config.ts` — `export const pluginCompartment = new Compartment();`
  add `pluginCompartment.of(options.plugins ?? [])` to `editorCoreExtensions`, plus
  `plugins?: Extension` on `EditorCoreOptions` (clone states inherit automatically because
  `createCloneState` calls `editorCoreExtensions`)
- Modify: `src/editor/workspace.ts`:
  - construct `PluginHost` after `#find`; start it after preferences, **without awaiting** the
    session restore (a slow plugin must not delay the first document); on `ready`, plugins receive
    the documents that already exist
  - `#applyPluginExtensions()` → `pluginCompartment.reconfigure(host.extensions)` dispatched to every
    view of every document (copy the shape of `#applyPreferences`)
  - `#addMenus` → a **Plugins** menu with `items: () => this.#plugins.menuEntries()`, ending with a
    separator and "Plugin Manager…" (N++'s `Plugins ▸ Plugin Admin…` position)
  - emit `document:opened` in `#adopt`, `document:saved` after a successful save,
    `document:closed` in `#close`, `document:activated` in `#show`, `document:changed` from
    `#onUpdate` (debounced), `language:changed` in `setLanguage`
  - `inspect()` → `plugins: { installed, active, commands, panels, errors }`
- Modify: `src/editor/chrome.ts` — `addButton` returns a `Disposable`; add `removeButton(id)`;

**Steps:**
1. Add the compartment and the reconfigure path; assert a probe extension is present in a fresh
   document and in a clone.
2. Add the menu and toolbar disposables.
3. Add event emission; assert `document:changed` fires once per 250 ms burst, not per keystroke.
4. Extend `inspect()`.

**Verification (browser, dev server):** a temporary `scripts/verify-plugins-dev.py` — not the final
acceptance script — asserting menu presence, command click, toolbar button, event counts, and
`inspect().plugins`. Then `npm run typecheck`; re-run `verify-task3.py` (splitter, tabs) and
`verify-task9.py` (menu hover, Language menu) because the menu list changed shape.

**Commit:** `task-P4: Plugins menu, plugin compartment, document events`

---

### Task P5 — The dock and panels

**Objective:** plugin panels dock on the right, switch by tab, resize, remember width, and close
without disturbing split view.

**Files:**
- Create: `src/plugins/panels.ts` — `Dock`: host element, tab strip, body, handle, show/hide/close,
  width persistence (`localStorage`, fail-soft)
- Modify: `src/editor/chrome.ts` — create the dock inside `.npp-workspace` after the clone pane;
  `enableSplitterDrag` clamp becomes `total - dockWidth - 120`
- Modify: `src/style.css` — `.npp-dock*` rules in both themes (`--dock-bg`, `--dock-border`,
  `--dock-tab-active`, …); a `[hidden]` rule where `display` would beat it (the toolbar's lesson)
- Modify: `src/storage/preferences.ts`? **No** — width is web-only; keep it out of the N++-keyed table

**Steps:**
1. Static dock with a dummy panel; open/close; screenshot in both themes.
2. Tab switching with two panels; assert only one body is rendered at a time.
3. Drag to resize; clamp at 180 px min, 50% of the workspace max; persist and restore.
4. Remember the last shown panel id and reopen it when its plugin re-registers after reload.
5. Split view open + dock open: drag the splitter, assert the dock cannot be squeezed below its min.

**Verification:** new assertions in the P7 script; re-run `verify-task3.py` (58/58) and
`spike-r2-split.py` (R2_SPIKE: PASS); screenshot both themes (a panel is only "working" if it is
visible and legible).

**Commit:** `task-P5: right-hand dock for plugin panels; splitter clamped`

---

### Task P6 — Plugin Manager

**Objective:** N++'s Plugin Admin, minus the catalogue: install, enable, disable, reload, uninstall,
see errors, see shortcut conflicts.

**Files:**
- Create: `src/plugins/manager-dialog.ts` — a `<dialog class="npp-dialog">` in the app's existing
  style; follows `preferences-dialog.ts` conventions (`data-*` attributes on every control so a check
  drives the real UI)
- Modify: `src/plugins/host.ts` — `menuEntries()` includes "Plugin Manager…"
- Modify: `src/style.css` — manager rows, status pills (enabled/disabled/failed), empty state

**Manager contents:**
- A table: name, version, author, status (`enabled`, `disabled`, `failed: <message>`), buttons
  (Enable/Disable, Reload, Uninstall with confirm, Settings? — v1: no per-plugin settings UI; the
  plugin owns its own dialog).
- **Install from file…** → hidden `<input type="file" accept=".js,text/javascript">`, plus a drop
  zone and a "paste source" textarea for the no-picker case. The dialog states the trust sentence
  from §1.3 **before** the picker opens.
- A note listing the app's API version and the plugins folder location in the docs.
- Failed plugins show the error text and a "Disable" button; the notice offers "Open Plugin Manager".

**Steps:**
1. Build the dialog against the store; install the probe fixture; row appears enabled.
2. Disable → row says disabled, command gone; Enable → command back, fresh blob URL.
3. Uninstall → record and settings removed, with confirmation.
4. A fixture that throws (`plugins/examples/broken.js`) → `failed:` row, app still editiing, notice
   with an action that opens the manager. **Remove the temporary `installForTest` handle.**
5. `?plugins=off` → no plugin activates; manager still opens and can re-enable.

**Verification:** P7's script covers the flows end to end; manual screenshot of the dialog in both
themes.

**Commit:** `task-P6: Plugin Manager — install, enable, disable, reload, uninstall, errors`

---

### Task P7 — Example plugins and the acceptance check

**Objective:** three small real plugins that prove the API, and one script that is the evidence.

**Files:**
- Create: `plugins/examples/base64.js` (§3.1)
- Create: `plugins/examples/word-count.js` — a docked panel: words, characters, lines for the active
  document, updating on `document:changed` and `document:activated`
- Create: `plugins/examples/json-format.js` — prettify the document or selection; invalid JSON shows
  a notice instead of corrupting text
- Create: `plugins/examples/probe.js` — the P1 fixture, now permanent: adds a `ViewPlugin` class to
  every view, proving extension + singleton + both panes
- Create: `plugins/examples/broken.js` — throws in `activate`; fixture for the failure path
- Create: `plugins/README.md` — how to write one, how to install it
- Create: `scripts/verify-task-plugins.py` — the acceptance check

**The acceptance check must cover, in a production build served like `verify-task8.py` does:**
1. Fresh profile: Plugins menu exists; Plugin Manager opens; empty state says so.
2. Install `probe.js` through the real file input → row enabled; `.plugin-probe` appears in the
   editor; command present; **no console or page errors**.
3. Install `base64.js` → select text, run "Base64 Encode Selection" → text is the encoded value;
   **one** Ctrl+Z reverts it (proves an undoable transaction, not DOM surgery).
4. Install `word-count.js` → panel tab appears; counts match the document; type a word → count
   updates within the debounce window.
5. Split view: open the clone **after** install → `.plugin-probe` exists in both panes and
   `inspect().viewTexts` is unchanged by the extension.
6. Disable `probe` → class gone from both panes, command gone, `inspect().plugins.active` no longer
   lists it.
7. Reload → enabled plugins come back, commands run, panel state restored; disabled `probe` stays
   disabled.
8. `?plugins=off` → nothing activates, and the manager still lets the user enable.
9. Install `broken.js` → app remains usable, row says `failed: …`, notice has the manager action;
   no uncaught page error.
10. Rejections: duplicate id (install twice) → message, still one row; API version 2 → refused with
    the supported version named; shortcut `Ctrl+S` → refused, and Ctrl+S still saves the document
    (the conflict must not have been installed).
11. **Offline:** with the network emulated away **and** the server stopped, reload → the app mounts
    from the service worker and the plugins load from IndexedDB; a plugin command still runs.
12. **No network:** every request during the run is same-origin; zero off-origin.
13. `inspect().plugins` numbers agree with the DOM at every step.

**Verification:**
- `python3 scripts/verify-task-plugins.py` → `PASS (n/n)` (target 50+ assertions)
- `npm run typecheck` → 0; `npm run build` → 0
- `node scripts/check-precache.mjs` → OK, with the shell count unchanged (plugins add no shell file;
  plugin sources are IndexedDB, not assets)
- Build delta recorded: `index` chunk before/after (expected +10–15 kB raw / +4–6 kB gz)

**Commit:** `task-P7: example plugins and end-to-end plugin acceptance check`

---

### Task P8 — Documentation and ledger

**Files:**
- Modify: `docs/plugins.md` — complete API reference, lifecycle diagram, trust model, N++ mapping
  table (§3.4), the v1 limits (§2.4), the spike numbers, and a "porting an N++ plugin" walkthrough
  (source-level, not binary)
- Modify: `README.md` — one feature bullet, `plugins/` and `src/plugins/` in the layout, docs link
- Modify: `docs/scope.md` — Tier 3 row marked **built**, with its limits
- Modify: `PROGRESS.md` — status row with every command and its output, decisions, session log
- Modify: `docs/offline-pwa.md` — one paragraph: plugins are IndexedDB, not precached, so they are
  offline by construction; a plugin installed while online works offline; no cache versioning issue
  because plugin code is never part of the build cache

**Verification:** `node scripts/status.mjs` shows the row; all checks from P7 and the regression list
below re-run green.

**Commit:** `task-P8: document the plugin host`

---

## 5. Validation plan

### 5.1 Per-task
Every task's own check, as listed. No task gets a `DONE` row without one (standing rule).

### 5.2 Full regression at the final HEAD

| Check | Command | Expected |
|---|---|---|
| Types | `npm run typecheck` | exit 0 |
| Build | `npm run build` | exit 0 |
| Plugins (Node) | `node --experimental-strip-types scripts/test-plugins.mjs` | PASS |
| Plugins (browser) | `python3 scripts/verify-task-plugins.py` | PASS |
| Editor core | `python3 scripts/verify-task3.py` | 58/58 |
| File I/O | `python3 scripts/verify-task4.py` | 44/44 |
| File pickers | `python3 scripts/verify-task4-pickers.py` | 43/43 (needs X + xdotool) |
| Search | `python3 scripts/verify-task5.py` | 105/105 |
| Languages | `python3 scripts/verify-task6.py` | 67/67 |
| Session | `python3 scripts/verify-task7.py` | 82/82 |
| Offline/PWA | `python3 scripts/verify-task8.py` | 57/57 |
| Language menu | `python3 scripts/verify-task9.py` | 41/41 |
| Dark Mode | `python3 scripts/verify-task10.py` | 24/24 |
| Split spike | `python3 scripts/spike-r2-split.py` | R2_SPIKE: PASS |
| Node suites | `test-file-io` 45/45 · `test-session` 75/75 · `test-languages` 238/238 · `test-themes` 18/18 | PASS |
| Registry | `node --experimental-strip-types scripts/gen-language-registry.mjs --check` | OK |
| Precaching | `node scripts/check-precache.mjs` | OK |

The plugin work touches `notepadpp-config.ts`, `workspace.ts`, `chrome.ts`, `idb.ts`, `style.css` —
the five files the existing checks lean on hardest. Expect at least one ordering assumption in
`verify-task7.py` (session restore) or `verify-task9.py` (menu shape) to need a deliberate update;
record the reason in the ledger rather than "fixing" the check to pass.

### 5.3 What the browser check must *not* do
- No assertion through CM6 internals or DOM node counts as a *document* fact — use `inspect()`.
- No synthetic `dispatch` where the user would type or click; drive the real menu, the real file
  input, real keystrokes.
- No screenshot taken with the manager or a plugin panel open as "proof the editor works" — close
  overlays first.

---

## 6. Risks and mitigations

| ID | Risk | Likelihood | Mitigation |
|---|---|---|---|
| **RP1** | A plugin importing `@codemirror/*` loads a second copy → nested-editor breakage or silent no-op | Medium | No import map, so it fails loudly at import; `ctx.cm` documented as the only route; the probe proves singleton identity |
| **RP2** | Plugin extensions desynchronise the split view | High if document state is allowed | v1 is **view-level only**; the compartment is in both owner and clone states; P1 and P7 assert both panes |
| **RP3** | A plugin throws inside a transaction or an event handler and breaks editing | Medium | Every callback wrapped; errors captured per plugin; disable/uninstall always available; `?plugins=off` |
| **RP4** | Trust: a malicious plugin reads files or exfiltrates text | Real, accepted | Trust sentence at install; no "sandboxed" claim; local install only; no auto-update. The user's own risk acceptance is D5 |
| **RP5** | The dock breaks the splitter drag or narrow-window layout | Medium | Its own task; splitter clamp updated; `verify-task3.py` + R2 spike re-run; min widths |
| **RP6** | Blob-URL module cache grows with every enable | Low | One URL per enable, revoked on disable; reload clears; the manager states that disable does not unload code |
| **RP7** | Plugin breaks after an app upgrade (API drift) | Medium | `apiVersion` gate; v1 additive-only; the manager shows the version it supports; upgrade policy in `docs/plugins.md` |
| **RP8** | Shortcut collision steals Ctrl+S or a browser-reserved chord | Medium | Reject at registration against the app's own binding list and the documented reserved set; the check asserts Ctrl+S still saves |
| **RP9** | Storage quota / oversized plugin | Low | 512 KB source cap; ≤ 100 plugins; fail-soft store; quota error reported, never silent |
| **RP10** | Plugin panels are mistaken for a general docking system | Low | The dock is one column, tabs, one visible panel; no floating, no nested docks; documented as such |
| **RP11** | The service worker caches a plugin module | None | Plugins never come from a URL the worker sees (blob URLs); nothing to precache; `check-precache.mjs` stays at its current shell count |

---

## 7. Definition of done

- D5 accepted in the decision log, with the trust model in the user's own words (one line, as D12).
- `npm run typecheck` → 0; `npm run build` → 0.
- `node --experimental-strip-types scripts/test-plugins.mjs` → PASS.
- `python3 scripts/verify-task-plugins.py` → PASS, in a **production build**, including the offline
  and `?plugins=off` halves.
- Full regression table (§5.2) green, with any deliberate check update explained.
- `docs/plugins.md` complete: API, lifecycle, trust, N++ mapping, limits, upgrade policy.
- `plugins/examples/` has four working plugins and one failing fixture.
- `PROGRESS.md` row with commands and numbers; `README.md` and `docs/scope.md` updated.
- `node scripts/check-precache.mjs` → OK, shell count unchanged; build delta recorded.

**Explicitly not claimed at the end of this plan:** `.dll` compatibility, Plugin Admin catalogue or
auto-update, NppExec, hard sandboxing, multi-file plugin packages, plugin-contributed languages,
plugin-to-plugin messaging, WASM plugins, mobile.

---

## 8. Questions that needed the user, not a task

1. **D5:** accept the amendment (trusted in-page modules, one `.js` per plugin, file install, no
   remote catalogue)? — **ANSWERED 2026-11-17: "accept D5 as amended."**
2. **Scheduling:** after phase-2 Task 22, or as a Tier-3 detour now? — **ANSWERED 2026-11-17:
   "schedule it after phase-2 Task 22."** P1–P8 wait for the phase-2 queue; Task 11 is still next.
3. **Examples:** ship `plugins/examples/` in the repo only (installed through the manager), or add a
   "Load examples" button that reads bundled files? — **STILL OPEN, to be settled in P7.**
   Recommendation: repo + manager install. A bundled-fetch path would be the app's first self-served
   plugin channel and it does not work offline unless precached — a problem with no payoff.

---

## 9. Appendix — why not a Worker or an iframe?

For completeness, since "sandboxed" is the word the scope doc used.

| Approach | Isolation | API the plugin could have | Verdict |
|---|---|---|---|
| **Page module (chosen)** | None — full page privileges | Everything: CM6 extensions, DOM panels, dialogs | v1; trust stated |
| **Worker** (`new Worker(blobURL)`) | Strong-ish: no DOM, separate global, still same origin | Only compute: text transforms, parsing; decorations/panels must be described as data and applied by the host | Good for an untrusted *transform* plugin later; cannot host a panel |
| **Sandboxed iframe** (`allow-scripts`, no `allow-same-origin`) | Strong: opaque origin, no DOM of the app, no storage | Message-passing only; a declarative UI schema would have to be invented | A second product; overlaps with "macro" and "function list" more than plugins |

The page module is the only one that gives an API comparable to Notepad++'s, which is the goal.
