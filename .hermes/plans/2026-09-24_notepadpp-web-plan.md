# Notepad++ Web Version Implementation Plan

> **For Hermes:** Use plan mode only; no execution unless explicitly approved.
>
> **Progress lives in [`PROGRESS.md`](../PROGRESS.md), not in this file.** This document is the
> spec (what to build, which files, how to verify). Start any new session by reading
> `PROGRESS.md` → `docs/scope.md` → this plan, in that order.

**Status:** Tasks 1–7 ✅ done · Task 8 ⬜ next · see `PROGRESS.md` for live state
(`npm run status`). Task 6 was accepted 2026-10-11: `scripts/verify-task6.py` → **PASS (67/67)**,
`scripts/test-languages.mjs` → **238/238**. Task 5 was accepted 2026-10-10:
`scripts/verify-task5.py` → **PASS (105/105)**, twice in a row, over a 10k-line file as the task
asked.

**Scope settled 2026-09-25:** CodeMirror 6 (D2) · no Run/exec or native plugins (D7) ·
phase-3 priority = encoding fidelity + large-file mode (D10) · **MVP is Chromium-only (D11)**.
Task 4 below already reflects D11.
**Also settled 2026-10-06:** macros = transaction record/replay (D6) · MVP language set =
22 official packages + 103 legacy modes (D9).
**Also settled 2026-10-12:** mobile/tablet is out of the MVP (D12) — a phone or tablet gets the S4
notice, the way Firefox and Safari do. No task changes: the notice follows from the pickers being
absent, not from a device check.

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
4. Implement file I/O using browser APIs with graceful fallbacks. ✅ Task 4
5. Add high-value features from Notepad++ that map cleanly to web capabilities. ✅ Task 5
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
**Outcome:** Complete. Decisions ran D1–D12; all four questions that were open in §10 are now
resolved (D2, D7, D10, D11). As of 2026-10-06 D6 and D9 are accepted too, and as of 2026-10-12 D12
(mobile/tablet out) — **D1, D3, D4, D5 and D8 remain proposed, and none of them gates a task now**
(D3 + D4 gated Task 4, which is done).**

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

### Task 4: Implement file operations without backend — ✅ DONE (2026-10-10)

**Objective:** Add the file lifecycle using browser APIs only. **Chromium-only in the MVP (D11)** —
the tier B/C fallback I/O is deferred to phase 2, not deleted.

**Files:**
- Create: `src/file/file-io.ts` (the single module boundary — see risk R8) ✅
- Create: `src/platform/capabilities.ts` (thin feature test — S4) ✅
- Create: `src/file/recent-files.ts` ✅ *(added during the task — step 3)*
- Create: `src/file/fallbacks.ts` — **phase 2 (deferred by D11)**
- Modify: `src/editor/chrome.ts` + `src/editor/workspace.ts` (menu-bar host — see step 6) ✅
- Modify: `src/main.ts` ✅
- Create: `scripts/verify-task4.py` ✅ *(S2 acceptance check, OPFS-stubbed pickers)*
- Create: `scripts/verify-task4-pickers.py` ✅ *(added 2026-10-10 — the real dialog, end to end)*

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
- **Automation, settled and then corrected (2026-10-10).** The CDP facts stand: Playwright cannot
  *answer* `showOpenFilePicker` / `showSaveFilePicker` — `Page.setInterceptFileChooserDialog` emits
  `Page.fileChooserOpened` for a File System Access picker without a `backendNodeId`, and
  `DOM.setFileInputFiles` only answers a chooser that has an `<input type=file>` behind it. So
  `scripts/verify-task4.py` (S2) stubs the pickers in-page with handles backed by OPFS
  (`navigator.storage.getDirectory()`), which returns genuine `FileSystemFileHandle` objects and
  exercises the real read/write/BOM/encoding paths with only the dialog faked.
  **But the dialog itself is driveable on a machine with an X server**, which this plan originally
  concluded was impossible: `scripts/verify-task4-pickers.py` runs a *headed* Chrome under `Xvfb`,
  finds the GTK chooser as an X window, types the path with `xdotool`, screenshots it with
  `ffmpeg -f x11grab`, and answers Chrome's "Save changes to …?" write prompt. It opens and writes
  real files in `/tmp` and compares `md5` on disk → **PASS (42/42)**, twice in a row, so the
  end-to-end picker round trip is no longer a manual step. Two environment notes it encodes: Chrome must run under
  `dbus-run-session` (otherwise `xdg-desktop-portal` takes the request and renders the dialog on the
  portal's own display), and a plain Save is not proof of anything unless the file's inode/mtime
  move — a cancelled write leaves the bytes byte-identical too.
- A human pass on the user's own desktop is still possible and now optional: `Alt+O` each
  `/tmp/t4-*.txt`, `Alt+S`, `md5sum` again, and cancel one picker.

**Outcome:** Complete 2026-10-10. `python3 scripts/verify-task4-pickers.py` → **PASS (42/42)** on
the real chooser; `python3 scripts/verify-task4.py` → **PASS (44/44)**; `node
--experimental-strip-types scripts/test-file-io.mjs` → **PASS (45/45)**; `python3
scripts/verify-task3.py` → **PASS (58/58)**; `python3 scripts/spike-r2-split.py` → **R2_SPIKE:
PASS**; `npm run typecheck` → exit 0; `npm run build` → exit 0 with `editor-core` 296.81 kB raw /
**96.16 kB gzip**. Two of this task's own checks were caught passing vacuously (a cancelled write
leaves a file byte-identical, so "bytes unchanged" proved nothing) and now assert the write's side
effect — see `PROGRESS.md`, Session 3.

---

### Task 5: Add search, replace, and navigation — ✅ DONE (2026-10-10)

**Objective:** Replicate Notepad++ find/replace and navigation features.

**Files:**
- Create: `src/search/find-replace.ts` ✅ (the Find/Replace/Mark dialog, the commands over
  `SearchQuery`, the marks, and the Go To dialog)
- Create: `src/search/bookmarks.ts` ✅ (*added to this list while building it*: the bookmark
  state field, its gutter and its commands are a mechanism of their own, and `find-replace.ts`
  was already the largest file in `src/`)
- Modify: `src/editor/notepadpp-config.ts` ✅ (keys, the new extensions, N++'s mark/bookmark
  colours, four more `DEVIATIONS_FROM_NPP` entries)
- Create: `scripts/verify-task5.py` ✅ (executable acceptance check — S2)
- Create: `scripts/probe-reserved-keys.py` ✅ (*added*: the measurement that decides which of
  N++'s search keys a page can hold — decision S6)

**Steps:**
1. Implement find/replace dialogs with regex, match case, whole word, wrap around. ✅ Normal /
   Extended / Regular-expression modes, Match case, Match whole word only, Wrap around,
   Backward direction, In selection, and N++'s own gating of those controls per mode
   (`FindReplaceDlg.cpp:2695-2740`).
2. Add mark-all, find-next/prev, replace/replace-all. ✅ Plus Count and Clear all marks (both
   N++ buttons), the Mark tab's "Bookmark line", and N++'s status wording for each outcome.
3. Add GoTo line and bookmark margin toggles. ✅ The Go To dialog is `IDD_GOLINE` (Line /
   Offset, "You are here:", "You want to go to:", "You can't go further than:", "Go" / "I'm
   going nowhere"); bookmarks are the full N++ family (toggle / next / previous / clear all)
   and the margin toggle sits in the View menu — N++ keeps it under Settings ▸ Preferences ▸
   Margins, and this app has no Settings menu yet.

**Verification:** Search/replace across a 10k-line file; confirm regex, wrap, and bookmarks work
without backend. ✅ `python3 scripts/verify-task5.py` → **PASS (105/105)**, twice in a row, with
regex Count **2.4 ms**, Mark All **4.8 ms** and Replace All **46.5 ms** over 10 000 lines, and
`no request left the machine (D1)` green.

**Outcome:** Complete. **Find is Alt+F, not Ctrl+F** — measured, not assumed: Chrome delivers no
keydown to the page for Ctrl+F and opens its find bar regardless of `preventDefault`
(`scripts/probe-reserved-keys.py`, decision S6). Every other key in the family keeps N++'s
binding, because the page does receive those keydowns and `preventDefault` suppresses Chrome's
action: Ctrl+H, Ctrl+G, Ctrl+M, F3 / Shift+F3 and F2 / Shift+F2 / Ctrl+F2.
`Find in Files`, the Search Results window, incremental search and the Smart Highlighter are not
built (a page has no filesystem, and the other two are tier-2 rows); `DEVIATIONS_FROM_NPP` says
so in the app's own source. The regex engine is JavaScript's, not Boost's — also recorded there.

---

### Task 6: Implement basic syntax highlighting and language modes — ✅ DONE (2026-10-11)

**Objective:** Provide language-aware editing using the CM6 language packages (D9).

**Files:**
- Create: `src/languages/registry.ts` ✅ (the catalogue: 140 languages, detection, resolution)
- Create: `src/languages/legacy-modes.generated.ts` ✅ *(added — the 145 lazy loaders, generated
  from the installed package by `scripts/gen-language-registry.mjs`, which fails if any parser
  the package exports is unaccounted for)*
- Create: `src/languages/highlight.ts` ✅ *(added — N++'s token colours as a `HighlightStyle`,
  each colour cited to the lexer in `stylers.model.xml` it comes from)*
- Create: `src/editor/overview-ruler.ts` ✅ *(added — the ruler: fold regions, marks, bookmarks,
  the viewport band, and click/drag scrolling)*
- Modify: `src/editor/notepadpp-config.ts` ✅ (`syntaxHighlighting`, `languageCompartment`,
  `codeFolding()`, the ruler, six more `DEVIATIONS_FROM_NPP` entries)
- Modify: `src/editor/workspace.ts`, `src/editor/tabs.ts` ✅ (language per document, the async
  load, the status-bar field, fold reconciliation across panes)
- Modify: `vite.config.ts` ✅ *(the `manualChunks` trap below)*, `tsconfig.json` ✅
- Create: `scripts/test-languages.mjs` ✅ (238 checks in Node: every loader, every detection rule)
- Create: `scripts/verify-task6.py` ✅ (S2 acceptance check, 67 checks in real Chrome)

**Steps:**
1. Register supported languages per **D9**. ✅ **140 languages**: 27 first-class rows over the 22
   packages (`lang-javascript` alone covers JavaScript/JSX/TypeScript/TSX, `lang-cpp` covers N++'s
   separate C and C++, `lang-sql` covers SQL and mssql) plus 113 legacy parsers. The package
   exports 152 parsers; 32 are superseded by a first-class grammar and 7 are factories or a
   keyword list — every one of the 152 is accounted for, and the generator fails if that stops
   being true. **C# is confirmed**: `clike.js` exports `csharp` (a real StreamLanguage), which
   closes the ledger's open question; Kotlin, Scala and Objective-C come from the same file.
   makefile / batch / INI remain genuinely absent — **not hand-written**, as the plan allowed.
2. Implement language detection by content and extension. ✅ Extension first, then the exact file
   name (a deliberate addition — N++ decides by extension alone), then N++'s own
   `FileManager::detectLanguageFromTextBeginning` ported line by line (BOM skip, whitespace skip,
   the 40-character window, the first-line cut, the six-entry shebang table in N++'s order with
   its substring semantics, and the ordered first-line patterns with `<?` last).
3. Add the overview ruler as the language-aware navigation aid. ✅ Recorded as **S8**: N++ has no
   such element (its Document Map is Tier 2/3 and unscheduled), so the shape is this port's
   decision. Structure ticks come from the language's own fold regions, so a first-class grammar
   shows a document's skeleton and a legacy stream mode shows none — the D9 trade-off, visible.

**Note:** the **Document Map / minimap is not in this task.** It is Tier 2/3 with no MVP promise
(`docs/editor-core-decision.md` B1); a canvas minimap is part of the D10 large-file/phase-3 work.

**Verification:** Open `.js`, `.py`, `.html`, `.md` files; confirm highlighting and the overview
ruler update correctly. ✅ `python3 scripts/verify-task6.py` → **PASS (67/67)**: the four files are
opened through the real File ▸ Open path (only the OS dialog is stubbed, with OPFS handles), and
each one's tokens are read back as **computed colour on rendered spans** — `def` `#0000ff` bold,
comments `#008000`, strings `#808080`, numbers `#ff8000`, operators `#000080` bold, tags
`#0000ff`, attributes `#ff0000`, markdown headings `#ff8000` bold — and the ruler's ticks are read
back from its **canvas pixels**. Over a 10 000-line JavaScript file the structure walk produces
its 2000-tick cap in **8.5 ms**.

**Outcome:** Complete. `python3 scripts/test-languages.mjs` (via
`node --experimental-strip-types`) → **238/238**; `scripts/gen-language-registry.mjs --check` →
all 152 parsers accounted for. Bundle: `editor-core` **335.24 kB / 109.13 kB gzip** plus **129
lazy chunks**, down from a **naive 1 591.85 kB / 565.20 kB gzip** — see the trap below. Fold state
now crosses the panes (Task 3's carried-forward item), the language sits in the status bar where
N++ puts it (part 0, leftmost), and six new `DEVIATIONS_FROM_NPP` entries record what is not
Notepad++'s: the ruler, the missing Language menu, the absent modes, the no-fold contract for
legacy modes, `.vue`/`.jsx`, and file-name detection.

**The trap worth keeping (`S3`'s cousin):** `vite.config.ts`'s `manualChunks` put **every**
`@codemirror/*` module into `editor-core`, and `manualChunks` wins over code splitting — so 140
lazily-imported languages all landed in the first load and the build output was the only place it
showed. The function now exempts `@codemirror/lang-*` and `@codemirror/legacy-modes/*`, and both
numbers are recorded here because the failure is silent.

---

### Task 7: Add session persistence and preferences — ✅ DONE (2026-10-11)

**Objective:** Maintain session state across reloads without backend.

**Files:**
- Create: `src/storage/idb.ts` *(added — one database, one version, one upgrade path; Task 4's
  `recent-files.ts` was moved onto it so a profile written then upgrades in place)*
- Create: `src/storage/session-store.ts`
- Create: `src/storage/preferences.ts`
- Create: `src/storage/backup-store.ts` *(added — N++'s `backup/` directory, on OPFS: D8's
  document-body half, which Task 7 is the task that builds)*
- Create: `src/storage/persistent-storage.ts` *(added — risk R6's recorded mitigation,
  `navigator.storage.persist()`, reported rather than assumed)*
- Create: `src/editor/preferences-dialog.ts` *(added — Settings ▸ Preferences…)*
- Create: `docs/session-persistence.md` *(added — N++'s `session.xml`, `backup/` algorithm and
  `config.xml` keys quoted, with the browser mapping and every deviation)*
- Modify: `src/editor/workspace.ts`, `src/editor/notepadpp-config.ts`, `src/editor/tabs.ts`,
  `src/editor/chrome.ts`, `src/editor/overview-ruler.ts`, `src/style.css`, `src/file/recent-files.ts`

**Steps:**
1. Save open tabs, caret positions and scroll positions in IndexedDB. ✅ The record is N++'s own
   shape — `Session activeView` + `mainView.activeIndex`, and per file `filename`, `lang`,
   `encoding`, `startPos`/`endPos`/`selMode`, `firstVisibleLine`/`xOffset`, `wrapCount`-carrying wrap,
   `userReadOnly`, `backupFilePath`, `originalFileLastModifTimestamp` — plus N++'s `<Mark>` and
   `<Fold>` children, so bookmarks (Task 5) and folds (Task 6) come back. Written 500 ms after a
   change and immediately on a tab switch, a close, `visibilitychange` → hidden and `pagehide`;
   N++ writes once on the way out, and a page cannot count on being told it is going away.
2. Persist UI preferences: theme, font size, word wrap, toolbar layout. ✅ As N++ persists them:
   `RememberLastSession` and `KeepSessionAbsentFileEntries` (`Parameters.h:755-756`), the snapshot
   mode and its `snapshotBackupTiming` (`Parameters.h:867-869`, 7000 ms), the toolbar's
   `visible`/layout node (`Parameters.cpp:6046`), the theme name, and **zoom** in points
   (`ScintillaViewParams zoom`, `Parameters.cpp:7288`) — which is what "font size" is in N++:
   Scintilla's zoom is an increment on the style's own 10 pt. Word wrap stays where N++ keeps it,
   per document, and it is therefore persisted with the document rather than as a global preference.
3. Implement restore on startup. ✅ N++'s `loadSession` order: preferences first (they gate
   everything), then each file planned *before* anything opens — the backup body if there is one,
   otherwise the file, with the two questions N++ asks (inaccessible files → read-only placeholders;
   "This file has been modified by another program" → reload or keep the snapshot) — then the active
   tab, then the split, then the session is rewritten from what actually opened and orphaned backups
   are pruned.
4. *(not in the plan, required by it)* **Keep unsaved work across a reload at all.** A body has to be
   written somewhere or "restore on startup" cannot restore an untitled buffer: N++'s `backup/`
   directory and its documented sync rules (`Buffer.cpp:1231-1272`) are implemented on OPFS, with
   N++'s own file naming (`FILENAME@YYYY-MM-DD_HHMMSS`).

**Verification:** Reload app after editing; confirm tabs and positions restore. ✅
`python3 scripts/verify-task7.py` → **PASS (82/82)**, twice, everything asserted **after a real
`page.reload()`** (which throws away every in-page stub, so only stored state can survive it): the
Preferences dialog (Cancel applies nothing, OK applies and persists, and the effects are visible —
toolbar hidden, 12 pt text), View ▸ Zoom, an unsaved scratch buffer returning dirty with its caret
and its bookmark, a CRLF+BOM file returning dirty from its backup and saving back **byte-identical**
(`EF BB BF` + `one\r\ntwo\r\nTHREE`), N++'s both modified-file answers, folds/bookmarks/wrap/split/
language restored (folds as *rendered* `.cm-foldPlaceholder`s, not just counters), an inaccessible
file dropped or offered as a read-only placeholder that refuses typing, and unsaved work that cannot
be restored reported **by name** with snapshot mode off. `node --experimental-strip-types
scripts/test-session.mjs` → **PASS (75/75)** — the storage logic in Node, where neither IndexedDB nor
OPFS exists: N++'s backup naming, the preference defaults and ranges, the restore decision table, the
line↔offset conversions, and the fail-soft contract.

**Outcome:** Complete. The session, the backups and the preferences are described in
`docs/session-persistence.md`; the app's own list of what is *not* N++'s is nine new
`DEVIATIONS_FROM_NPP` entries (browser storage instead of `%APPDATA%`, a reload is not a close, the
settings N++ has that this port does not, the single-value theme, unbound zoom keys, the icon-set-free
toolbar value, always-activate-instead-of-duplicate, and the clone pane's own caret). Bundle:
`editor-core` **335.26 kB / 109.14 kB gzip** across **129 chunks** — *unchanged* from Task 6
(335.24 / 109.13), because the storage layer, the preferences dialog and the ruler's mount-time walk
all land in the app's own chunk, which is now `index` **113.19 kB / 34.55 kB gzip**. That is the
lazy-loading trade still holding: 140 languages cost nothing until a file is opened.

**Four defects this task found and fixed — all of them pre-existing, none of them introduced here:**
1. **The split erased folds** (and could erase bookmarks). `#mirrorFolds`/`#mirrorBookmarks` compared
   *states*: a freshly mounted clone legitimately starts empty, so its first transaction — the
   mount-time handover, or a bookmark copy — read as "the document has no folds" and cleared the
   other pane's. They now compare *changes* (a per-view signature), which is the same rule the rest
   of the app uses.
2. **A restored document lost its grammar.** `#loadLanguage` reconfigures the views that exist when
   its import resolves, and during a restore none exist yet, so the extension went nowhere: no
   highlighting and, because `foldable()` needs a grammar, no folds. The restore now awaits the
   grammar and puts it in the state when the document is created.
3. **The overview ruler showed no structure for a view mounted on an already-parsed state** — Task
   6's own check caught it, for the re-activated-document case. The plugin walks the tree at
   construction now, capped by `STRUCTURE_LIMIT` (measured at 8.5 ms for a 10 000-line file).
4. **A document id could repeat.** Ids were `d{documents.length+1}-{newNumber}`, which is not unique
   when a document is *removed* — the welcome buffer a restore discards, or any closed tab — and the
   `new N` counter does not move when a file is opened. The collision made `#show()` return early:
   the file opened and never came to the front. One monotonic counter now.

**Also changed for the same reason** (recorded because a later task will read these scripts):
`verify-task4.py`'s recent-file wait moved from "documents > 1" to "the expected file is active",
because a session restore satisfies the old proxy by itself; `verify-task5.py`'s menu assertion
became membership rather than an exact list (Task 7 adds Settings); and
`verify-task4-pickers.py` learned to *verify* the path it types into the real OS dialog before
pressing Return, having spent an afternoon being blamed for opening the wrong file.

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
- `src/languages/registry.ts` *(Task 6)*
- `src/languages/legacy-modes.generated.ts` *(Task 6 — generated)*
- `src/languages/highlight.ts` *(Task 6)*
- `src/editor/overview-ruler.ts` *(Task 6)*
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

Plan complete and saved. Tasks 1–7 are done; Task 8 (installable, offline-capable web app) is the
next unit of work and is ungated — see `PROGRESS.md` for the live next action.

**One item from Task 6 is deliberately open**, for Task 7 to pick up or leave: `src/languages/`
names a language for every file it can, but there is still **no Language menu**, so a scratch
buffer or an extension nothing claims (makefile, batch, INI) cannot be told what it is. N++ has
that menu; this port does not yet.
