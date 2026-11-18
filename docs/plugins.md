# Plugins — host API, trust model, and limits

**Status: DECIDED, NOT BUILT.** D5 was accepted as amended on **2026-11-17** and the work is
**scheduled after phase-2 Task 22**. Nothing in this file exists in the app yet: there is no Plugins
menu, no loader, no `src/plugins/`, and no manager dialog. The assessment and the task breakdown are
in [`.hermes/plans/2026-11-17_130500-notepadpp-web-plugin-host-plan.md`](../.hermes/plans/2026-11-17_130500-notepadpp-web-plugin-host-plan.md);
this file is the part of the design that is already settled by a decision, written down so the
implementation starts from it instead of re-deciding it.

When a task lands, its section gains a **shipped / planned** marker and the check that proves it, the
way `docs/session-persistence.md` and `docs/offline-pwa.md` do.

---

## 1. What "plugins" means here

A plugin is **one ES module file** the user installs from disk. The app stores its source text in
IndexedDB and loads it at runtime with `import()` of a blob URL. It registers itself against a
documented host API and can add commands, toolbar buttons, a docked panel, view-level editor
decorations and document-event handlers.

That is the browser-feasible form of Notepad++'s plugin model, and only that form. What is **not**
here, and never will be without a desktop wrapper (D7) or a backend (D1):

| Notepad++ | This port |
|---|---|
| Native plugin `.dll`, Win32 ABI, Plugin Admin | Impossible — no native code loading. An N++ plugin's *source* can be ported by hand against the host API; its binary cannot be loaded |
| Plugin Admin's catalogue, remote install, auto-update | Out of scope — there is no backend to ask, and the app must work with no network |
| `NppExec`, run external command, shell integration | Impossible — needs a process (D7) |
| Scintilla messages (`SCI_*`, `NPPM_*`, `SCN_*`) | Replaced by typed host methods — see §5 |
| Folder-of-files plugin package | Deferred. A blob-loaded module cannot resolve relative imports between files, and the honest fix is a service-worker virtual origin, which would make plugin loading depend on a worker the app deliberately does not register in development. One module per plugin is this port's analogue of one DLL |

## 2. Trust model — read this before installing anything

A v1 plugin runs **in the page**. It therefore has exactly the privileges the app has: the DOM,
`fetch`, IndexedDB, and the files whose handles the user has granted the editor. **There is no
enforcement boundary.** A manifest field naming permissions would be documentation, not a sandbox.

This is the same trust relationship Notepad++ has with its plugins — a DLL runs with the user's
privileges — but the blast radius differs, because this app holds handles to real files. So the port
makes explicit what N++ leaves implicit:

- The install dialog states, before the file picker opens, that a plugin runs with the page's full
  privileges and can read or change anything the editor can.
- Installing imports the module, so **its top-level code runs at install time** — the equivalent of
  Windows loading a DLL in order to call `setInfo`.
- Nothing installs without a deliberate file selection by the user.
- A plugin that throws is contained: activation, commands and event handlers are each wrapped, the
  error is recorded against that plugin, and the editor keeps working.
- `?plugins=off` starts the app with every plugin skipped — the escape hatch when a plugin is broken.
- The manager can disable or uninstall a plugin at any time. Disabling disposes everything it
  registered and calls its `deactivate()`; it does **not** unload the module from the JS engine, and
  the manager says so rather than implying more. A reload clears it.

Alternatives considered and rejected for v1, with the reason, are in the plan's appendix: a Worker
(no DOM, so no panels and no decorations) and a sandboxed iframe (message-passing only, which would
need a declarative UI schema — a different product). The page module is the only one of the three
that can offer an API comparable to Notepad++'s, which is the goal.

## 3. v1 limits, stated as limits

- **View-level extensions only.** A plugin may add CM6 extensions to every view; it may **not**
  introduce a document-level `StateField`. Document-wide state in a split view has to be copied into
  each freshly mounted clone and reconciled across the panes — the mechanism `workspace.ts` implements
  by hand for bookmarks (S7) and folds (S11). Handing that problem to third-party code would produce
  split views that silently disagree.
- **No new languages in the Language menu.** The registry is generated and every entry is a lazy
  import; `scripts/gen-language-registry.mjs --check` fails on an unaccounted export. Runtime language
  registration is a separate feature, not a plugin-host afterthought.
- **No shadowing the app's keys.** A plugin shortcut that collides with the app's own binding or with
  a browser-reserved chord is rejected at registration and reported in the manager. Ctrl+S keeps
  saving.
- **No cross-plugin messaging**, no multi-file packages, no WASM contract, no remote install, no
  auto-update.
- **One API version.** `apiVersion` must equal the version the app publishes (1 at first release);
  anything else is refused with the supported version named. v1 is additive-only afterwards.

## 4. The host API (design, not yet shipped)

`activate(ctx)` receives a `PluginContext`. The full type will live in `src/plugins/api.ts`; the
surface is:

| Member | What it does | N++ equivalent |
|---|---|---|
| `ctx.cm` | The app's **own** CodeMirror 6 modules — `state`, `view`, `commands`, `search`, `language` | nothing; Scintilla has no second-copy hazard |
| `ctx.commands` | Register a command: label, optional shortcut, optional checked state, optional toolbar button | `getFuncsArray` / `FuncItem` |
| `ctx.toolbar` | Add a toolbar button (text, not a bitmap — this port's toolbar is text) | `NPPM_ADDTOOLBARICON` |
| `ctx.panels` | Register a docked panel; `show()` / `hide()` / `dispose()` | `NPPM_DMM_REGISTERPANEL`, `NPPM_DMM_SHOWPANEL` |
| `ctx.editor` | Read documents and metadata; undoable text and selection edits; `addExtension` for view-level CM6 extensions | `NPPM_GETCURRENTBUFFERID`, `SCI_GETTEXT` / `SCI_SETTEXT`, `SCI_REPLACESEL`, `SCI_*` markers |
| `ctx.events` | `document:opened` / `saved` / `closed` / `activated` / `changed` (debounced) / `language:changed`, plus `ready` | `beNotified`, `SCN_*`, `NPPN_*` |
| `ctx.ui` | Dialogs, confirmations, notices | `NPPM_SETSTATUSBAR`, message boxes |
| `ctx.settings` | Per-plugin key/value storage, namespaced by plugin id | `getPluginConfigPath` + the plugin's own INI |
| `ctx.log` | Console output prefixed with the plugin id | — |

**The singleton rule.** `ctx.cm` exists because CM6 extensions are objects whose behaviour is keyed on
class identity. A plugin that imports `@codemirror/*` itself gets a **second copy** of the library, and
its extensions would be rejected by the view or, worse, ignored silently. There is deliberately no
import map, so a bare specifier fails loudly at import time instead. Everything a plugin needs from
CM6 comes from `ctx.cm`.

**Disposables.** Every registration returns one, `activate` may return a cleanup function, and
disabling a plugin disposes all of it. This is what makes disable/uninstall/reload trustworthy rather
than leaky.

## 5. Porting an N++ plugin, honestly

There is no mechanical route: a plugin written against `PluginInterface.h` and Scintilla messages has
to be rewritten against the host API, line by line, by a person. The mapping in §4 is the reference
for that rewrite. What survives the rewrite is the plugin's *logic* (a Base64 codec, a JSON formatter,
a line sorter); what does not is its plumbing (Win32 handles, `messageProc`, Scintilla markers).

## 6. Install, storage, lifecycle (design)

- **Install:** the user selects a `.js` file (or pastes source). The app reads the text, caps it at
  512 KB, imports it to read its metadata, validates `id` / `version` / `apiVersion`, then stores a
  record in a `plugins` IndexedDB store (DB version 3, additive upgrade per `storage/idb.ts`'s rule)
  and activates it.
- **Persist:** source text plus metadata plus `enabled` plus `lastError` live in IndexedDB, so a
  plugin is available offline by construction. Plugin code is **never** part of the service worker's
  precache — it does not come from a URL the worker sees, and `scripts/check-precache.mjs`'s shell
  count must not move because of this feature.
- **Per-plugin settings:** a `plugin-settings` store, one record per plugin id, ≤ 64 KB.
- **Enable / disable / reload / uninstall:** as §2 describes.
- **Startup order:** plugins start after preferences and **without** blocking the session restore, so
  a slow or broken plugin cannot delay the first document. A plugin that activates after documents
  exist is told about them (`ready`), and its extensions are applied to every live view through the
  same per-view reconfigure path the theme and the language use.

## 7. Open items this file does not settle

- **Multi-file packages** (service-worker virtual origin) — a later task, and only if a real plugin
  needs one.
- **Document-level state for plugins** — needs the split-view reconciliation designed first, not
  bolted on.
- **A WASM contract** — available to a plugin today (it can instantiate bytes), unspecified as a host
  feature.
- **Whether examples ship bundled** — the plan recommends repo-only, installed through the manager;
  a self-served channel would need precaching to work offline.
