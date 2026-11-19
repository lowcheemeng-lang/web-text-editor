# Plugins

A plugin is **one ES module file** (`.js`). Install it from **Plugins ▸ Plugin Manager…**,
either by picking the file, dropping it on the manager, or pasting its source. The
source is kept in IndexedDB; nothing is fetched from a network, and nothing is
added to the app's own precache.

## Read this before installing one

A plugin runs **inside this page**, with this page's privileges. It can read every
document you have open and anything else this origin can reach. There is no
sandbox, no permission prompt per capability, and no review process. Install only
source you have read yourself, or an author you trust with your documents.

Two deliberate limits:

- **One module file.** A plugin cannot import another file it ships. Bundle
  whatever it needs into that one file (or use a CDN — but then it is no longer
  offline).
- **View-level CodeMirror extensions only.** A `StateField` would have to be copied
  into every freshly mounted split-pane state; that trap is why the host exposes
  extensions that are safe to reconfigure instead.

## What a plugin can do

```js
export default {
  id: "me.example",          // stable, unique, must match on every update
  name: "Example",
  version: "1.0.0",
  apiVersion: 1,             // the host supports 1
  activate(ctx) { /* register things; optionally return a cleanup function */ },
};
```

`ctx` is the whole surface:

| Member | What it does |
| --- | --- |
| `ctx.editor.documents()` / `active()` | Snapshots: `{ id, name, fileName, language, dirty, readOnly, lineCount, characterCount }` |
| `ctx.editor.text(id?)` / `setText(text, id?)` | Read or replace the document (an undoable transaction) |
| `ctx.editor.selections(id?)` / `replaceSelections(fn, id?)` | Read or map selections |
| `ctx.editor.addExtension(ext)` | A CodeMirror 6 extension, for every view |
| `ctx.commands.register({ id, label, shortcut?, run })` | A Plugins-menu item; `shortcut` is `Ctrl+Alt+B` or `Mod-z` |
| `ctx.toolbar.addButton({ id, label, title?, onClick })` | A toolbar button |
| `ctx.panels.register({ id, title, render, onShow?, onHide? })` | A docked panel; `render(host)` returns an optional cleanup |
| `ctx.events.on(type, handler)` | `document:opened/saved/closed/activated/changed`, `language:changed`, `ready` |
| `ctx.ui.notice(title, body, { kind })` / `confirm(message, opts)` / `dialog(spec)` | The app's own dialogs |
| `ctx.settings.get/set/all` | Per-plugin settings, stored in IndexedDB |
| `ctx.cm` | The app's own CodeMirror modules — the **only** copy in the page |
| `ctx.log(...)` | A prefixed console line |

Shortcuts that the app already uses (`Ctrl+S`, `Alt+F`, …) are refused at
registration; a plugin cannot take one silently.

## Examples

| File | Shows |
| --- | --- |
| [probe.js](examples/probe.js) | a `ViewPlugin` from `ctx.cm`, visible as `[data-plugin-probe]` on both panes |
| [base64.js](examples/base64.js) | replacing selections; UTF-8; one undoable edit |
| [word-count.js](examples/word-count.js) | a docked panel that follows the active document |
| [json-format.js](examples/json-format.js) | formatting, and a notice instead of corrupting invalid JSON |
| [xml-format.js](examples/xml-format.js) | a small parser of its own: re-indents elements, leaves mixed content exactly as written, refuses invalid XML with a line number |
| [broken.js](examples/broken.js) | the failure path: activation throws, the editor keeps working |

Install `probe.js` first: if `[data-plugin-probe]` appears on the editor, the host
is loading plugins at all. (It marks with a data attribute because CodeMirror owns
the editor element's `className` and rewrites it when theme classes are applied — a
plugin that adds a CSS class there can lose it on a freshly mounted split pane.)

## Installing from source in a checkout

```bash
npm run dev
# Plugins ▸ Plugin Manager… ▸ Install from file… ▸ plugins/examples/base64.js
```

To start without any plugin (the escape hatch when one breaks startup), add
`?plugins=off` to the URL. The manager still opens in that mode so a bad plugin
can be disabled or removed, but it will not start one.

## Limits you will meet

- **No remote catalogue, no auto-update.** Reinstall the file to update a plugin.
- **Disable is not unload.** A module cannot be removed from the JavaScript engine;
  disabling disposes everything it registered and revokes its blob URL, but its
  top-level code stays in memory until the page reloads.
- **Activation is time-boxed** (1.5 s). A plugin that hangs is marked failed and
  its registrations are refused.
- **No native code.** Nothing here runs a `.dll`, a process, or a shell.

The host's contract, including the trust model, is written up in
[`docs/plugins.md`](../docs/plugins.md); the plan that built it is
[`P0–P8`](../.hermes/plans/2026-11-17_130500-notepadpp-web-plugin-host-plan.md).
