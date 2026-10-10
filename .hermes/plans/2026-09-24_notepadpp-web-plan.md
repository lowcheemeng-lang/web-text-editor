# Notepad++ Web Version Implementation Plan

> **For Hermes:** Use plan mode only; no execution unless explicitly approved.
>
> **Progress lives in [`PROGRESS.md`](../PROGRESS.md), not in this file.** This document is the
> spec (what to build, which files, how to verify). Start any new session by reading
> `PROGRESS.md` → `docs/scope.md` → this plan, in that order.

**Status:** Tasks 1–3 ✅ done · Task 4 ✅ built and verified, awaiting its manual picker checklist
(the only reason the ledger says `WIP`) · Tasks 5–8 ⬜ todo · see `PROGRESS.md` for live state
(`npm run status`)

**Scope settled 2026-09-25:** CodeMirror 6 (D2) · no Run/exec or native plugins (D7) ·
phase-3 priority = encoding fidelity + large-file mode (D10) · **MVP is Chromium-only (D11)**.
Task 4 below already reflects D11.
**Also settled 2026-10-06:** macros = transaction record/replay (D6) · MVP language set =
22 official packages + 103 legacy modes (D9).

**Goal:** Produce a browser-based text editor inspired by Notepad++ that runs fully client-side with no backend dependency.

**Architecture:** Single-page web app using the browser's File System Access API, IndexedDB, and native web APIs to replicate core Notepad++ editing and plugin-like extensibility without server code.

**Tech Stack:**
- HTML5 + CSS3 + TypeScript (strict), bundled by Vite 8 (Rolldown)
- **CodeMirror 6** as the editing engine (D2 — see `docs/editor-core-decision.md`)
- Web Workers for search/indexing (phase 2+; CM6 needs none for the MVP)
- OPFS + IndexedDB for session/document persistence (D8)
- File System Access API for real file read/write (Tier A, Chromium — D11)

---

## Current Context / Assumptions

- Source of truth: `https://github.com/notepad-plus-plus/notepad-plus-plus`
- Goal is not a 1:1 C++ rewrite, but a functionally aligned web edition.
- Must run without a backend: no Node server, no cloud sync unless optional.
- “Plugin” behavior must be approximated via JS modules, service workers, or WebAssembly where needed.
- **The MVP targets Chrome/Chromium only** (D11). Firefox/Safari fallback paths are designed but
  deferred to phase 2; do not spend MVP time on them beyond the thin capability check (S4).

## Proposed Approach

1. Define a scoped feature set that is realistically buildable client-side. ✅ Task 1
2. Scaffold a Vite + TS app. ✅ Task 2
3. Integrate an existing web editor core and layer Notepad++-style UI/UX on top. ✅ Task 3
4. Implement file I/O using browser APIs with graceful fallbacks. ← Task 4 (next)
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
**Outcome:** Complete. Decisions ran D1–D11; all four questions that were open in §10 are now
resolved (D2, D7, D10, D11). As of 2026-10-06 D6 and D9 are accepted too; **D1, D3, D4, D5 and
D8 remain proposed, and only D3 + D4 gate a task (Task 4).**

---

### Task 2: Initialize project scaffold — ✅ DONE (2026-09-25)

**Objective:** Create a buildable client-only project.

**Files:**
- Create: `package.json` ✅
- Create: `vite.config.ts` ✅
- Create: `tsconfig.json` ✅
- Create: `index.html` ✅
- Create: `src/main.ts` ✅
- Create: `src/style.css` ✅
- Create: `scripts/verify-task2.py` ✅ (executable acceptance check — S2)

**Steps:**
1. Scaffold Vite + TypeScript project. ✅ (vite 8.3.1, typescript 7.0.2)
2. Add Monaco Editor or CodeMirror 6 as a dependency. ✅ (CodeMirror 6, per D2)
3. Configure dev server for local-only use. ✅ (`host: 127.0.0.1`, `strictPort`)

**Verification:** `npm install && npm run dev` serves the editor at `http://127.0.0.1:5173`.
**Outcome:** Passed — `npm run typecheck` exit 0; `npm run build` exit 0 with `editor-core`
382.37 kB raw / **123.08 kB gzip**; `python3 scripts/verify-task2.py` → PASS (1 CM6 instance
rendering, typing verified, 0 console errors). Pitfalls and evidence in `PROGRESS.md`.
**Note (2026-10-06):** that script checked the `basicSetup` scaffold, which Task 3 replaced by
design — it no longer runs against HEAD and now reports itself as superseded. To reproduce the
Task 2 result, check out `26aaea6`; the live equivalent is `scripts/verify-task3.py`.

---

### Task 3: Implement editor core with Notepad++ defaults — ✅ DONE (2026-10-06)

**Objective:** Replace the provisional `basicSetup` with an explicit CodeMirror 6 extension list
tuned to Notepad++ behaviour, then add multi-document editing.

**Files:**
- Modify: `src/main.ts` ✅
- Create: `src/editor/notepadpp-config.ts` ✅
- Create: `src/editor/tabs.ts` ✅ (multi-document state — one `EditorState` per document)
- Create: `src/editor/split-view.ts` ✅ *(added during the task — the R2 correction below made the
  view-sync mechanism its own module rather than an implementation detail of the tab strip)*
- Create: `src/editor/chrome.ts` ✅ *(added — pure-DOM shell: toolbar, panes, tab strips, status bar)*
- Create: `src/editor/workspace.ts` ✅ *(added — the orchestrator tying the four modules together)*
- Create: `src/editor/spike-r2.ts` ✅ *(dev-only spike harness, not in the bundle)*
- Create: `scripts/verify-task3.py` ✅ *(S2 acceptance check)*
- Create: `scripts/spike-r2-split.py` + `docs/r2-shared-state-spike.md` ✅ *(R2 evidence)*

**Steps:**
0. **Spike first (risk R2, timeboxed):** prove that a second `EditorView` can render the same
   `EditorState` and behave as split view / "clone to other view". This gates steps 2–3.
   **Done — and the step as written was wrong.** Two views handed one `EditorState` diverge
   *silently* (no exception; the second view simply keeps rendering the old text). The working
   design is two states with document changes forwarded between them under a `syncAnnotation`,
   and only the owner view carrying `history()`. Evidence: `docs/r2-shared-state-spike.md`,
   `python3 scripts/spike-r2-split.py` → PASS (12/12). Risk R2 is closed.
1. Configure default font, tab size, indent unit, tabs-vs-spaces, word wrap, line numbering,
   current-line highlight, and caret behavior to match N++ defaults. ✅
2. Add multi-document interface via editor tabs (tab strip, dirty indicator, close prompt). ✅
3. Implement split-view and clone-to-other-view. ✅ **As shipped (S5):** the active document is
   shown in both panes — two views, one document, one undo history, per-view caret and scroll.
   Notepad++'s independent per-pane tab sets are Tier 2 and stay in phase 2.

**Verification:** Open app; confirm tabbed editing, N++ default font/size, word-wrap toggle, and
clone-document behavior work. Add `scripts/verify-task3.py` (S2) covering the same in Chrome.
**Outcome:** Complete. `python3 scripts/verify-task3.py` → **PASS (56/56)**; `python3
scripts/spike-r2-split.py` → **R2_SPIKE: PASS (12/12)**; `npm run typecheck` exit 0; `npm run
build` exit 0 with `editor-core` 296.81 kB raw / **96.16 kB gzip** — *down* from Task 2's
123.08 kB, because `basicSetup` carried autocompletion and search that Tasks 5–6 own. The
acceptance check found three defects, all fixed rather than worked around: the editor sized
itself to its content so long unwrapped lines never scrolled, a newly mounted document's editor
started unfocused (losing the next keystroke), and two of the check's own assertions were
wrong. Details in `PROGRESS.md`.

---

### Task 4: Implement file operations without backend

**Objective:** Add the file lifecycle using browser APIs only. **Chromium-only in the MVP (D11)** —
the tier B/C fallback I/O is deferred to phase 2, not deleted.

**Files:**
- Create: `src/file/file-io.ts` (the single module boundary — see risk R8)
- Create: `src/platform/capabilities.ts` (thin feature test — S4)
- Create: `src/file/fallbacks.ts` — **phase 2 (deferred by D11)**
- Modify: `src/editor/chrome.ts` + `src/editor/workspace.ts` (menu-bar host — see step 6)
- Modify: `src/main.ts`

**Steps:**
1. Use File System Access API for open/save/save-as. ✅ in scope for the MVP.
2. ~~Implement `<input type="file">` + Blob download fallback.~~ **Deferred to phase 2 by D11.**
3. Persist recent files in IndexedDB (stored handles). ✅ `src/file/recent-files.ts` — handles are
   structured-cloneable, so the list survives a reload (proved by the acceptance check, which
   asserts it *after* a page reload). A restored handle is treated as a capability reference, not
   as permission: `ensureAccess` re-checks before reopening, and a dead entry is forgotten.
4. Handle encoding selection and BOM-aware reads/writes, limited to the WHATWG label set (D4).
   The `iso-8859-1`→windows-1252 trap in `docs/scope.md` §6 must be encoded as an explicit
   comment, not discovered later.
5. Add the capability check from `src/platform/capabilities.ts`: on a browser without the
   pickers, show an explicit "not supported yet" message rather than throwing (S4, mitigates R8).
6. **Add the menu bar that Task 3 already promised to this task.** `src/editor/chrome.ts` and
   `index.html` both defer it here — "once File ▸ Open / Save exist to put in it", which is now.
   It was missing from this spec, so without it Task 4 ships Open/Save reachable only from the
   toolbar, or leaves two comments lying about a menu.

**Verification:**
- Open a local text file, edit, and save changes in Chrome — including a byte-identical
  round-trip when nothing was edited (CRLF and CRLF+BOM).
- Confirm a non-Chromium browser shows the unsupported-browser message instead of a stack trace.
- **Automation constraint, settled here rather than discovered mid-task:** Playwright cannot drive
  `showOpenFilePicker` / `showSaveFilePicker` — they are OS-level dialogs outside the page, and
  there is no CDP hook for them. So `scripts/verify-task4.py` (S2) must **stub the pickers in-page
  with handles backed by OPFS** (`navigator.storage.getDirectory()`), which returns genuine
  `FileSystemFileHandle` objects. That exercises the real read/write/BOM/encoding paths against
  real browser file APIs with only the OS dialog faked. The end-to-end picker round-trip stays a
  short **manual** checklist (open → edit → save → confirm on disk, including a CRLF+BOM file),
  recorded in the ledger as manual evidence — no automation may claim it on its behalf.

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

**Objective:** Provide language-aware editing using the CM6 language packages (D9).

**Files:**
- Create: `src/languages/registry.ts`
- Modify: `src/editor/notepadpp-config.ts`

**Steps:**
1. Register supported languages per **D9 (accepted 2026-10-06)**: all 22 official CM6 packages
   as first-class Lezer grammars, plus all 103 `@codemirror/legacy-modes` ports as the long
   tail, each lazily imported (so an unopened language costs 0 bytes). Open sub-question for
   this task: whether to *also* hand-write `makefile` / `batch` / `INI` modes — nothing exists
   for those three anywhere, and C# coverage via `clike` is unverified.
2. Implement language detection by content and extension.
3. Add the overview ruler as the language-aware navigation aid.

**Note:** the **Document Map / minimap is not in this task.** It is Tier 2/3 with no MVP promise
(`docs/editor-core-decision.md` B1); a canvas minimap is part of the D10 large-file/phase-3 work.

**Verification:** Open `.js`, `.py`, `.html`, `.md` files; confirm highlighting and the overview
ruler update correctly.

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
- `src/editor/tabs.ts`
- `src/editor/chrome.ts` *(added by Task 3)*
- `src/editor/split-view.ts` *(added by Task 3)*
- `src/editor/workspace.ts` *(added by Task 3)*
- `src/file/file-io.ts`
- `src/platform/capabilities.ts`
- `src/file/fallbacks.ts` — phase 2 (deferred by D11)
- `src/search/find-replace.ts`
- `src/languages/registry.ts`
- `src/storage/session-store.ts`
- `src/storage/preferences.ts`
- `docs/scope.md`
- `package.json`
- `vite.config.ts`
- `tsconfig.json`
- `index.html`
- `public/manifest.webmanifest`
- `scripts/verify-task*.py`

## Tests / Validation

- **Browser matrix: Chrome/Chromium only for the MVP (D11).** Firefox and Safari are phase 2 —
  the app should refuse them with a clear message (Task 4 step 5), not fail obscurely.
- Feature checklist against `docs/scope.md`.
- Performance test: open/scroll/search a 50k-line file.
- Offline test with DevTools Network set to offline.
- Byte-identical open→save round-trip (CRLF and CRLF+BOM), per `docs/scope.md` §8.
- Each task ships `scripts/verify-task<N>.py` where browser behaviour is involved (S2).

## Risks, Tradeoffs, and Open Questions

- Notepad++ plugins cannot be directly ported; only plugin-like JS modules are feasible (D5/D7).
- File System Access API is Chromium-first; **by D11 that is now the MVP's only path**, and the
  Firefox/Safari fallback flows are deferred to phase 2 — tracked as risk R8 (retrofit cost).
- Large-file performance depends on editor core virtualization; benchmark early. CodeMirror has no
  `largeFileOptimizations` flag, so we own the threshold (D10 phase-3 priority).
- Encoding edge cases (UTF-32, DOS code pages) require WebAssembly decoders — the scheduled
  phase-3 priority (D10), with an honest warning in the MVP.
- No backend means no true multi-user collaboration unless WebRTC is added later.

## Open Questions

All of the original three are closed; kept for the audit trail.

1. ~~Should the web edition target desktop install via Tauri/Wails, or pure browser-only?~~
   → **D1, still proposed:** browser-first; desktop wrappers can reuse the bundle later.
2. ~~Is macro recording feasible with Web APIs, or should it be deferred?~~
   → **D6 — accepted 2026-10-06:** feasible — record CM6 transactions. Tier 2, not the MVP.
3. ~~Should UDL/user-defined languages be supported from day one?~~
   → **Answered 2026-09-25 (D10): no.** UDL is Tier 3 and ranked *below* encoding fidelity and
   large-file mode.

---

Plan complete and saved. Tasks 1–3 are done; Task 4 is the next unit of work and is gated on
decisions **D3** and **D4** — see `PROGRESS.md` for the live next action.
