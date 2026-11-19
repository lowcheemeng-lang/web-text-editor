# notepadpp-web

A browser-based, backend-free text editor in the spirit of Notepad++.
Built with [Vite](https://vitejs.dev), TypeScript and [CodeMirror 6](https://codemirror.net) — no server, no account, your files never leave your machine.

## Features

- **Notepad++ defaults** — the editor behaves like N++ out of the box: tabs, current-line highlight, indentation guides, an overview ruler, split view, zoom, and N++'s own keybindings (`Ctrl+F2` bookmarks, `F2`/`Shift+F2` navigation, and friends).
- **Real file operations without a backend** — open and save files straight from the browser via the File System Access API (with OPFS fallback), including byte-faithful round trips: CRLF, BOMs, and windows-1252 encodings are preserved, and "recent files" survive a reload.
- **Search, replace, navigate** — N++'s Find dialog with Normal / Extended / Regular-expression modes, match case, whole word, wrap-around, backward search, in-selection, Mark All, Count, `$1` back-references in replacements, Go To line/offset, and the full bookmark family.
- **140 languages** — syntax highlighting with N++'s own token colours, auto-detection from filename/extension/shebang, and a Language menu grouped A–Z under first-letter submenus just like the original.
- **Session persistence & preferences** — unsaved buffers, dirty files, caret, folds, bookmarks, language choices and preferences are restored after a reload from IndexedDB; a Preferences dialog covers the usual knobs.
- **Dark Mode** — faithful to Notepad++'s own dark theme (`DarkModeDefault.xml` for the editor, `NppDarkMode.cpp` for the chrome), applied live and with no white flash on reload.
- **Installable & offline (PWA)** — installable as a standalone window; once loaded it works with no network at all, and edits still save through to your files.

## Getting started

Requires Node.js 22+ (older Node 20.x will mostly work, but the toolchain is tested on 22).

```bash
npm install
npm run dev        # Vite dev server → http://localhost:5173
```

Production build and preview:

```bash
npm run build      # typecheck + build into dist/
npm run preview    # serve the built dist/ locally
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run typecheck` | TypeScript check only, no output |
| `npm run status` | Prints the project progress report from `PROGRESS.md` |

> **Browser note:** opening and saving real files uses the File System Access API, which is available in Chrome, Edge and other Chromium-based browsers. Other browsers get a reduced mode (edit and save via downloads) — the app says so rather than failing silently.

## Project layout

```
src/
  editor/      N++-style defaults, chrome, tabs, split view, preferences, palettes
  file/        File System Access + OPFS file I/O, recent files
  languages/   language registry, detection, highlighting, N++ token colours
  search/      find/replace dialog, bookmarks
  storage/     IndexedDB helpers, session store, backup store, preferences
  platform/    capability detection
  pwa/         service worker registration
public/        manifest + icons
scripts/       verification harnesses (browser-driven) and unit-style Node tests
docs/          design decisions: scope, editor core, session persistence, offline/PWA
.hermes/plans/ the build plans (phase 1 and phase 2) this repo was built from
PROGRESS.md    task-by-task ledger with the evidence behind every claim
```

## Documentation

- `docs/scope.md` — compatibility matrix, encoding support, and known risks
- `docs/editor-core-decision.md`, `docs/session-persistence.md`, `docs/offline-pwa.md` — design write-ups
- `docs/plugins.md` — the plugin host's trust model, API surface and v1 limits (**P0–P6 built**: Plugins menu, commands, events, dock, Plugin Manager; examples and acceptance check still to come)
- `PROGRESS.md` — the full task ledger: every feature with the exact verification runs (assertion counts, timings) behind it

## Status

All 10 planned tasks are done: editor core, file operations, search/replace, languages, session persistence, PWA/offline, the Language menu, and dark mode — each verified end-to-end by the harnesses in `scripts/`. Phase 2 items are tracked in `PROGRESS.md`.

## License

Private project (not published under an open-source license yet).
