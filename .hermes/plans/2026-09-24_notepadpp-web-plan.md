# Notepad++ Web Version Implementation Plan

> **For Hermes:** Use plan mode only; no execution unless explicitly approved.
>
> **Progress lives in [`PROGRESS.md`](../PROGRESS.md), not in this file.** This document is the
> spec (what to build, which files, how to verify). Start any new session by reading
> `PROGRESS.md` → `docs/scope.md` → this plan, in that order.

**Status:** Task 1 ✅ done · Tasks 2–8 ⬜ todo · see `PROGRESS.md` for live state (`node scripts/status.mjs`)

**Goal:** Produce a browser-based text editor inspired by Notepad++ that runs fully client-side with no backend dependency.

**Architecture:** Single-page web app using the browser's File System Access API, IndexedDB, and native web APIs to replicate core Notepad++ editing and plugin-like extensibility without server code.

**Tech Stack:**
- HTML5 + CSS3 + Vanilla JavaScript/TypeScript
- Monaco Editor or CodeMirror 6 as the editing engine
- Vite for dev/build
- Web Workers for search/indexing
- IndexedDB / localStorage for settings/session persistence
- File System Access API for real file read/write where supported

---

## Current Context / Assumptions

- Source of truth: `https://github.com/notepad-plus-plus/notepad-plus-plus`
- Goal is not a 1:1 C++ rewrite, but a functionally aligned web edition.
- Must run without a backend: no Node server, no cloud sync unless optional.
- “Plugin” behavior must be approximated via JS modules, service workers, or WebAssembly where needed.

## Proposed Approach

1. Define a scoped feature set that is realistically buildable client-side.
2. Scaffold a Vite + TS app.
3. Integrate an existing web editor core and layer Notepad++-style UI/UX on top.
4. Implement file I/O using browser APIs with graceful fallbacks.
5. Add high-value features from Notepad++ that map cleanly to web capabilities.
6. Package as a standalone HTML/JS bundle or PWA.

## Step-by-Step Plan

### Task 1: Define scope and compatibility matrix — ✅ DONE (2026-09-25)

**Objective:** Lock down a minimal viable feature set and document API/fallback behavior.

**Files:**
- Create: `docs/scope.md` ✅

**Steps:**
1. List must-have vs nice-to-have features from Notepad++. ✅ (Tiers 1–3 + an "impossible backend-free" table)
2. Map each feature to browser support status for File System Access API, OPFS, File API, and WebAssembly. ✅ (capability matrix + encoding matrix)
3. Document fallback UX for unsupported browsers. ✅ (fallback tiers A/B/C + a fallback column on every ❌)

**Verification:** `docs/scope.md` reviewed; each feature has a target API or a fallback entry.
**Outcome:** Complete, with decisions D1–D9 proposed and four open questions awaiting sign-off
(`docs/scope.md` §10). D2 (CodeMirror 6) must be confirmed before Task 3.

---

### Task 2: Initialize project scaffold

**Objective:** Create a buildable client-only project.

**Files:**
- Create: `package.json`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `index.html`
- Create: `src/main.ts`

**Steps:**
1. Scaffold Vite + TypeScript project.
2. Add Monaco Editor or CodeMirror 6 as a dependency.
3. Configure dev server for local-only use.

**Verification:** Run `npm install && npm run dev` and confirm editor loads at `http://localhost:5173`.

---

### Task 3: Implement editor core with Notepad++ defaults

**Objective:** Replace default Monaco/CodeMirror settings and UX with Notepad++-style behavior.

**Files:**
- Modify: `src/main.ts`
- Create: `src/editor/notepadpp-config.ts`

**Steps:**
1. Configure default font, tab size, word wrap, line numbering, and caret behavior.
2. Add multi-document interface via editor tabs.
3. Implement split-view and clone-to-other-view using editor instances.

**Verification:** Open app; confirm tabbed editing, default font/size, word-wrap toggle, and clone-document behavior work.

---

### Task 4: Implement file operations without backend

**Objective:** Add full file lifecycle using browser APIs only.

**Files:**
- Create: `src/file/file-io.ts`
- Create: `src/file/fallbacks.ts`
- Modify: `src/main.ts`

**Steps:**
1. Use File System Access API for open/save/save-as where available.
2. Implement `<input type="file">` + Blob download fallback.
3. Persist recent files in IndexedDB.
4. Handle encoding selection and BOM-aware reads/writes.

**Verification:**
- Open a local text file, edit, and save changes on Chromium.
- On Firefox/Safari fallback, confirm open/download path works.

---

### Task 5: Add search, replace, and navigation

**Objective:** Replicate Notepad++ find/replace and navigation features.

**Files:**
- Create: `src/search/find-replace.ts`
- Modify: `src/editor/notepadpp-config.ts`

**Steps:**
1. Implement find/replace dialogs with regex, match case, whole word, wrap around.
2. Add mark-all, find-next/prev, replace/replace-all.
3. Add GoTo line and bookmark margin toggles.

**Verification:** Search/replace across a 10k-line file; confirm regex, wrap, and bookmarks work without backend.

---

### Task 6: Implement basic syntax highlighting and language modes

**Objective:** Provide language-aware editing and document map experience.

**Files:**
- Create: `src/languages/registry.ts`
- Modify: `src/editor/notepadpp-config.ts`

**Steps:**
1. Register supported languages from Monaco/CodeMirror tokenizers.
2. Implement language detection by content and extension.
3. Add minimap or overview ruler as a Notepad++ substitute.

**Verification:** Open `.js`, `.py`, `.html`, `.md` files; confirm highlighting and minimap update correctly.

---

### Task 7: Add session persistence and preferences

**Objective:** Maintain session state across reloads without backend.

**Files:**
- Create: `src/storage/session-store.ts`
- Create: `src/storage/preferences.ts`

**Steps:**
1. Save open tabs, caret positions, and scroll positions in IndexedDB.
2. Persist UI preferences: theme, font size, word wrap, toolbar layout.
3. Implement restore on startup.

**Verification:** Reload app after editing; confirm tabs and positions restore.

---

### Task 8: Wrap as installable offline-capable web app

**Objective:** Make the editor usable without network after first load.

**Files:**
- Create: `public/manifest.webmanifest`
- Modify: `vite.config.ts`

**Steps:**
1. Add PWA manifest and service worker caching for static assets.
2. Optionally bundle as a single portable HTML file for maximum portability.
3. Verify offline load path.

**Verification:** Load app once, disable network, reload; confirm editor loads and functions offline.

---

## Files Likely to Change

- `src/main.ts`
- `src/editor/notepadpp-config.ts`
- `src/file/file-io.ts`
- `src/search/find-replace.ts`
- `src/storage/session-store.ts`
- `src/storage/preferences.ts`
- `docs/scope.md`
- `package.json`
- `vite.config.ts`
- `tsconfig.json`
- `index.html`
- `public/manifest.webmanifest`

## Tests / Validation

- Manual browser matrix: Chromium, Firefox, Safari.
- Feature checklist against `docs/scope.md`.
- Performance test: open/scroll/search a 50k-line file.
- Offline test with DevTools Network set to offline.

## Risks, Tradeoffs, and Open Questions

- Notepad++ plugins cannot be directly ported; only plugin-like JS modules are feasible.
- File System Access API is Chromium-first; Firefox/Safari need fallback flows.
- Large-file performance depends on editor core virtualization; benchmark early.
- Encoding edge cases (UTF-16, legacy code pages) may require WebAssembly decoders.
- No backend means no true multi-user collaboration unless WebRTC is added later.

## Open Questions

1. Should the web edition target desktop install via Tauri/Wails, or pure browser-only?
2. Is macro recording feasible with Web APIs, or should it be deferred?
3. Should UDL/user-defined languages be supported from day one?

---

Plan complete and saved. Ready to execute only after you approve; execution would proceed file-by-file in plan order with verification after each task.
