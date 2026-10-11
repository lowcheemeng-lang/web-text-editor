# Progress Ledger — Notepad++ Web Edition

**This file is the single source of truth for project state.**
The plan is the *spec*; this ledger is the *state*. Keep them separate.

| Artifact | Role | Owner |
|---|---|---|
| `PROGRESS.md` (this file) | Current status, next action, decisions, session log | Updated at the **end of every work session** |
| `.hermes/plans/2026-09-24_notepadpp-web-plan.md` | Task specs (what to build, file paths, verification) | Edited only when the plan genuinely changes |
| `docs/scope.md` | Locked scope + browser compatibility matrix | Edited when a decision is *reversed* |
| `docs/editor-core-decision.md` | D2 evidence: CodeMirror 6 vs Monaco, sourced | Settled 2026-09-25 |
| `scripts/status.mjs` | Progress reporter — `npm run status` | — |
| `scripts/verify-task<N>.py` | Executable acceptance check for a task | — |

---

## Session start protocol

A new session (human or agent) needs zero prior context if it reads these files **in this order**:

1. `PROGRESS.md` — where we are, what is next (this file)
2. `docs/scope.md` — what is in scope, what is impossible, decisions D1–D11
3. `docs/editor-core-decision.md` — the D2 analysis (only if touching the editor core)
4. `.hermes/plans/2026-09-24_notepadpp-web-plan.md` — the task-by-task spec

**Verify state before trusting it:** `npm run status`

**Copy-paste prompt for a new Hermes session:**

> Read `PROGRESS.md` in `/home/lowcheemeng/dev/web-text-editor`, then do the "Next action"
> it records. Follow the conventions in the ledger: one task at a time, record evidence,
> commit as `task-N: <summary>`, and update `PROGRESS.md` before you finish.

---

## Status board

| # | Task | Status | Evidence | Commit |
|---|------|--------|----------|--------|
| 1 | Define scope & compatibility matrix | DONE | `docs/scope.md` — 3 tiers, capability matrix, encoding matrix, R1–R8 risks; all claims sourced | `1b5bcd4` |
| 2 | Initialize project scaffold | DONE | `npm run typecheck` → exit 0; `npm run build` → exit 0, editor-core **382.37 kB / 123.08 kB gz**; `python3 scripts/verify-task2.py` → **PASS** (HTTP 200, 1 CM6 instance, 15 lines, typing verified, 0 console errors) | `26aaea6` |
| 3 | Editor core with N++ defaults | DONE | `python3 scripts/verify-task3.py` → **PASS (56/56)**; `python3 scripts/spike-r2-split.py` → **R2_SPIKE: PASS** (12/12); `npm run typecheck` → exit 0; `npm run build` → exit 0, editor-core **296.81 kB / 96.16 kB gz** (down from 382.37 kB — `basicSetup` carried autocompletion/search that Tasks 5–6 own) | `1c548ae` |
| 4 | File operations without backend | DONE | `python3 scripts/verify-task4-pickers.py` → **PASS (43/43)** re-run on **2026-10-11** at Task 7's HEAD (and 42/42 twice on 2026-10-10) — the script now wipes its own Chrome profile and asserts a clean start, because Task 7's session restore otherwise changes the state its assertions assume; see the session log. The **real** OS file chooser, driven end to end: headed Chrome under Xvfb, the GTK dialog screenshotted and driven by xdotool, real files in `/tmp` opened, edited and saved, md5 compared on disk. Includes the write that the manual checklist existed to prove: Chrome's "Save changes to …?" permission prompt is answered, and the save is confirmed by the file's inode/mtime moving rather than by "no error appeared". `python3 scripts/verify-task4.py` → **PASS (44/44)** — OPFS-stubbed pickers, byte-level (CRLF+BOM and windows-1252 round trips, UTF-32 refusal, cancel-is-not-an-error, Save As, recent files surviving a page reload, unsupported-browser notice); `node --experimental-strip-types scripts/test-file-io.mjs` → **PASS (45/45)**; `python3 scripts/verify-task3.py` → **PASS (58/58)**; `python3 scripts/spike-r2-split.py` → **R2_SPIKE: PASS**; `npm run typecheck` → exit 0; `npm run build` → exit 0, editor-core **296.81 kB / 96.16 kB gz** | `f79477c` · `e0a74c3` |
| 5 | Search, replace, navigation | DONE | `python3 scripts/verify-task5.py` → **PASS (105/105)**, twice in a row — N++'s Search dialog driven through its own controls (Normal / Extended / Regular-expression modes, Match case, Match whole word only, Wrap around, Backward direction, In selection, and N++'s per-mode gating of them), find next/previous with wrap-around and N++'s own status wording, Count, Mark All, Clear all marks, Replace and Replace All (`$1` back-references, `\t` in a replacement), Go To (line and offset) and the bookmark family (Ctrl+F2 / F2 / Shift+F2 / Clear All Bookmarks / the margin toggle). Over a **10 000-line** document: regex Count **2.4 ms**, Mark All **4.8 ms**, Replace All **46.5 ms**; `no request left the machine (D1)` green. `python3 scripts/probe-reserved-keys.py` → the keymap measurement behind decision **S6**. Regressions at HEAD: `verify-task3.py` → **PASS (58/58)**; `verify-task4.py` → **PASS (44/44)**; `verify-task4-pickers.py` → **PASS (42/42)**; `test-file-io.mjs` → **PASS (45/45)**; `spike-r2-split.py` → **R2_SPIKE: PASS**; `npm run typecheck` → exit 0; `npm run build` → exit 0, editor-core **305.27 kB / 98.72 kB gz** (was 296.81 / 96.16 — `@codemirror/search` 6.7.2) | `d22f0d8` |
| 6 | Syntax highlighting & language modes | DONE | **`python3 scripts/verify-task6.py` → PASS (67/67)** — `.js`, `.py`, `.html`, `.md` (plus `.cs`, `Dockerfile`, a shebang file and two of D9's gaps) opened through the real File ▸ Open path against OPFS handles, with every token read back as **computed colour on rendered spans** and every ruler tick read back from **canvas pixels**. `node --experimental-strip-types scripts/test-languages.mjs` → **PASS (238/238)** — all **140** loaders resolve in Node (`27` first-class + `113` legacy), every detection rule, the named extension collisions, and the gaps. `node --experimental-strip-types scripts/gen-language-registry.mjs --check` → **152 of 152** parsers the package exports are accounted for (113 catalogued, 32 superseded by a first-class grammar, 7 not languages). Over a 10 000-line JavaScript file the ruler's structure walk returns its **2000-tick** cap in **8.5 ms**. Regressions at HEAD: `verify-task5.py` → **PASS (105/105)**; `verify-task4.py` → **PASS (44/44)**; `verify-task4-pickers.py` → **PASS (42/42)**, real OS chooser included; `verify-task3.py` → **PASS (58/58)**; `test-file-io.mjs` → **PASS (45/45)**; `spike-r2-split.py` → **R2_SPIKE: PASS**; `npm run typecheck` → exit 0; `npm run build` → exit 0, `editor-core` **335.24 kB / 109.13 kB gz** across **129 chunks** (was 305.27 / 98.72 — the ruler, the highlight style and the registry; a naive `manualChunks` would have made it **1 591.85 kB / 565.20 kB gz**, see S3's cousin in the plan) | `c4e3c9e` |
| 7 | Session persistence & preferences | DONE | **`python3 scripts/verify-task7.py` → PASS (82/82)**, twice, every assertion made **after a real `page.reload()`** — the reload discards every in-page stub, so only stored state survives it: the Preferences dialog (Cancel applies nothing; OK stores, applies and persists — toolbar hidden, 12 pt text), View ▸ Zoom, an unsaved scratch buffer returning dirty with its caret and its bookmark, a CRLF+BOM file returning dirty from its `backup/` body and saving back **byte-identical** (`EF BB BF` + `one\r\ntwo\r\nTHREE`), N++'s both modified-file answers, folds/bookmarks/wrap/split/language restored (folds as *rendered* fold placeholders, in both panes), a file deleted behind the app dropped or offered as a read-only placeholder that refuses typing, and unsaved work that cannot be restored reported **by name** with snapshot mode off. `node --experimental-strip-types scripts/test-session.mjs` → **PASS (75/75)** — the storage logic in Node, where neither IndexedDB nor OPFS exists: N++'s `FILENAME@YYYY-MM-DD_HHMMSS` naming, the preference defaults and ranges, the restore decision table, the line↔offset conversions, and the fail-soft contract. Regressions at HEAD: `verify-task6.py` → **PASS (67/67)**; `verify-task5.py` → **PASS (105/105)**; `verify-task4.py` → **PASS (44/44)**; `verify-task3.py` → **PASS (58/58)**; `test-file-io.mjs` → **PASS (45/45)**; `test-languages.mjs` → **PASS (238/238)**; `gen-language-registry.mjs --check` → **OK**; `spike-r2-split.py` → **R2_SPIKE: PASS**; `npm run typecheck` → exit 0; `npm run build` → exit 0, `editor-core` **335.26 kB / 109.14 kB gz** across **129 chunks** (unchanged from Task 6 — the storage layer, the dialog and the ruler fix all land in the app's own chunk, now `index` **113.19 kB / 34.55 kB gz**). **`scripts/verify-task4-pickers.py` → PASS (43/43)** at the same HEAD — Task 4's real-chooser check, re-run because Task 7's restore changes the state it starts from. Three runs failed first (`36/39`), all three on one check, and they shared a cause worth knowing: a **stale session in the Chrome profile** (each run's own Chrome rewrites the profile while shutting down, after the profile had been wiped for the next run), so the app restored a previous run's documents and the check asserted a *fresh* open's fact about a *restored* document. The script wipes its own profile now and asserts the clean start as a check; the runs also turned up a real defect — `RestoreState.assumedEncoding` was built and never read, so a restored windows-1252 document reported an identified encoding to `inspect()` and the status bar (measured: `assumedEncoding: false` on the restored document, `true` after the fix) — now fixed (`c98188a`) and verified through a reload. | `f829697` · fix `c98188a` |
| 8 | PWA / offline packaging | TODO | - | - |

**Status vocabulary:** `TODO` · `WIP` · `DONE` · `BLOCKED` · `DEFERRED`

**Rule — the only way a task becomes `DONE`:** the Evidence cell contains something
*reproducible*, not a description. A command plus its observed result, a file path plus the
check that it passes, or a measured number. "Implemented X" is not evidence. "`npm test` →
43 passed" is. Where verification needs a browser, it lives in `scripts/` so it can be re-run.

## Next action

**Task 7 is DONE (2026-10-11).** Its acceptance check needs nothing but the dev server:
`python3 scripts/verify-task7.py` → **PASS (82/82**, twice), and
`node --experimental-strip-types scripts/test-session.mjs` → **PASS (75/75)** for the storage logic
without a browser. The design — N++'s `session.xml`, its `backup/` algorithm and its `config.xml`
keys, with the browser mapping and every deviation — is written up in
`docs/session-persistence.md`, and the app's own list of what is *not* Notepad++'s is in
`DEVIATIONS_FROM_NPP` (nine new entries).

**Then: Task 8 — wrap as an installable, offline-capable web app** (`public/manifest.webmanifest`,
`vite.config.ts`, optional single-file bundle), which is ungated:

1. The manifest and a service worker for the app shell. `base: "./"` and relative asset URLs are
   already in place from Task 2, so a cache-first worker is a small change — but the shell is **129
   chunks** and the 140 languages are lazy, so the worker has to decide what "offline" means for a
   language that was never opened: precache the shell and the languages that *were* opened at
   runtime, and say in the ledger which of the two it does.
2. Optionally bundle one portable HTML file (the plan's step 2) — worth measuring against the 129
   chunks rather than assuming.
3. Verify the offline path: load once, disable the network, reload, and confirm the editor mounts and
   works. Two things from Task 7 worth asserting there because offline is the first load that cannot
   fall back to the network: the session restore must work with no network at all (it does — nothing
   here fetches — but that is the place to prove it), and `navigator.storage.persist()`'s answer is
   worth re-reading, since an installed PWA is one of the signals Chrome uses to grant it.

**Two things Task 7 deliberately left open**, both named in `DEVIATIONS_FROM_NPP` rather than
papered over:

- **No Language menu** (carried from Task 6, still unbuilt). Everything a menu needs is verified —
  `languagesByName()`, `Workspace.setLanguage(id)`, `inspect().language` — and the session already
  stores the language per document, so a language *chosen* from such a menu now survives a reload.
- **No Dark Mode.** The theme is stored, applied and threaded through `PALETTES`/`THEMES`, and its
  only value is N++'s light palette. The dark skin (its token palette and chrome colours) is a
  Tier-1 row in `docs/scope.md` that no task has claimed.

**And one thing needs the user, not a task: `D12` (mobile/tablet) is filed as a proposal in
`docs/scope.md` §3** — recommendation: out of scope for the MVP, with the S4 notice, because a mobile
browser evicts origin storage in a way that makes Task 7's promise ("your unsaved work is still
there") one this port cannot honestly keep. It needs a yes or a no; nothing is blocked on it.

### Scope settled at sign-off (2026-09-25)

| Area | Ruling | Effect on the remaining tasks |
|---|---|---|
| Editor core | **D2 accepted** — CodeMirror 6 | Task 3 can name CM6 explicitly |
| Run/exec, native plugins | **D7 accepted** — permanently out | Nothing to build; keeps the impossible-list closed |
| Phase-3 priority | **D10 accepted** — encoding fidelity (WASM) + large-file mode; UDL below it | Does not affect Tasks 3–8; defines what comes after |
| Browser scope | **D11 accepted** — Chromium only for the MVP | Task 4 builds Tier A only; §7 tier B/C I/O moves to phase 2 (risk R8) |

### Dev/verification environment (learned in Task 2)

- Dev server: `npm run dev` → `http://127.0.0.1:5173` (bound to loopback only, by design).
- **Browser verification uses `scripts/verify-task*.py`** (system Chrome via Python Playwright).
  The `browser_exec` tool **cannot reach loopback addresses in this environment** — it returns
  `ERR_CONNECTION_REFUSED` for `127.0.0.1` while `curl` gets HTTP 200 in the same moment.
- Screenshots go to `.hermes/cache/screenshots/` (git-ignored): no binaries in git history.
- **`scripts/verify-task7.py`** (Task 7) drives the session and the preferences the same way — a real page,
  real reloads — and stubs the pickers with OPFS handles exactly as `verify-task4.py` does. Almost every
  assertion is made **after a `page.reload()`**, which is the point: a reload discards every in-page stub
  and every queued timer, so only genuinely stored state can survive it.
- One check needs more than Chrome: `scripts/verify-task4-pickers.py` drives a **real** OS file
  chooser, so it needs `Xvfb`, `xdotool`, `ffmpeg` (x11grab), `tesseract` and `dbus-run-session`.
  It starts its own Xvfb on `:99` and never touches the desktop; run it with `npm run dev` up. It also
  **wipes its own Chrome profile before each run** (`.hermes/cache/scratch/task4-pickers/chrome-profile`)
  and asserts a clean start: Task 7's session restore would otherwise hand the checks a state their
  assertions do not describe — a lesson the first three runs of the day taught, at 7 minutes each.
- **Three checks run in Node, with no browser at all** (they need
  `node --experimental-strip-types`, because they import the `.ts` sources directly):
  `scripts/test-languages.mjs` (all 140 language loaders + every detection rule) and
  `scripts/gen-language-registry.mjs --check` (the generated mode table vs the installed
  package). `scripts/test-file-io.mjs` and `scripts/test-session.mjs` (Task 7: N++'s backup naming, the preference
  defaults and ranges, the restore decision table, the line↔offset conversions, and the fail-soft
  contract — Node has neither IndexedDB nor OPFS, which is exactly that contract's condition) complete
  the set. The storage modules import with explicit `.ts` extensions so Node follows the same graph the
  browser runs, rather than a copy of it that can drift.
- **Use `npm run typecheck`, or `./node_modules/.bin/tsc`, not `npx tsc`** — in this environment
  `npx` stalls resolving the local binary (measured: a bare `npx tsc --noEmit` hung past a
  7-minute timeout while the local binary finished in 0.2 s).

## Conventions

- **One task per session** where practical. Finish it, verify it, record it.
- **Commit format:** `task-N: <summary>` (e.g. `task-2: scaffold vite + typescript`). `git log --oneline` is then a second, tamper-evident progress ledger.
- **Branch:** `master` (solo project, no PR flow needed yet). Switch to feature branches if collaborators join.
- **Evidence before status:** update the board in the same session as the work, never later from memory.
- **Never edit a `DONE` row's evidence** to make a later failure go away — add a new session-log entry instead.
- **Decisions get an ID** (`D1`–`D11` in scope, `S1`+ below). Reference the ID in commit messages and code comments so the "why" survives.
- **Decision statuses:** `Proposed` → `Accepted` (user said yes) or `Rejected` (user said no). Only the user moves a `D*` from Proposed to Accepted.
- **`S`-decisions are the agent's to make** and may be revised by a later `S`-decision; `D`-decisions may not.

## Decision log

| ID | Date | Decision | Rationale | Status |
|----|------|----------|-----------|--------|
| D1 | 2026-09-25 | Browser-first SPA/PWA; desktop wrapper deferred | Reuses same bundle later; not a one-way door | Proposed |
| D2 | 2026-09-25 | CodeMirror 6 as the editor core | Analysis in `docs/editor-core-decision.md`: 1.26 MB gz vs 5.01 MB; mobile supported vs officially unsupported; CSS theming for an N++ look; independent per-tab configs; native plugin-composition; viewport rendering for big files. Monaco's only wins here are built-in minimap + diff editor (both Tier 3, both substitutable) | **Accepted — user-confirmed 2026-09-25** |
| D3 | 2026-09-25 | Two-tier file I/O, feature-detected | Pickers are Chromium-only; Mozilla position on them is *harmful* | **Accepted — user-confirmed 2026-10-06:** MVP ships **Tier A only** (FS Access pickers, real in-place save); non-Chromium gets the explicit "not supported yet" message (S4); tier B/C I/O stays phase 2 |
| D4 | 2026-09-25 | Encoding: WHATWG label set only in MVP; UTF-32/DOS codepages via WASM | Encoding API's label list is fixed | **Accepted — user-confirmed 2026-10-06:** what the browser gives natively is enough for the MVP; UTF-32, DOS codepages and autodetect are **refused with an explicit warning** until the phase-3 WASM work (D10). Round-trip fidelity is the standing rule |
| D5 | 2026-09-25 | Plugins = runtime-loaded ES modules + WASM, no native ABI | Only backend-free option | Proposed |
| D6 | 2026-09-25 | Macros = editor transaction record/replay, not OS input replay | CM6 exposes every change as a transaction, so record/replay/run-N-times works without native hooks (N++'s macro playback is OS-input based and cannot be emulated literally) | **Accepted — user-confirmed 2026-10-06** |
| D7 | 2026-09-25 | Run/exec + native plugins permanently out of scope | Impossible without a process/shell | **Accepted — user-confirmed 2026-09-25** |
| D8 | 2026-09-25 | OPFS for documents, IndexedDB for metadata/prefs | OPFS is Baseline cross-browser since March 2023 | **Half in use, still `Proposed`:** the user directed Task 4's recent files to be implemented, which exercises the *IndexedDB-for-metadata-and-handles* half (`src/file/recent-files.ts`). The OPFS-for-document-bodies half belongs to Task 7 and is unbuilt. Only the user may move this to `Accepted` |
| D9 | 2026-09-25 (proposal refined 2026-10-06) | MVP language set: **all 22 official CM6 packages + all 103 legacy-modes ports**, lazily loaded per file; UDL stays Tier 3 | Counted and verified 2026-10-06: all 22 official `@codemirror/lang-*` packages and `legacy-modes@6.5.4` / `language-data@6.5.2` install from npm; the original "~20" was a guess. Lazily loaded per language, so extra languages cost 0 bytes until opened. Gaps vs N++: makefile, batch, INI, Kotlin, Scala, GraphQL, Objective-C, MATLAB (+ C# unconfirmed) | **Accepted — user-confirmed 2026-10-06** (proposal filed in `7e1de3a`). **D10 ranks UDL below encoding/large-file**; the MVP language set is unaffected. Gates Task 6 |
| D10 | 2026-09-25 | Phase-3 priority: encoding fidelity (WASM for UTF-32/DOS codepages) + large-file mode. UDL parity ranks below it and stays unscheduled | Correctness beats breadth — a mis-decoded legacy file or a stalled editor is silent data loss or a hard block (R1, R3, B7); UDL is a visible missing feature with a documented workaround | **Accepted — user-confirmed 2026-09-25** |
| D11 | 2026-09-25 | MVP browser scope: **Chromium only** (Chrome/Edge/Opera). Firefox/Safari tier B/C fallback UX moves to phase 2; §8 acceptance is Chrome-only | User decision. Keeps the MVP on the single File System Access path; halves the file-I/O test matrix | **Accepted — user-confirmed 2026-09-25** |
| S0 | 2026-09-25 | Progress tracked in this ledger + `scripts/status.mjs`, not in chat history | Chat transcripts do not survive into new sessions; a repo file does | Accepted |
| S1 | 2026-09-25 | Scope doc is the authority for scope; plan for task sequencing; **this ledger for status** | Prevents drift between three files that could each claim to know the state | Accepted |
| S2 | 2026-09-25 | Each browser-verified task ships an executable check in `scripts/` | A prose "verified" claim cannot be re-checked by the next session; a script can | Accepted |
| S3 | 2026-09-25 | `manualChunks` in `vite.config.ts` must stay in **function** form | Vite 8 bundles with Rolldown, which dropped the Rollup object form; the object form fails to type-check | Accepted |
| S4 | 2026-09-25 | Task 4 ships a **thin capability check** (`src/platform/capabilities.ts`) that reports an unsupported browser instead of throwing; the full tier B/C implementation stays phase 2 | D11 defers non-Chromium support; a 10-line guard keeps the deferral honest and gives phase 2 a seam to plug into (mitigates R8) | Accepted |
| S5 | 2026-10-06 | Split view shows the **active document** in two panes — Notepad++'s *clone to other view*. Notepad++'s other flavour, each pane carrying its own independent tab set, stays Tier 2 / phase 2 | R2 proved the plan's wording wrong in a load-bearing way: two views on one `EditorState` do not diverge *loudly*, they diverge silently. Two states plus annotation forwarding gives one document, one undo history, per-view caret and scroll (`docs/r2-shared-state-spike.md`). Per-pane tab membership would add a second tab strip with no document behind it and change nothing Task 3 verifies | Accepted |
| S6 | 2026-10-10 | **Find is `Alt+F`**; every other search key keeps N++'s binding (Ctrl+H, Ctrl+G, Ctrl+M, F3, Shift+F3, Ctrl+F2, F2, Shift+F2) | Measured, not assumed: `scripts/probe-reserved-keys.py` drives a headed Chrome under Xvfb with real X input and shows the page never receives Ctrl+F while Chrome's find bar opens anyway (`preventDefault` cannot suppress it), whereas the other seven do reach the page and *are* suppressible. Same instrument and same rule as the Ctrl+N/O/S/W substitutions of Task 4 | Accepted |
| S7 | 2026-10-10 | Search marks and bookmarks live in **per-view state** (`StateField`), and `workspace.ts` reconciles the views of one document — a clone copies them at mount, and bookmark changes are mirrored to the peers | The split dispatcher forwards document *changes* only. Without the reconciliation a bookmark set in the clone's margin would be invisible in the primary pane and silently lost when the split closed, because a clone's state is rebuilt on every mount | Accepted |
| S8 | 2026-10-11 | The **overview ruler** is a per-view 13 px strip on the pane's right edge: structure ticks from the language's own fold regions (`foldNodeProp`), search marks in N++'s Mark Style 1, bookmarks in N++'s bookmark colour, a viewport band, and click/drag to scroll — **never** moving the caret. **Not a Notepad++ element.** | The plan's Task 6 step 3 asks for "the overview ruler as the language-aware navigation aid" and names no shape; N++ has nothing like it (its Document Map is a minimap, Tier 2/3, unscheduled). Rejected alternatives: the minimap itself (out of scope, D10 phase 3), and per-line `foldable()` calls for the structure (a `foldNodeProp` tree walk is O(nodes), measured at **8.5 ms for a 10 000-line file**, and returns the same fold regions the gutter shows). The language-awareness is real and also shows D9's trade-off in public: a Lezer grammar has fold regions, a legacy `StreamLanguage` has none, so the skeleton appears only for the 27 first-class languages. Capped at 2000 ticks — beyond that the strip is a solid block | Accepted |
| S9 | 2026-10-11 | A contested file extension is resolved by the **order of `LANGUAGES`** (first-class rows first, then the legacy table in N++-name order); the collisions are named and asserted in `scripts/test-languages.mjs` rather than left to chance | N++ resolves the same collisions by walking its own language table *backwards* (`Parameters.cpp:4464`), which is an accident of its enum order and not something a port can copy without copying the enum. The collisions are few and real (`.m` MATLAB vs Objective-C, `.s` R vs GNU assembly, `.pp` Pascal vs Puppet, `.mm` Objective-C, `.pyx` Python vs Cython), and each one's winner is now a test | Accepted |
| S10 | 2026-10-11 | **Task 7's persistence is N++'s own material, not an invention of this port:** the session record carries `session.xml`'s fields, the bodies of unsaved documents go to N++'s `backup/` directory implemented on OPFS with its own `FILENAME@YYYY-MM-DD_HHMMSS` names and its documented sync rules (`Buffer.cpp:1231-1272`), and the preferences are `config.xml`'s session, toolbar and zoom keys — in one IndexedDB database for the metadata (D8's half) plus OPFS for the bodies (D8's other half). | The task's own spec is three sentences ("save tabs, caret and scroll in IndexedDB; persist preferences; restore on startup"), and every question those sentences raise — what to store, when to write it, what to ask on the way back, what to do with a document whose file is gone — N++ has already answered, in code with line numbers attached. Where the browser cannot match the original (a page has no `%APPDATA%`, cannot ask before a reload, cannot be given a folder to write into) the difference is recorded in `DEVIATIONS_FROM_NPP` and `docs/session-persistence.md` rather than improvised. | Accepted |
| S11 | 2026-10-11 | The split's reconciliation mirrors compare **changes, not states**: a view tells its peers only when the folds or bookmarks *it* holds moved since the last transaction it was asked about, tracked as a per-view signature (`#foldSignatures`, `#bookmarkSignatures`). | A freshly mounted clone legitimately starts empty, so comparing states made the clone's first transaction read as "the document has no folds" and clear the fold in the other pane — silently, and only when the document had a fold *and* the clone had a reason to dispatch before the mount-time handover. Task 7's `verify-task7.py` covers the sequence that exposed it (bookmark, fold, then open the split), and the fix is the same rule the rest of the app follows: propagate what changed. | Accepted |

## Session log

### 2026-09-25 — Session 1 (WebUI)

**Done**
- Plan written: `.hermes/plans/2026-09-24_notepadpp-web-plan.md` (8 tasks).
- Task 1 executed → `docs/scope.md`:
  - Tier 1 MVP / Tier 2 phase-2 / Tier 3 exploratory feature lists, plus an explicit
    "impossible backend-free" table (native plugins, NppExec, shell integration, OS ANSI codepage).
  - Browser capability matrix (Chrome/Edge vs Firefox vs Safari) with a fallback for every ❌.
  - Encoding matrix: what `TextDecoder` covers vs what needs WASM, plus the
    `iso-8859-1`→windows-1252 label trap.
  - Risks R1–R7 including R3 (CM6 does not preserve mixed per-line EOL) and R2 (split-view spike).
  - Decisions D1–D9 proposed; four open questions in §10.
- Progress mechanism created: this ledger + `scripts/status.mjs` reporter + `.gitignore`.

**Verified**
- All browser-support and library claims checked against MDN, caniuse, Mozilla standards-positions
  and the CodeMirror 6 reference; npm versions confirmed live on 2026-09-25.
- `node --version` → v22.23.0, `npm --version` → 10.9.8 (toolchain is present for Task 2).

#### Session 6, continued (2026-10-12, 00:0x–01:0x) — the pickers check, re-run because Task 7 moved its starting state

Task 7 was already committed when this began. What follows is Task 4's real-chooser check re-run, three
failed runs, and the defect they turned up. The *way* the failures were read is the part worth keeping.

**Measured, in order.**

1. **36/39**, twice, on a single check: `windows-1252: flagged as assumed, not silently guessed (D4)` —
   whose own detail now read `the active document was 't4-win1252.txt' at the deadline`. Two instrumented
   runs settled what that meant: `0 modal alert(s) were dismissed while waiting`, the page reported
   `assumedEncoding: false`, and the document was already active — so the app had *adopted* a document that
   already existed and the check was asserting a fresh open's fact about it.
2. A fourth run printed the state: `{"documents": 3, "assumedEncoding": false, "dirty": false}` with tabs
   `[t4-crlf-bom.txt, t4-win1252.txt, t4-edit-copy.txt]` and **no welcome buffer** — the shape a *restore*
   leaves. `#restoreSession` is the only path that closes the welcome buffer (`workspace.ts:1748-1853`), and
   that tab order is not the order this run opened things in.
3. So the app had restored a *previous* run's session although the profile was deleted before the run:
   each run's own Chrome rewrites the profile **while shutting down**, so a delete immediately before the
   next run happens before that shutdown finishes and the stale session comes back. The fix belongs in the
   script: it wipes the profile itself, before Chrome starts, and asserts a clean start
   (`the run starts from a clean profile: one empty buffer, nothing restored`). With that: **43/43**.

**The defect the failures turned up — real, and worth the runs.** In the restore path the session records
`assumedEncoding` per file (`session-store.ts:69`), `#planRestore` carries it (`workspace.ts:1976`),
`#restoreSession` puts it into `RestoreState` (`:1798`) — and **the document factory never read it**: the
flag was set only from a fresh file read (`:812`). A restored windows-1252 document therefore reported an
*identified* encoding to `inspect()` and to the status bar while its format was still `windows-1252` and a
save still wrote windows-1252 back — D4's "never silent" promise broken by a reload. Before the fix, a
pickers run measured `assumedEncoding: false` on exactly that state; after it, a probe that opens the file
through the app, lets the session write, reloads and asks again reads
`{"encoding": "windows-1252", "assumedEncoding": true}` (and `documents: 1`, which proves the restore ran).
`docs/session-persistence.md` now has the section "The assumed encoding survives a reload (D4)" with its two
stated limits: a save clears the flag, and a placeholder is never assumed.

**Mistakes of mine in this stretch.**
- **I edited the script while it was running.** A traceback then printed frames that did not match the code
  (`line 819, in <module> try:`); the message was right, but a reader would have been misled. Instrument
  through a log or a probe, not a moving target.
- **I trusted a manual `rm -rf` of the profile.** The script's own wipe plus an assertion is what makes the
  start state actually true, and it is a check now.
- **Two harness ideas were added and then corrected or removed by measurement**: an OCR read-back of the
  dialog's location bar (vacuous — the fixture is in the dialog's own `/tmp` listing — and fragile), and a
  geometry check that rejected `X=0 Y=0` (wrong: with no window manager the chooser is *placed* at the
  origin; measured `WIDTH=930 HEIGHT=510`).
- **Half of this session went to a check that is not the task's.** Task 7 was finished and committed; the
  work above is Task 4's evidence script. It ended in a real app fix and a green re-run, which is worth it
  once — but the ledger should say plainly where the time went.

**Repo state at session end**
- Committed in `1b5bcd4`.
- Pre-existing: commit `25c7edd "First release of Hello World!"` with `sample.html`
  deleted in the worktree and **not staged** — not this project's file to remove, left for
  the user to decide. `npm run status` will keep reporting it as uncommitted.

#### Session 1, continued — D2 review & D7 sign-off

**User input received**
- D7: **confirmed** — "yes, no Run/exec". Recorded as `Accepted`; the superseded open question
  is struck through in `docs/scope.md` §10.
- D2: requested an advantages/drawbacks list for CodeMirror 6 over Monaco before confirming.

**Done**
- `docs/editor-core-decision.md` written: 11 evidence-backed advantages (A1–A11) and
  8 drawbacks (B1–B8), each weighted for *this* project, a feature-by-feature head-to-head
  against the N++ tier list, the reversal triggers, and the cost attached to the recommendation.
- Key finding that reframes D2: Monaco's headline strengths (IntelliSense via workers,
  command palette, sticky scroll) **are not Notepad++ features**, while its official
  non-support of mobile browsers *is* a direct hit for a web port.

**Verified**
- Claims sourced to: Replit (1.26 MB gz vs 5.01 MB gz; no Monaco lazy-loading; CM6's touch
  motivation), Sourcegraph's Monaco→CM6 migration (Monaco = 40% of their JS, hard to trim,
  poor docs, global reference model, hardcoded-hex theming), Monaco's own site ("not supported
  in mobile browsers"), Monaco typedoc (`largeFileOptimizations`, `maxTokenizationLineLength`),
  microsoft/monaco-editor#2054 (Monarch tokenizes on the main thread), the CM6 reference
  (core `rectangularSelection`, `StreamLanguage`, million-line example), vitejs/vite#21426.
- npm versions checked live 2026-09-25, including `@codemirror/lsp-client@6.3.0` and
  `@replit/codemirror-minimap@0.5.2` (third-party, pre-1.0 — why the minimap remains a real
  CM6 drawback).

#### Session 1, continued — D2 accepted, Task 2 scaffold (DONE)

**User input received**
- D2: **confirmed** — "ok go for CodeMirror 6". Moved to `Accepted`.
- Instruction: proceed with Task 2.

**Done**
- Created: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.ts`,
  `src/style.css`, `scripts/verify-task2.py`.
- Dependencies installed (32 packages, exit 0): `vite@8.3.1`, `typescript@7.0.2`,
  `codemirror@6.0.2`, `@codemirror/state@6.7.6`, `@codemirror/view@6.43.13`. Only what
  `src/main.ts` imports is declared — `@codemirror/search`, `/commands`, `/language`,
  `/autocomplete` arrive with the tasks that import them (5, 6), not now.
- `vite.config.ts`: loopback-only dev server (D1), `base: "./"` for later portable/offline
  builds, sourcemaps, and an `editor-core` chunk split.
- `index.html`: minimal backend-free shell with an inline SVG favicon.
- `src/main.ts`: one real CM6 instance via `basicSetup` (provisional — Task 3 replaces it),
  plus a dev-only `window.__editor` handle used by the verification script.

**Verified**
- `npm run typecheck` → exit 0 (`tsc --noEmit`, TypeScript 7).
- `npm run build` → exit 0 in 223 ms: `index.html` 1.25 kB, CSS 0.64 kB, app JS 1.69 kB,
  `editor-core` **382.37 kB raw / 123.08 kB gzip**. First hard data point for D2/A1: the
  editor core is ~123 kB gz, against Monaco's 5.01 MB gz for a comparable setup.
- `python3 scripts/verify-task2.py` → **PASS**: HTTP 200, exactly 1 `.cm-editor`, 15 rendered
  lines, 18 gutter elements, dev handle present, `Control+End` + typing inserted
  `TYPED_BY_VERIFICATION` into the document, **0 console errors**.
- Cross-checked the screenshot with OCR (`tesseract`) — the rendered pixels contain the
  document text and the typed marker, so the pass is not a DOM-only artefact.
- Screenshot: `.hermes/cache/screenshots/task2-scaffold.png` (git-ignored).

**Pitfalls found (worth remembering)**
1. **Vite 8 bundles with Rolldown**, where `output.manualChunks` accepts *only a function*.
   The Rollup object form (`{ "editor-core": [...] }`) fails to type-check with
   `'"editor-core"' does not exist in type 'ManualChunksFunction'`. Recorded as S3.
2. **A missing favicon was the only console error.** Fixed with an inline SVG data-URI favicon —
   no extra request, still resolves offline.
3. **`browser_exec` cannot reach loopback here** (`ERR_CONNECTION_REFUSED` on `127.0.0.1`
   while `curl` returned HTTP 200). System Chrome via Python Playwright works; hence
   `scripts/verify-task2.py` and decision S2.
4. `tsconfig.json` must be **strict JSON** in this repo's tooling — JSONC comments are rejected
   by the file-writing validator, even though tsc itself would accept them.

**Carried forward**
- `basicSetup` in `src/main.ts` is provisional; Task 3 owns the real extension list.
- `window.__editor` is dev-only (`import.meta.env.DEV`) and documented as a verification handle.

#### Session 1, continued — phase-3 priority and browser scope decided (docs only, no code)

**User input received**
- "1) Tier-3: option B encoding/large-file · 2) Browsers: Chrome only · Update in the plan and
  progress wherever necessary. **Do not execute.**"

**Done — recorded as D10 and D11, with every downstream consequence**

- **D10 (phase-3 priority = encoding fidelity + large-file mode).** Reordered the Tier-3 list in
  `docs/scope.md` into "scheduled first" (WASM for UTF-32/DOS codepages; large-file mode) and
  "below that, unscheduled" (UDL explicitly ranked below). Reworded R1 so the WASM decoder is the
  *scheduled* mitigation rather than a maybe.
- **D11 (MVP browser scope = Chromium only).** Propagated everywhere it bites:
  - §8 acceptance criteria now read "in Chrome/Chromium", and criterion 3 no longer says "both
    browsers".
  - §7 tier B (Firefox) and tier C (Safari/iOS) marked **phase 2**; tier A marked **MVP**.
  - §5 keeps the Firefox/Safari columns but labels them phase-2 planning, and the old
    "nothing may depend on a Chromium-only capability" consequence was rewritten — with D11 the
    pickers *are* the MVP path, and the new consequence is a phase-2 seam requirement.
  - §4: "Open/Save" and "Recent files" rows no longer promise the tier-B path; the non-Chromium
    file I/O row moved into Tier 2.
  - New **risk R8**: deferring non-Chromium support risks an expensive retrofit.
  - New **S4**: Task 4 ships a thin capability check that shows "unsupported browser" instead of
    throwing, so the deferral is honest and phase 2 has a seam (mitigates R8).
  - Plan Task 4 spec revised: `src/file/fallbacks.ts` marked phase 2, step 2 deferred, added the
    capability-check step, and its verification is now Chrome-only.
  - Plan "Tests / Validation" browser matrix and "Risks" bullet updated to match.
- `docs/editor-core-decision.md` marked **confirmed**, with a post-decision note recording that
  D11 satisfies half of reversal trigger #2 (Chromium-only) while leaving #1 unmet (Minimap and
  Compare are still not MVP requirements), so CM6 stands. Its cost list now shows large-file mode
  as scheduled (D10) and minimap/Compare as still-unscheduled Tier 3.
- **No code was touched.** No build, no dependency change, no Task 3 work — per the instruction.

**Verified**
- Re-read all four documents before editing; edits are consistent across the files (grep-checked
  for stale "Chrome and Firefox", "Tier-3" and "D1–D9" references).
- `npm run status` still reports Task 1–2 DONE, Task 3 TODO — statuses were intentionally left
  untouched, because this session produced no task work.

**Carried forward**
- Mobile/tablet was **not** part of the "Chrome only" answer. Chrome for Android is Chromium, so
  mobile is not precluded, but nothing is promised either. Low stakes; settle it before Task 4
  if it matters, since it affects the OPFS/eviction work in Task 7.
- D1, D3–D6, D8, D9 remained `Proposed` *at that point*. (Superseded: **D6 and D9 were accepted
  2026-10-06** — see the decision log. D1, D3, D4, D5 and D8 are still proposed, and of those
  only **D3 + D4** gate a task.)

#### Session 1, continued (2026-09-25) — R2 spike and Task 3 core modules (landed, never recorded)

**Done**
- The R2 spike ran **before any tab-strip or split UI was written**, as the ledger demanded:
  `src/editor/spike-r2.ts` driven by `scripts/spike-r2-split.py` (real Chrome, real keystrokes),
  findings written up in `docs/r2-shared-state-spike.md`.
  **Verdict: the plan's wording was wrong, and the correction is load-bearing.** Two views on one
  `EditorState` do not stay in sync — CodeMirror's own example says the views "will simply
  diverge" — and the failure is silent, not an exception. The working shape is two states plus
  annotation-tagged forwarding, with only the owner view carrying `history()`, which is also what
  gives N++'s one-history-per-document semantics.
- Core modules written: `notepadpp-config.ts` (every default cited from Notepad++'s
  `Parameters.h` / `stylers.model.xml`, plus a `DEVIATIONS_FROM_NPP` list for what a browser
  cannot do), `split-view.ts` (`DocumentRuntime` + sync dispatcher), `tabs.ts` (document model),
  `chrome.ts` (pure-DOM shell).
- **Not recorded:** that turn's final report failed ("your request was not processed"), so none of
  this reached the ledger. `PROGRESS.md` still read Task 3 `TODO` and `main.ts` was still the
  Task 2 scaffold — the modules existed but nothing imported them.

#### Session 2 (2026-10-06) — Task 3 completed and verified (DONE)

**User input received**
- "proceed to task 3" — first attempt errored and was resent; this session executed it.

**Found on disk before writing anything**
- Untracked `src/editor/`, `docs/r2-shared-state-spike.md`, `scripts/spike-r2-split.py` (mtime
  2026-09-25) — half of Task 3 already existed, contradicting the handoff note that said Task 3
  was untouched. Read all of it before proceeding.
- **Deleted three files this session had started in parallel** (`spike.html`, `src/spike.ts`,
  `src/editor/split-sync.ts`): they independently re-derived the R2 result the existing spike had
  already measured, and two competing sync mechanisms in one codebase is a defect waiting to
  happen. The existing `scripts/spike-r2-split.py` is the canonical check.

**Done**
- `src/editor/workspace.ts` — the missing orchestrator: toolbar, tab strip, status bar,
  split/clone view, dirty tracking, close confirmation, keyboard handlers. The only module that
  mutates documents, so `chrome.ts` stays free of editor state and `tabs.ts` free of DOM.
- `src/main.ts` rewired off `basicSetup` onto `Workspace`; `src/style.css` grown into the real
  Notepad++ shell; `tabs.ts` gained the `state` field the orchestrator reads (with its header
  comment corrected to distinguish the live state from the `savedText` snapshot).
- `scripts/verify-task3.py` — 56 checks in real Chrome.

**Verified**
- `python3 scripts/verify-task3.py` → **PASS (56/56)**.
- `python3 scripts/spike-r2-split.py` → **R2_SPIKE: PASS** (12/12), unaffected by this session.
- `npm run typecheck` → exit 0; `npm run build` → exit 0, `editor-core` **296.81 kB / 96.16 kB gz**.
- Screenshot OCR (tesseract, 3× upscaled crops) confirms the rendered chrome rather than just the
  DOM: toolbar `New Close Wrap _ Split`, tabs `*new2 × new4 ×`, status `Ln1,Col1 Sel:00 Text Tab4 Wrap off`.

**Three defects the acceptance check found — all fixed, none papered over**
1. **An unwrapped line never overflowed.** With the pane/host chain row-oriented, `.cm-editor`
   sized itself to `max-content`: flexbox's `min-width: auto` resolves to the min-content width
   of a `white-space: pre` line, so a 400-character line widened the editor to 3237px instead of
   scrolling it (measured `scrollWidth == clientWidth == 3237`). Fixed with `flex: 1 1 0` +
   `min-width: 0` on the editor and `overflow: hidden` on its host. Task 2 never hit this because
   the editor was then a direct child of a *column* flex container.
2. **`Alt+N` swallowed the next keystroke.** Mounting a new document destroyed the focused view
   and its replacement started unfocused, so the following keystroke went nowhere. Fixed by
   focusing the owner view on mount — a genuine UX bug, not a test artefact.
3. **Two of my own checks were wrong,** and were corrected rather than relaxed: one pressed
   Ctrl+Z immediately after deleting the probe line (undoing the deletion it had just made), and
   one expected a close prompt on a document that had been fully undone back to its save point —
   closing an *unmodified* document is correctly silent. The second case is now asserted as its
   own check.

**Carried forward**
- **S5**: split view mirrors the active document in two panes; independent per-pane tab sets
  stay Tier 2 / phase 2.
- Fold state is not forwarded between panes — deferred to Task 6, which is when there will be
  languages to fold (`docs/r2-shared-state-spike.md` §4).
- **No menu bar exists yet**, deliberately: `chrome.ts` and `index.html` both record that it
  arrives with Task 4, once File ▸ Open / Save have something to sit in. The toolbar currently
  carries New / Close / Wrap / Split, all four functional.

#### Session 2, continued — D6 and D9 decided (docs only)

**User input received**
- **D6 accepted**: macros = editor transaction record/replay, not OS-input replay (`419dc54`).
- **D9 accepted**: all 22 official CM6 packages + all 103 `legacy-modes`, lazily loaded. The
  concrete proposal was filed first (`7e1de3a`), then the yes came on top of it.
- **D5 still open.** Its mechanism (ES modules + WASM, no native ABI) is forced by the
  environment, so only the installation model is genuinely unsettled — and no task gates on it.

**Carried forward to Task 6 — neither is part of D9's acceptance**
- Whether Task 6 *also* hand-writes `StreamLanguage` modes for **makefile, batch/.bat and INI**
  (≈ half a day). The 125 languages ship either way; this is an addition, not a condition.
- **C# coverage is unconfirmed.** CodeMirror 5's `clike` mode covered it, but we have not proven
  `legacy-modes` does. Verify before ever claiming C# support.

#### Session 2, continued — plan-vs-reality audit (docs + one script fix)

**Trigger:** the user asked for a review of progress "if everything done correctly as planned".

**Verified as correct — re-checked from primary sources, not from the ledger's own prose**
- All 11 commit SHAs recorded across the ledger and the plan resolve, and each matches its stated
  subject (`git log -1 --format=%s` on every one).
- Task 3's evidence reproduces at HEAD: `python3 scripts/verify-task3.py` → **PASS (56/56)**,
  exit 0; `python3 scripts/spike-r2-split.py` → **R2_SPIKE: PASS (12/12)**.
- `npm run typecheck` → exit 0; `npm run build` output matches the ledger exactly
  (`editor-core` **296.81 kB / 96.16 kB gz**).
- Decision status agrees across `PROGRESS.md`, `docs/scope.md` and the plan: D6 and D9 accepted;
  D1, D3, D4, D5, D8 proposed. R2 is closed in every file, with no leftover "Needs a spike".
- The pre-existing `sample.html` deletion is still unstaged, exactly as recorded.
- No stale `window.__editor` references remain under `src/`.

**Defects found and fixed**
1. **`scripts/verify-task2.py` could no longer run at all.** It reads `window.__editor`, which
   Task 3 deliberately removed, so it died with `TypeError: Cannot read properties of undefined
   (reading 'state')`. Task 2's evidence *row* remains correct — it was true when written — but
   that evidence is no longer reproducible from HEAD. Per the evidence rule the row was left
   untouched; instead the script now detects the supersession and exits **2 = SUPERSEDED**,
   naming the commit that still reproduces it (`26aaea6`) and the live equivalent
   (`verify-task3.py`), rather than failing obscurely.
2. **The plan carried six stale claims**: Task 3 had no ✅/Outcome although the header said it was
   done; the "Proposed Approach" list still marked Task 3 as the current step; Task 1's outcome
   still said D6/D9 were proposed; the Open Questions section still called D6 proposed; Task 6
   still said "~20 first-class Lezer grammars"; and the file list omitted the four modules Task 3
   actually added. All six corrected.
3. **The ledger contradicted itself.** An earlier session's "carried forward" line still read
   "D1, D3–D6, D8, D9 remain `Proposed`" while the decision log and blockers section said
   otherwise. Annotated as superseded rather than rewritten, so the history stays intact.
4. **The skill contradicted the file.** `project-progress-ledger` prescribes a *newest-first*
   session log; every entry here is appended chronologically. The skill now documents
   chronological append (with the reason) instead of the ledger being reordered to satisfy a rule
   that made it harder to maintain.

**Carried forward**
- Reproducing Task 2's evidence now requires `git checkout 26aaea6`. That is stated in both the
  script's docstring and the plan's Task 2 outcome, so nobody re-derives it as a failure.
- Nothing about Task 4 changed: it is still gated on **D3 + D4**.

#### Session 2, continued — D3 and D4 answered; Task 4 started (WIP)

**User input received**
- **D3 accepted** — the MVP ships Tier A only.
- **D4 accepted** — the WHATWG set is enough for the MVP; everything else gets an explicit warning.
- "proceed to next task" → Task 4.

**Scope re-verification (the residual risk this audit left open), 2026-10-06**
- caniuse `native-filesystem-api`: Chrome/Edge/Opera **desktop** support the pickers; Firefox is
  unsupported at every version (standards position still *harmful*); Safari is unsupported; and
  **Chrome for Android is unsupported too** — so the S4 notice is not hypothetical, and it is why
  the check tests for the API rather than sniffing for Chromium.
- MDN `showOpenFilePicker`: requires **transient user activation** (so no picker on load or from
  a timer) and rejects with **`AbortError`** when the user dismisses the dialog. Both are now
  handled in `src/file/file-io.ts` — a cancel is not a failure.

**Built — deliberately unwired, so the running app is unchanged**
- `src/platform/capabilities.ts` + `src/platform/fs-access.d.ts`. The ambient file records a real
  gap: TypeScript 7's `lib.dom.d.ts` ships `FileSystemFileHandle` and `createWritable()` but
  declares **none** of the three pickers (`showOpenFilePicker` appears only in a doc comment).
- `src/file/file-io.ts` — the single I/O boundary required by risk R8: BOM-first decoding,
  strict-UTF-8-then-"assumed windows-1252" (D4 forbids magic autodetection), saves through
  `createWritable()` that abort rather than half-commit, and the encoders described below.
- `scripts/test-file-io.mjs` — 45 byte-level checks, `node --experimental-strip-types`.

**The finding that shaped the design:** `TextDecoder` decodes the entire WHATWG mandate, but
**`TextEncoder` only encodes UTF-8** — no browser API encodes windows-1252 or UTF-16. So the
module builds the missing encoders itself: UTF-16 by hand, and every single-byte encoding from a
table **derived from its own decoder** (decode bytes 0x00–0xFF with that label, invert the result).
Multi-byte legacy encodings (GBK, Big5, Shift_JIS, EUC-*) therefore stay **decode-only**, and
saving one returns a written explanation rather than pretending. That is the honest edge of D4.

**Two of my own defects, caught by the tests rather than by review**
1. A "can Shift_JIS be encoded?" check passed when it should have failed: single-byte-ness was
   inferred from a table-size heuristic, and Shift_JIS decodes its ASCII and half-width-katakana
   bytes perfectly well one at a time. Inference replaced with the mandate's own list.
2. `TextEncoder.encode` is typed as possibly `SharedArrayBuffer`-backed, which the write API
   rejects; narrowed at the boundary behind a runtime check rather than a bare cast.

**Carried forward**
- **Task 4 is WIP, not done.** The pickers are written but unwired; still outstanding: the menu
  bar, recent-file handles, the status-bar EOL/encoding fields, `scripts/verify-task4.py`
  (OPFS-stubbed per the plan) and the manual picker checklist.
  *(Superseded 2026-10-10, Session 3: all of it shipped, and the picker checklist is automated —
  see the end of this log.)*

#### Session 2, continued — Task 4 wired and verified (still WIP: two items)

**Built**
- The **menu bar** Task 3 deferred here: File (New / Open… / Save / Save As… / Close) and View
  (Word Wrap / Clone to Other View), each showing its binding and closing on Escape or an outside
  click. It is a second path to the same commands the keymap runs, not a separate implementation.
- **Open / Save / Save As** wired through `file-io.ts`. The **three-way N++ close prompt**
  (Save / Don't Save / Cancel) replaced Task 3's two-button version — exactly what Task 3's own
  copy promised: "Saving a file arrives with Task 4".
- The status bar gained **encoding and line-ending columns**, and only for a document that has a
  file. A scratch buffer has no encoding on disk, so stating one would be the guess D4 forbids.
  A decode-only encoding is flagged *before* a save is refused rather than after.
- The **S4 notice** is shown by `Workspace.start()`, so `main.ts` carries no capability logic.

**Verified**
- `python3 scripts/verify-task4.py` → **PASS (38/38)** in real Chrome: byte-identical round trip
  of a CRLF+BOM file with nothing edited, and again after an edit; a byte-identical windows-1252
  round trip; UTF-32 refused with an explanation and no document opened; a dismissed picker
  producing neither an error nor a document; Save As retargeting the document; and — on a page
  whose pickers are deleted *before* the app script runs — the notice shown, the editor still
  mounting, Open explaining itself, and the close prompt withholding a Save it cannot perform.
- `node --experimental-strip-types scripts/test-file-io.mjs` → **PASS (45/45)**;
  `verify-task3.py` → **PASS (58/58)**; `spike-r2-split.py` → **R2_SPIKE: PASS**; typecheck and
  build exit 0. Screenshot OCR confirms the rendered chrome: `File | View`, a File menu reading
  `New Alt-n · Open… Alt-o · Save Alt-s · Save As… Alt-Shift-s · Close Alt-w`, and a status bar
  ending `windows-1252 CRLF Wrap off`.

**A Task 3 check had to change, deliberately — recorded rather than quietly edited.**
`verify-task3.py` asserted *"prompt offers discard, not a Save button that cannot save"*, which
Task 4 makes obsolete the moment Save becomes real. Its replacement asserts the **stronger**
contract: Save, Don't Save and Cancel are all present (checks went 56 → 58). That script's
welcome-text assertion also stopped pinning the string "Task 3", which would have failed every
future task for the wrong reason.

**Two more of my own assertions were wrong**, both corrected rather than loosened: one expected a
file to end with a trailing CRLF after typing at Control+End (it correctly does not — the caret
sits after the final newline), and one pinned the welcome text to a task number.

**Left before Task 4 can be called DONE**
*(Both items closed later: recent files shipped in the next entry; the checklist was automated in
Session 3, 2026-10-10.)*
1. **Recent files in IndexedDB** — plan step 3. Deliberately **not** started: that step *is*
   decision **D8** (OPFS for bodies, IndexedDB for metadata and handles), and D8 is still
   `Proposed`. Building it now would pre-empt a decision the user has not made.
2. **The manual picker checklist** — no automation can click an OS dialog, so a human must
   confirm it: open a real file, edit, save, and check the result on disk, including a CRLF+BOM
   file. Recorded as manual evidence when done, never claimed by the scripts.

#### Session 2, continued — recent files (Task 4 step 3), on the user's instruction

**User input received**
- "implement it" — build the recent-files step the entry above declined to start, because that
  step *is* decision **D8** and D8 was still `Proposed`. Recorded in the decision log as D8
  *half in use, still proposed*: this exercises its IndexedDB-for-metadata-and-handles half and
  leaves OPFS-for-document-bodies to Task 7. Only the user moves a D decision's status.

**Built**
- `src/file/recent-files.ts` — handles in IndexedDB, newest first, pruned to 8, keyed by name so
  re-opening a file moves it up the list rather than duplicating it. Every operation **fails
  soft**: if IndexedDB is unavailable the list is simply empty, because a convenience list must
  never become a failure mode for opening or saving.
- A stored handle is treated as a **capability reference, not as permission**. `ensureAccess`
  re-checks `queryPermission` and asks for `requestPermission` when the browser answers "prompt";
  a handle whose file has since moved or been deleted is **forgotten** rather than offered
  forever as an entry that can never work.
- `File ▸ Recent` entries, rendered from a cache (menus build synchronously, IndexedDB does not).
  Menus gained a dynamic form — `items` may be a function, re-read on open — plus a separator,
  because the recent list changes at runtime while every other entry does not.
- The permission methods were missing from TypeScript's lib as well: `FileSystemHandle` there
  declares only `kind`, `name` and `isSameEntry` (the `requestPermission` occurrences in
  `lib.dom` belong to `Notification`), so they are declared — optional — in `fs-access.d.ts`.

**Verified**
- `python3 scripts/verify-task4.py` → **PASS (44/44)**, six checks of which are new and run
  **after `page.reload()`** — the strongest proof available that the list is persisted rather
  than held in a variable, since the reload discards every in-page stub. The entries are still
  there, newest first, and clicking one reopens the file with its encoding and CRLF intact.

**The only item still outstanding is the manual picker checklist** — unchanged, and still
something no script may claim on the user's behalf.
*(Superseded 2026-10-10, Session 3: `scripts/verify-task4-pickers.py` drives the real dialog, so
that item became optional — see the end of this log.)*

#### Session 2, continued — handoff checked before pausing (docs only)

The user asked whether progress was saved somewhere a later session could resume from. It is —
that is what this ledger, `scripts/status.mjs` and the plan's progress markers are for — but
checking turned up **the same class of drift the earlier audit found**, in the two sections a new
session reads first:

- **Next action** still described Task 4 as "unblocked: the S4 capability check, the pickers, the
  menu bar…", every item of which had shipped during the session. A fresh session following it
  would have started rebuilding finished work.
- **Blockers** still listed **D3 + D4** as `Proposed` gatekeepers for Task 4, hours after both
  were accepted, and the `Resolved` line did not mention them.

Both are corrected. The pattern worth remembering: the **status board and decision log stayed
accurate because work updates them directly**, while the two *prose* sections — the ones nothing
mechanically rewrites — drifted. `npm run status` parses the board, so it never surfaced either
problem, which is exactly why the handoff should be read end to end before pausing rather than
trusted section by section.

#### Session 3 (2026-10-10) — Task 4's manual picker step replaced by a real check; task accepted

**User input received**
- "read the progress and proceed to execute next step" — i.e. the Next action above: Task 4's manual
  picker checklist, which the ledger said needed a human clicking a real OS dialog.

**The premise that step rested on was wrong, so the step was replaced rather than skipped.**
The plan and the ledger both recorded *"no CDP hook exists, therefore the picker round trip stays
manual"*. The CDP half is true and was re-verified against the installed Chrome 144 (protocol dump):
`Page.setInterceptFileChooserDialog` does emit `Page.fileChooserOpened` for a File System Access
picker, but with **no `backendNodeId`**, and `DOM.setFileInputFiles` can only answer a chooser with
an `<input type=file>` behind it — so the promise can be intercepted but never resolved. The
*conclusion* does not follow on a machine with an X server: a **headed** Chrome on a display opens
the real GTK chooser as an ordinary X window, which can be screenshotted (`ffmpeg -f x11grab`),
OCR'd (`tesseract`) and driven (`xdotool`). That is now `scripts/verify-task4-pickers.py`, running
Chrome inside Xvfb so it never touches the desktop and can be re-run by any future session.

**Built**
- `scripts/verify-task4-pickers.py` — 41 checks: the chooser is raised and OCR'd, a path is typed
  into its location bar (`ctrl+l`), the file it returns is opened in the app, saved, edited and
  saved again, with `md5` compared on disk each time and the fixtures recreated but never edited.

**Four environment traps, each measured before being written down**
1. **A reachable session bus sends the picker to xdg-desktop-portal**, whose dialog renders on the
   portal's display while the page waits forever (first run: promise pending, no window anywhere).
   Chrome is launched inside `dbus-run-session` to keep Chrome's own GTK chooser on our display.
2. **No window manager ⇒ X focus is `PointerRoot`**, so keys follow the pointer: the pointer is
   moved into the dialog before typing.
3. **No window manager ⇒ Chromium never considers its window focused**, so clicks land but DOM
   focus never moves and *typed characters vanish*. `xdotool windowfocus` on the Chrome window
   fixes it. This is what made "typing marks the document dirty" fail in an earlier run.
4. **Chrome asks permission the first time a site writes to a given file** ("Save changes to …?",
   *Cancel* + a filled blue *Save changes*). That prompt is browser UI, and while it is open **no
   input reaches the page at all** — a save followed by more clicking deadlocks silently. Return
   and Escape both answer *Cancel* (measured: the app then reports `createWritable` "request is not
   allowed"), and the affirmative label is white-on-blue, which tesseract cannot read, so the check
   finds the button by colour, anchored on the *Cancel* word's position, and clicks it.

**Two of this session's own checks were passing vacuously — the fix is the reason they now mean
something.** "Save with no edit leaves the real file byte-identical" passed while the write had
never happened at all (the prompt was unanswered, so `createWritable` was rejected); a cancelled
write leaves the bytes untouched too, so the comparison could not tell the two apart. It was caught
because the *next* action — opening another file — produced no dialog. Both save checks now assert
the side effect as well: Chrome replaces the file on write, so `(st_mtime_ns, st_ctime_ns, st_ino)`
must move, and the log prints the old and new inode. The same class of error appeared once in the
detector (a whole-screen "largest blue blob" search clicked into the page instead of the prompt and
still reported success); it is now anchored on the prompt's own *Cancel* button.

**Verified**
- `python3 scripts/verify-task4-pickers.py` → **PASS (42/42)**, and again on a second consecutive
  run — including a byte-identical CRLF+BOM round trip through a **real** write, a byte-identical
  windows-1252 round trip, an edit that reached the real file
  (`BOM + "line one\r\nline two\r\nthree"`, CRLF preserved), a second Open going through the dialog
  again, and a dismissal behaving as a cancel.
- **The second run was not green, and that was worth having.** It died waiting to click Save on the
  windows-1252 document: the app raises the assumed-encoding warning *after* adopting the file, so
  the check could see the filename before the warning existed — and the warning then blocked every
  later click for 30 seconds. Fixed at the root: the opener now waits for and dismisses that warning
  (and asserts it was shown, which is why the count is 42), and every click in the script goes
  through `click_or_alert`, which names and dismisses a stray alert instead of crashing — a crash
  hides every check behind it.
- Re-ran at HEAD after the change: `verify-task4.py` → **PASS (44/44)**; `test-file-io.mjs` →
  **PASS (45/45)**; `verify-task3.py` → **PASS (58/58)**; `spike-r2-split.py` → **R2_SPIKE: PASS**;
  `npm run typecheck` → exit 0; `npm run build` → exit 0, editor-core **296.81 kB / 96.16 kB gz**.
- Screenshots (git-ignored, `.hermes/cache/screenshots/`): `task4-pickers-dialog.png`,
  `task4-pickers-typed-path.png`, `task4-pickers-write-prompt.png`, `task4-pickers-roundtrip.png`.
- Caveat recorded rather than glossed: the check runs Chrome with a private D-Bus session, so it
  exercises Chrome's own GTK chooser. A desktop session whose bus has a portal would hand the same
  request to `xdg-desktop-portal-gtk` — a different dialog with the same API contract.

**Consequence for the task**
- **Task 4 moves to `DONE`.** The evidence rule asks for something reproducible, and the picker
  round trip now is: the manual checklist's premise (impossible to automate) is what is false, not
  the checklist's value. The human pass on the user's own desktop stays in the plan and is offered
  below, but it is no longer the gate.
- Task 5 (search/replace/navigation) is the next unit of work and is ungated.

**Repo state at session end**
- Three commits, each verifiable with `git log -1 --format=%s <sha>`:
  - `f79477c` — `task-4: drive the real OS file chooser end to end — Task 4 accepted` (the new
    check, the plan updates, Task 4 moved to `DONE`).
  - `9a11f15` — `docs: record the task-4 SHA (f79477c) in the board`.
  - `e0a74c3` — `task-4: harden the picker check — the warning dialog was a race, not a step`
    (the 42/42 the evidence cell quotes comes from this one).
- `sample.html` is still deleted-but-unstaged in the worktree, untouched — the pre-existing change
  recorded in Session 1, still not this project's to commit or revert.

#### Session 4 (2026-10-10) — Task 5: search, replace and navigation; task accepted

**User input received**
- "read the progress and proceed to execute task 5" — the Next action the ledger carried.

**What "fidelity" meant in practice.** Task 5's plan is four sentences long. What made it concrete
was reading Notepad++'s own source for every control and rule this session implemented, the same
standard Task 3 set: `FindReplaceDlg.rc` (control labels, per-tab buttons), `FindReplaceDlg.cpp`
(`FindHistory` option rules at :2695-2740, the status messages, `Searching::convertExtendedToString`
at :131), `Parameters.h` (the FindHistory defaults :1164-1186, `_bookMarkMarginShow = true` :902),
`Parameters.cpp` (`winKeyDefs[]`, the default accelerators), `GoToLineDlg.cpp` (line vs offset),
`rgba_icons.h` (`bookmark14`, the margin dot), `stylers.model.xml` (Mark Style 1 = `00FFFF`).
Where a rule was reproduced, the code cites the Notepad++ line it came from.

**Built**
- `src/search/find-replace.ts` — the floating Find / Replace / Mark dialog (`IDD_FIND_REPLACE_DLG`'s
  own labels and button sets), the commands over `@codemirror/search`'s `SearchQuery`, the marks,
  and N++'s Go To dialog (`IDD_GOLINE`: Line / Offset, "You are here:", "You want to go to:",
  "You can't go further than:", "Go" / "I'm going nowhere"). Options and their gating follow N++:
  regex mode disables whole-word and backward direction and enables ". matches newline"; wrap
  around is on by default; direction is down by default.
- `src/search/bookmarks.ts` — a `StateField<RangeSet<GutterMarker>>` (the shape `RangeSet.map()`
  gives for free: bookmarks ride through edits like Scintilla markers), the margin with a clickable
  toggle, and N++'s commands (toggle / next / previous / clear all, navigation wrapping as N++
  wraps, caret to the line start).
- `src/editor/notepadpp-config.ts` — `SEARCH_KEYS`, the handler hooks, the new extensions, N++'s
  mark (`00FFFF`) and bookmark (`#5f7bd7` at ~27% alpha, from the bitmap and
  `SCI_MARKERSETALPHA 70`) colours, and four more `DEVIATIONS_FROM_NPP` entries.
- `src/editor/workspace.ts` — the Search menu (N++'s item order), the dialog host, the bookmark
  commands, and the reconciliation that keeps a document's panes agreeing (S7).
- `scripts/verify-task5.py` (105 checks) and `scripts/probe-reserved-keys.py` (the keymap
  measurement).

**The keymap was measured, and measuring it took three attempts (S6)**
1. The first probe cancelled **every** keydown — including the plain characters typed afterwards to
   see where the focus went — so "did typing land" was false for every key, free ones included. Only
   accelerator-shaped keydowns are cancelled now.
2. The second run was contaminated by the first: after Ctrl+F opened the find bar, the *next*
   combination's typing went into that leftover bar, which read as "Ctrl+G is Chrome's" when it is
   not. Each measurement now runs in a fresh tab behind a verified precondition (Escape, re-focus
   the window — no WM runs under Xvfb — click, type a guard word and *require it to land*).
3. "Typing did not arrive" is a proxy, and a proxy can lie in both directions; the find bar's own
   counter is now read by OCR as corroboration, though the verdict rests on page-side facts.

Result: **Ctrl+F is unusable from a page** (no keydown ever reaches it, and Chrome's find bar opens
whatever the page does), so Find moved to **Alt+F**; Ctrl+H, Ctrl+G, Ctrl+M, F3 / Shift+F3 and
Ctrl+F2 / F2 / Shift+F2 all reach the page and `preventDefault` suppresses Chrome's action, so they
keep N++'s bindings. Recorded as S6, with the probe re-runnable.

**Verified at HEAD**
- `python3 scripts/verify-task5.py` → **PASS (105/105)**, and again on a second consecutive run.
  Over the 10 000-line file the task's verification asks for: regex Count **2.4 ms**, Mark All
  **4.8 ms**, Replace All **46.5 ms**, with the matches counted (1428), the marks painted and the
  replacement checked line by line. Also green: no console errors, no uncaught page errors, and
  `no request left the machine (D1)`.
- Regressions: `verify-task3.py` → **PASS (58/58)**; `verify-task4.py` → **PASS (44/44)**;
  `verify-task4-pickers.py` → **PASS (42/42)** twice, the real OS chooser included;
  `test-file-io.mjs` → **PASS (45/45)**; `spike-r2-split.py` → **R2_SPIKE: PASS**;
  `npm run typecheck` → exit 0; `npm run build` → exit 0, editor-core **305.27 kB / 98.72 kB gz**
  (up from 296.81 / 96.16 — the search package costs ~2.5 kB gzip).

**Checks that had to change — recorded, not quietly fixed**
1. **`verify-task4.py`'s "File and View menus"** asserted the exact list `["File", "View"]`. Task 5
   adds Search, so it now asserts that File and View are *present*: the point of that check is that
   file I/O needs a File menu, and a later task adding a menu is not a Task 4 regression. The Task 4
   row keeps its evidence, untouched.
2. **`verify-task4-pickers.py` gained trap 5.** Its first write failed 36/42 with "no prompt
   appeared" while the file never changed — and the app reported no failure, because nothing had
   failed *yet*: the save was waiting on a second Chrome prompt the script had never met. Chrome asks
   **per origin** on a profile's first write ("… wants to view and edit files from the last time you
   visited this site." — Allow this time / **Allow on every visit** / Don't allow), which is a
   different bubble from the per-file "Save changes to …?". `grant_write()` now answers both kinds
   and returns as soon as the file's inode moves. The lesson is the one the ledger already carries,
   met once more: **"the bytes did not change" passed while no write had happened at all.**
3. **The same script's first-write check** asserted that a permission prompt *appears*. Answering the
   origin bubble with "Allow on every visit" persists the grant, so that assertion could never hold
   again — its own fix made it false forever. It now asserts that the permission step is satisfied
   and the write landed, and reports which prompts were answered.

**The new check failed 7 of its first 105 — five were the check's fault, and that is worth keeping.**
The app was right in all seven cases: a fixture where a case-insensitive `HERE` also matched the
`here` inside `there`; a `first.line` pattern whose dot a space could satisfy, so it proved nothing
about line breaks; a replace sequence that began wherever the previous click had left the caret; a
backslash eaten by the shell→Python→JavaScript chain; and a bookmark count that included the
gutter's hidden width spacer. Two were real instrumentation gaps: the tab-switch check returned to
whichever tab happened to be first rather than the document it had bookmarked, and the spacer dot.
Each is now written so its assertion has exactly one possible answer.

**Carried forward**
- Task 6 (highlighting and language modes) owns `syntaxHighlighting`; the search marks and the
  overview ruler are separate and the marks' colour is already N++'s "Find Mark style".
- Named and deliberately not built, all recorded in `DEVIATIONS_FROM_NPP` and in the scope tier
  rows: Find in Files / Find in Projects (no filesystem in a page), the Search Results window,
  incremental search, the Smart Highlighter, "Copy Marked Text", and Boost.Regex's dialect.
- A design note for whoever touches the split next: the panes are reconciled in `#mirrorBookmarks`
  rather than in `split-view.ts`, precisely so the split mechanism stays ignorant of bookmarks.

**Repo state at session end**
- `d22f0d8` — `task-5: search, replace and navigation — the N++ dialog, bookmarks, and a measured
  keymap` (src, scripts, the plan's Task 5 section, the two scope rows), then a docs commit
  recording that SHA in the board.
- `sample.html` is still deleted-but-unstaged in the worktree, untouched — the pre-existing change
  from Session 1, still not this project's to commit or revert.

#### Session 5 (2026-10-11) — Task 6: syntax highlighting, language modes and the overview ruler

**User input received**
- "task 6" — the Next action the ledger carried.

**What was read first, before any code.** Task 6's spec is three sentences; what made it
concrete was Notepad++'s own source again, and two of its tables decided the whole design:
`ScintillaEditView.cpp:99`'s `_langNameInfoArray` (every language's short *and* long name, plus
the column saying which lexer N++ renders it with) and `langs.model.xml` (every `ext=` list).
Two more were found by looking rather than guessing:
- `Notepad_plus::setLangStatus()` (`Notepad_plus.cpp:3174`) writes `getLangDesc(langType)` — the
  **long** name — into `STATUSBAR_DOC_TYPE`, and `Notepad_plus_msgs.h:185` shows that field is
  part **0**: the language is the *leftmost* thing in N++'s status bar, ahead of the size, the
  caret, the EOL format and the encoding. The port now puts it there.
- `FileManager::detectLanguageFromTextBeginning` (`Buffer.cpp:1805`) is N++'s whole
  content-detection rule, gated by `DocumentFillPolicy::_detectLanguageFromContent = true`
  (`Buffer.h:82`) and applied only when the extension decided nothing. It is ported line by line,
  quirks included — the 40-character window ("shebangs can be large"), the first-line cut, the
  shebang table searched as *substrings in N++'s order* (so `#!/usr/bin/fish` is "Shell"), and
  `<?` deliberately last.

**Built**
- `src/languages/registry.ts` — **140 languages**. 27 first-class rows over the 22 packages
  (`lang-javascript` covers JavaScript/JSX/TypeScript/TSX, `lang-cpp` covers N++'s separate C and
  C++, `lang-sql` covers SQL and mssql, and `lang-angular` carries no extension because an
  Angular template is an `.html` file) plus 113 legacy parsers, each named and grouped as N++
  names it. Detection: extension, then exact file name (an addition — N++ uses extensions only),
  then N++'s content rule. `SUPERSEDED_BY_FIRST_CLASS` and `NOT_A_LANGUAGE` record the other 39
  parser exports with a reason each.
- `scripts/gen-language-registry.mjs` → `src/languages/legacy-modes.generated.ts`: **145 lazy
  loaders generated from the installed package**, because hand-typing 145 symbols is 145 chances
  to break a language that only fails when a user opens that file. `--check` fails if any export
  of the package is neither catalogued nor explained, and if the generated file is stale.
- `src/languages/highlight.ts` — N++'s token palette as a `HighlightStyle`. The spine is the
  **C lexer**, which `_langNameInfoArray`'s `_lexerID` column shows is what N++ uses for
  C/C++/C#/Java/JavaScript/TypeScript/Go/Swift/ActionScript/RC; HTML/XML, JSON, CSS and the
  preinstalled markdown UDL supply what C has no opinion about (tags, attributes, property names,
  headings). Function names are deliberately left black: the C lexer has no style for them and
  the lexers that do disagree with each other (Ruby `DEF NAME` 8080FF, Python FF00FF).
- `src/editor/overview-ruler.ts` — the ruler (**S8**), with `codeFolding()` added to the core
  extensions: `foldGutter()` only *draws* markers, and without the fold state nothing could be
  folded even though the gutter had been there since Task 3.

**The trap, and it was the build that caught it.** The first `npm run build` after wiring the
languages produced a single `editor-core` chunk of **1 591.85 kB / 565.20 kB gzip** — all 140
languages in the first load. `manualChunks` in `vite.config.ts` matched *every* `@codemirror/*`
module, and `manualChunks` wins over code splitting. The function now exempts
`@codemirror/lang-*` and `@codemirror/legacy-modes/*`: `editor-core` **335.24 kB / 109.13 kB gz**
plus **129 lazy chunks**. The exemption is asserted by the numbers in the plan, because the
failure mode is silence.

**Verified at HEAD**
- `python3 scripts/verify-task6.py` → **PASS (67/67)**. The four files the plan names are opened
  through the real File ▸ Open path against OPFS handles; every token is read back as computed
  colour **on rendered spans** (`def` `#0000ff` bold, comments `#008000`, strings `#808080`,
  numbers `#ff8000`, operators `#000080` bold, tags `#0000ff`, attributes `#ff0000`, markdown
  headings `#ff8000` bold) and every ruler tick as **canvas pixels** — the mark ticks in
  `00ffff`, the bookmark tick in `5f7bd7`. Over a 10 000-line JavaScript file the structure walk
  returns its 2000-tick cap in **8.5 ms**. No console errors, no page errors, no request off the
  machine, and OCR of the rendered status bar still finds the caret field.
- `node --experimental-strip-types scripts/test-languages.mjs` → **PASS (238/238)** — all 140
  loaders resolve in Node, plus the detection table (extension, file name, the six shebang cases,
  the first-line cases, the 40-character window), the named extension collisions, and D9's gaps
  asserted rather than assumed.
- `scripts/gen-language-registry.mjs --check` → **152 of 152** parsers accounted for.
- Regressions: `verify-task5.py` → **PASS (105/105)**; `verify-task4.py` → **PASS (44/44)**;
  `verify-task4-pickers.py` → **PASS (42/42)** with the real OS chooser; `verify-task3.py` →
  **PASS (58/58)**; `test-file-io.mjs` → **PASS (45/45)**; `spike-r2-split.py` → **R2_SPIKE:
  PASS**; `npm run typecheck` → exit 0.

**Three of this session's own mistakes, recorded rather than tidied away**
1. **`npx tsc` hung** for the full tool timeout while `./node_modules/.bin/tsc --noEmit` ran in
   0.2 s. Use `npm run typecheck` or the local binary in this repo.
2. **Fold mirroring did not happen at mount.** The first version reconciled folds only from
   `#onUpdate` (a transaction), so a document folded *before* the split opened with `[1, 0]` —
   the clone inherited nothing. It now hands the fold ranges over at mount, the way it already
   did for marks and bookmarks; `[1, 1]` after the split, `[0, 0]` after unfolding in the clone.
3. **Two of the acceptance check's own assertions were wrong**, not the app: it looked for the
   first `span[title]` in the fold gutter and found CM's hidden `initialSpacer` (whose marker
   carries the *other* title), and it clicked that marker by dispatching a synthetic event at
   (0, 0) — which CM resolves to a *line* by its y coordinate, so it appeared to work for the
   wrong reason. Both are now real mouse clicks at real coordinates on a visibly-laid-out marker.

**Carried forward**
- **No Language menu** (open item 1 below): detection names a language, nothing overrides it.
- `makefile`, `batch`, `INI`, `JSON5`, `GraphQL` have no CM6 mode; they open as "Normal text
  file". Hand-writing a `StreamLanguage` for the first three is still an option nobody has taken
  — the plan left it open and D9 does not require it.
- The ruler caps its structure ticks at 2000: on a very large file the strip saturates rather
  than thinning out. Fine at 10 000 lines (measured); worth revisiting with D10's large-file work.

**Repo state at session end**
- `c4e3c9e` — `task-6: syntax highlighting, language modes and the overview ruler — 140 languages,
  lazily loaded, in N++'s own colours` (src, scripts, the generator, `vite.config.ts` /
  `tsconfig.json`, the plan's Task 6 section, the scope rows), then a docs commit recording that
  SHA in the board.
- `sample.html` is still deleted-but-unstaged in the worktree, untouched — the pre-existing change
  from Session 1, still not this project's to commit or revert.

#### Session 6 (2026-10-11) — Task 7: session persistence and preferences; five pre-existing defects

**User input received**
- "task 7" — the Next action the ledger carried.

**What was read before any code was written.** Task 7's spec is three sentences; what made it
concrete was Notepad++'s own source again, and this time the decisive finds were:

- `NppParameters::writeSession` (`Parameters.cpp:4818`) and `getSessionFromXmlTree`
  (`Parameters.cpp:3408`) for the session's shape — in particular that it carries the caret *and the
  selection* (`startPos`/`endPos`/`selMode`), the viewport (`firstVisibleLine`/`xOffset`), the
  language, the encoding, `userReadOnly`, `backupFilePath`, `originalFileLastModifTimestamp`, and two
  child elements the port had never persisted: `<Mark line>` and `<Fold line>` — Task 5's bookmarks
  and Task 6's folds are part of the session.
- `Buffer.cpp:1231-1272`, where N++ writes the **whole specification** of its snapshot/backup system
  into a comment above the code: "load backup\FILENAME@CREATION_TIMESTAMP if exist, otherwise load
  FILENAME", "if … is loaded, set it dirty (red)", the 7-second sync, the delete-on-save, the
  untitled-buffer case, and the mtime comparison. The name is built at `Buffer.cpp:1312-1324`
  (`FILENAME@%Y-%m-%d_%H%M%S`).
- `Notepad_plus::loadSession` (`NppIO.cpp:2494-2613`) for the restore *order*, `newPlaceholderDocument`
  (`Buffer.cpp:1719-1763`) for the read-only placeholder and its once-per-run question, `doReloadOrNot`
  (`Notepad_plus.cpp:2593`) for the "modified by another program" wording, and `NppIO.cpp:306-330` for
  "we don't open the existing doc" — all of which the port now implements.
- `Notepad_plus.rc` (fetched from the N++ repo) for the View ▸ `Zoom` submenu's item labels and
  Settings ▸ `Preferences...`, `Parameters.cpp` `winKeyDefs[]` for what N++ binds them to, and
  Scintilla's own documentation for the range a zoom level may take (`SCI_ZOOMIN` stops at 60,
  `SCI_ZOOMOUT` at -10, "limiting yourself to -10 to +60 … is a good idea").

**Built**
- `src/storage/idb.ts` (one database, version 2, three stores, fail-soft), `preferences.ts` (N++'s
  `config.xml` keys with defaults and clamps), `session-store.ts` (the `session.xml` analogue, with
  the position helpers and the restore decision table written as pure functions so `test-session.mjs`
  can exercise the same code Node runs), `backup-store.ts` (N++'s `backup/` on OPFS, its naming, its
  sync rules, orphan pruning), `persistent-storage.ts` (risk R6's recorded mitigation,
  `navigator.storage.persist()`, reported not assumed).
- `src/editor/preferences-dialog.ts` — Settings ▸ Preferences…, N++'s session/toolbar/zoom settings,
  applied only on OK.
- `workspace.ts`: the session writer (500 ms debounce, immediate on a tab switch, a close,
  `visibilitychange` and `pagehide`), the snapshot scheduler on `snapshotBackupTiming`, the restore
  (preferences → plan every entry → N++'s two questions → adopt → active tab → split → rewrite →
  prune), View ▸ Zoom, the Settings menu, and `inspect()`/`debugSession()`/`debugBackups()` for the
  check.
- `docs/session-persistence.md` — N++'s three mechanisms quoted with their line numbers, the mapping
  table, the two races a page has that N++ does not, and the five defects below.
- `scripts/test-session.mjs` (75 checks, no browser) and `scripts/verify-task7.py` (82 checks, every
  one of them after a real reload), plus nine new `DEVIATIONS_FROM_NPP` entries.

**Verified at HEAD** — `verify-task7.py` → **PASS (82/82)** twice; `test-session.mjs` → **PASS
(75/75)**; regressions: `verify-task3.py` 58/58, `verify-task4.py` 44/44, `verify-task5.py` 105/105
(twice), `verify-task6.py` 67/67, `test-file-io.mjs` 45/45, `test-languages.mjs` 238/238,
`gen-language-registry.mjs --check` OK, `spike-r2-split.py` PASS, `npm run typecheck` exit 0,
`npm run build` exit 0 with `editor-core` **335.26 kB / 109.14 kB gz** across 129 chunks.

**Five defects this task found — all pre-existing, and all of them only visible once a *reload* was
part of the story:**

1. **The split erased folds** (and could have erased bookmarks). `#mirrorFolds`/`#mirrorBookmarks`
   compared *states*; a freshly mounted clone legitimately starts empty, so its first transaction —
   the bookmark copy, before the fold handover — read as "this document has no folds" and dispatched
   an unfold into the other pane. Fixed by comparing *changes* (`#foldSignatures`,
   `#bookmarkSignatures`); S11. **This is the bug the task's own check was written around** (bookmark,
   fold, then open the split).
2. **A restored document lost its grammar.** `#loadLanguage` reconfigures the views that exist when
   its import resolves, and during a restore none exist yet, so the extension went nowhere: no
   highlighting, and — because `foldable()` needs a grammar — no folds. The restore now awaits the
   grammar and puts it in the state at document creation.
3. **The overview ruler showed no structure for a view mounted on an already-parsed state** — caught
   by *Task 6's* check, which is pleasing: the sequence that hit it was N++'s own
   "activate rather than re-open" rule below. The plugin walks the tree at construction now.
4. **A document id could repeat.** Ids were `d{documents.length+1}-{newNumber}`: not unique once a
   document is *removed* (the welcome buffer a restore discards, or any closed tab), because the
   `new N` counter does not move when a file is opened. The collision made `#show()` return early —
   the file opened and never came to the front, which is exactly how a user would report it. One
   monotonic counter now.
5. **A redundant warning after a decision the user had already made.** Answering N++'s "reload it and
   lose the changes made in Notepad++?" with *yes* still produced a second dialog complaining that
   unsaved changes could not be restored — and because that alert is modal it *blocked the restore*
   from completing, which is how the check caught it (`session.complete` never became true). The
   answer is now recorded on the plan (`discardedByUser`) and respected.

**Two mistakes of my own, recorded rather than tidied:**

- **I quoted bundle numbers I had not measured** in the plan's Task 7 outcome (349.29 kB / 112.62 kB
  gz, "130 chunks"), written from the shape of the change rather than from the build. The build says
  `editor-core` **335.26 / 109.14** across **129** chunks — *unchanged* from Task 6, because the
  storage layer and the dialog land in the app's own chunk. Corrected in the plan before the commit;
  noted here because the whole point of the evidence rule is that a plausible number is not a
  measurement.
- **A harness idea that measured badly and was removed.** To stop the pickers script from blaming the
  app for a lost keystroke, `type_path` was first gated on reading the dialog's location bar back with
  OCR. Two runs showed the gate failing the *open* when the OCR was having a bad day, and a third
  showed the deeper problem: the fixture lives in `/tmp`, which is the dialog's own listing, so the
  OCR finds the file name whether or not the typing landed — the verification was vacuous *and*
  fragile. What survives is honest: the script retries the whole open once, the callers still assert
  the right file arrived, and `isSameEntry` was cleared by its own probe (two copies of one file are
  correctly *not* the same entry, so a wrong-file result is the harness).

**`verify-task4-pickers.py` did not go green today — recorded, not glossed.** Its best run reached
**36/39**, and the three failures are the harness mis-reporting a success: the check prints "the real
dialog handed back t4-win1252.txt" while its own detail reads `active document is
't4-win1252.txt'` — i.e. the app *did* open the right file through the real chooser, a moment after the
deadline the loop was waiting inside (two attempts, one FAIL each, plus the caller's verdict behind
them). Earlier runs in the same session reached 35/39 (same shape) and 33/35, one crashed on the
original bare `KeyError: 'X'`, one on `Cannot read properties of undefined` after a keystroke sent
`ctrl+l` to Chrome's own location bar and navigated the page away from the app, and one hit a
60-second `ffmpeg -f x11grab` timeout inside a screenshot. No strays from the killed runs were left
behind (checked: no Xvfb, no ffmpeg, no second Chrome). The environment is the cause and it is visible in the evidence: the dialog OCR shows
a Chrome **"Relaunch to update"** bubble over these runs, `ffmpeg -f x11grab` hit a 60-second timeout
inside a screenshot, and no strays from the killed runs were left behind (checked). What is in place
now: a retried geometry lookup (the original crash was a bare `KeyError: 'X'`), an explicit
`windowfocus` on the dialog (a stray `ctrl+l` can no longer reach the browser), `app_mounted()` so a
navigated-away page fails *by name* instead of with `Cannot read properties of undefined`, one retry
per open, a 45 s deadline, and Chrome launched with `--disable-background-networking
--disable-component-update`. Task 4's row keeps its 2026-10-10 evidence (42/42 twice), which was true
when written; the re-run is outstanding and the next session should do it in a quiet environment
(first: let Chrome finish its update, or delete
`.hermes/cache/scratch/task4-pickers/chrome-profile`).

**Repo state at session end**
- `f829697` — `task-7: session persistence and preferences — session.xml's fields, N++'s backup/ on
  OPFS, and a Settings menu` (src, scripts, `docs/session-persistence.md`, the plan's Task 7 section,
  the three scope rows and the D12 proposal).
- `ce8e7dd` — `verify-task4-pickers: a lost keystroke costs a retry, not the run — and a crash names
  itself` (the harness fixes above, with the measured, not-green outcome in the message).
- `c98188a` — `task-7 fix: a restored document keeps D4's assumed-encoding flag` (the defect the
  pickers re-run turned up; the probe's before/after is in the message).
- `0d85712` — `verify-task4-pickers: green again (43/43) — it wipes its own profile and asserts a clean
  start`, with the harness changes and their measurements.
- then this docs commit, recording the SHAs in the board and closing the session.
- `sample.html` is still deleted-but-unstaged in the worktree, untouched — the pre-existing change
  from Session 1, still not this project's to commit or revert.

## Blockers / open questions

Nothing blocking, and nothing needs a task to proceed. Two items need the *user*, and both are filed
as written proposals rather than questions in prose:

1. **`D12` (mobile/tablet) awaits the user's word** — filed in `docs/scope.md` §3: recommendation
   **out**, i.e. a phone or tablet gets the S4 notice the way Firefox and Safari do. Task 7 is the
   task it changes, because a mobile browser evicts an origin's storage in a way that makes its
   promise ("your unsaved work is still there when you come back") one this port cannot honestly
   keep. Nothing is blocked on the answer: everything is feature-detected and no code branches on the
   device today.
2. **`D1`, `D5` and `D8` are still `Proposed`** — lower-stakes consolidations of choices already
   implied by accepted decisions. **D8 is now fully exercised**: Task 4 built its IndexedDB-for-handles
   half (`src/file/recent-files.ts`) and Task 7 the rest (session and preferences in IndexedDB, the
   bodies of unsaved documents in OPFS `backup/`). Only the user moves a `D` decision.

Open items, none of which blocks the next task:

3. **No Language menu — the one N++ feature Task 6 knowingly did not build.** Everything needed is in
   place and verified (`languagesByName()` orders all 140 as N++ names them,
   `Workspace.setLanguage(id | null)` swaps the grammar live, `inspect().language` reports it), so this
   is a menu plus a picker, not a mechanism. Task 7 made it slightly more valuable: the language is now
   stored per document and restored, so a choice made from such a menu would survive a reload. Until it
   exists, a scratch buffer and every unmapped extension (makefile, batch, INI, JSON5, GraphQL) are
   stuck as "Normal text file".
4. **No Dark Mode.** Task 7 built the *preference* (stored, applied at startup, threaded through
   `PALETTES`/`THEMES`) and its single value is N++'s light palette; the dark skin — its token palette
   and chrome colours — is a Tier-1 row in `docs/scope.md` that no task has claimed.
5. **Task 4's manual picker pass is now optional.** It used to be the gate;
   `scripts/verify-task4-pickers.py` now drives the real dialog, the real files and Chrome's write
   prompt automatically (42/42, two consecutive runs on 2026-10-10), so the evidence rule is satisfied
   without it. Offered, not required: two minutes on your own desktop — `Alt+O` each `/tmp/t4-*.txt`,
   `Alt+S`, `md5sum` again, cancel one picker.
6. Chrome's **per-origin** file-edit prompt is answered on every run now: the pickers script wipes its
   own profile before each run (see the session log), so the prompt is no longer a leftover grant from an
   earlier run — the check records which prompts it answered.
7. The overview ruler's structure layer **saturates at 2000 ticks**. On a 10 000-line file that is
   already three ticks per pixel, so the cap is right for legibility — but a large-file mode (D10
   phase 3) should thin the ticks out instead of truncating them.

Resolved: ~~D2~~ · ~~D7~~ · ~~D10~~ · ~~D11~~ (2026-09-25) · ~~D3~~ · ~~D6~~ · ~~D9~~ (2026-10-06).

## Definition of done for the whole project

The MVP acceptance criteria in `docs/scope.md` §8 — six testable statements, including a
byte-identical open→save round-trip, the 50k-line responsiveness check, and "unsupported
browsers fail loudly", all passing **in Chrome/Chromium** (D11).
