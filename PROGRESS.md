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
| 4 | File operations without backend | DONE | `python3 scripts/verify-task4-pickers.py` → **PASS (41/41)** — the **real** OS file chooser, driven end to end: headed Chrome under Xvfb, the GTK dialog screenshotted and driven by xdotool, real files in `/tmp` opened, edited and saved, md5 compared on disk. Includes the write that the manual checklist existed to prove: Chrome's "Save changes to …?" permission prompt is answered, and the save is confirmed by the file's inode/mtime moving rather than by "no error appeared". `python3 scripts/verify-task4.py` → **PASS (44/44)** — OPFS-stubbed pickers, byte-level (CRLF+BOM and windows-1252 round trips, UTF-32 refusal, cancel-is-not-an-error, Save As, recent files surviving a page reload, unsupported-browser notice); `node --experimental-strip-types scripts/test-file-io.mjs` → **PASS (45/45)**; `python3 scripts/verify-task3.py` → **PASS (58/58)**; `python3 scripts/spike-r2-split.py` → **R2_SPIKE: PASS**; `npm run typecheck` → exit 0; `npm run build` → exit 0, editor-core **296.81 kB / 96.16 kB gz** | - |
| 5 | Search, replace, navigation | TODO | - | - |
| 6 | Syntax highlighting & language modes | TODO | - | - |
| 7 | Session persistence & preferences | TODO | - | - |
| 8 | PWA / offline packaging | TODO | - | - |

**Status vocabulary:** `TODO` · `WIP` · `DONE` · `BLOCKED` · `DEFERRED`

**Rule — the only way a task becomes `DONE`:** the Evidence cell contains something
*reproducible*, not a description. A command plus its observed result, a file path plus the
check that it passes, or a measured number. "Implemented X" is not evidence. "`npm test` →
43 passed" is. Where verification needs a browser, it lives in `scripts/` so it can be re-run.

## Next action

**Task 4 is DONE (2026-10-10).** The picker round trip it used to defer to a human is now a
re-runnable check — `python3 scripts/verify-task4-pickers.py` (needs `npm run dev` running) drives
the real OS dialog in a headed Chrome, opens `/tmp/t4-crlf-bom.txt` and `/tmp/t4-win1252.txt`,
edits, saves, answers Chrome's "Save changes to …?" permission prompt, and compares md5 sums on
disk. The two fixture files are recreated by that script; it never edits them.

A human pass on your own desktop is still possible and now **optional, not the gate** — the steps
are kept in the plan's Task 4 section: `Alt+O` each fixture, `Alt+S` without editing, `md5sum`
again, then cancel a picker once. Record it here if you do it.

**Then: Task 5 — search, replace, navigation** (`src/search/find-replace.ts`, plus
`src/editor/notepadpp-config.ts`), which is ungated:

1. Find/replace dialog: regex, match case, whole word, wrap-around.
2. Mark-all, find-next/prev, replace / replace-all.
3. GoTo line and bookmark-margin toggles.

Verified by a search/replace pass over a 10k-line file, plus `scripts/verify-task5.py` (S2).
Nothing gates Task 6 either (D9 accepted). D1, D5 and D8 remain `Proposed`; none blocks a task.

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
- One check needs more than Chrome: `scripts/verify-task4-pickers.py` drives a **real** OS file
  chooser, so it needs `Xvfb`, `xdotool`, `ffmpeg` (x11grab), `tesseract` and `dbus-run-session`.
  It starts its own Xvfb on `:99` and never touches the desktop; run it with `npm run dev` up.

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
- `python3 scripts/verify-task4-pickers.py` → **PASS (41/41)** — including a byte-identical
  CRLF+BOM round trip through a **real** write, a byte-identical windows-1252 round trip, an edit
  that reached the real file (`BOM + "line one\r\nline two\r\nthree"`, CRLF preserved), a second
  Open going through the dialog again, and a dismissal behaving as a cancel.
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
- Committed in `<SHA>`.
- `sample.html` is still deleted-but-unstaged in the worktree, untouched — the pre-existing change
  recorded in Session 1, still not this project's to commit or revert.

## Blockers / open questions

Nothing blocking. All four original scope questions are closed (see `docs/scope.md` §10).

Open items, none of which blocks the next task:

1. **Task 4's manual picker pass is now optional.** It used to be the gate; `scripts/verify-task4-pickers.py`
   now drives the real dialog, the real files and Chrome's write prompt automatically (41/41), so the
   evidence rule is satisfied without it. Offered, not required: two minutes on your own desktop —
   `Alt+O` each `/tmp/t4-*.txt`, `Alt+S`, `md5sum` again, cancel one picker.
2. **D1, D5, D8** — lower-stakes consolidations of choices already implied by the accepted
   decisions. D8 is *half in use* (Task 4's recent files exercise its IndexedDB half) but is still
   `Proposed`; only the user moves it.
3. One loose end, not a decision: **is mobile/tablet in scope at all?** D11 didn't address it.
   Settle it before Task 7, whose OPFS/eviction work is what it changes.

Resolved: ~~D2~~ · ~~D7~~ · ~~D10~~ · ~~D11~~ (2026-09-25) · ~~D3~~ · ~~D6~~ · ~~D9~~ (2026-10-06).

## Definition of done for the whole project

The MVP acceptance criteria in `docs/scope.md` §8 — six testable statements, including a
byte-identical open→save round-trip, the 50k-line responsiveness check, and "unsupported
browsers fail loudly", all passing **in Chrome/Chromium** (D11).
