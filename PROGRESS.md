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
| 3 | Editor core with N++ defaults | TODO | - | - |
| 4 | File operations without backend | TODO | - | - |
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

**Start Task 3 — editor core with Notepad++ defaults** (`src/editor/notepadpp-config.ts`,
`src/main.ts`), per the plan's Task 3 spec: replace the provisional `basicSetup` in
`src/main.ts` with an explicit extension list tuned to Notepad++ behaviour (indent unit and
tabs-vs-spaces, word wrap toggle, line numbers, current-line highlight, caret behaviour),
then add the multi-document tab strip and split view (a second `EditorView` over one
`EditorState`).

**Do R2 first, as a timeboxed spike:** two CM6 views on a single `EditorState` is the
assumption behind split view and "clone to other view", and risk R2 says it is unverified.
Prove it or disprove it before building the tab strip on top of it.

Nothing gates Task 3. Later gates: Task 4 needs **D3** and **D4** (both proposed, both now
narrowed by D10/D11 — see the decision log); Task 6 needs **D9** (proposed).

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
| D3 | 2026-09-25 | Two-tier file I/O, feature-detected | Pickers are Chromium-only; Mozilla position on them is *harmful* | Proposed — **narrowed by D11:** MVP ships Tier A only; tier B/C I/O is phase 2. Gates Task 4 |
| D4 | 2026-09-25 | Encoding: WHATWG label set only in MVP; UTF-32/DOS codepages via WASM | Encoding API's label list is fixed | Proposed — **split by D10:** MVP = WHATWG set; the WASM half is the scheduled phase-3 priority. Gates Task 4 |
| D5 | 2026-09-25 | Plugins = runtime-loaded ES modules + WASM, no native ABI | Only backend-free option | Proposed |
| D6 | 2026-09-25 | Macros = editor transaction record/replay | CM6 exposes all changes as transactions | Proposed |
| D7 | 2026-09-25 | Run/exec + native plugins permanently out of scope | Impossible without a process/shell | **Accepted — user-confirmed 2026-09-25** |
| D8 | 2026-09-25 | OPFS for documents, IndexedDB for metadata/prefs | OPFS is Baseline cross-browser since March 2023 | Proposed |
| D9 | 2026-09-25 | MVP: ~20 official CM6 languages + legacy-modes long tail | Official packages cover the popular set; legacy-modes covers breadth | Proposed — **D10 ranks UDL below encoding/large-file**; the MVP language set is unaffected. Gates Task 6 |
| D10 | 2026-09-25 | Phase-3 priority: encoding fidelity (WASM for UTF-32/DOS codepages) + large-file mode. UDL parity ranks below it and stays unscheduled | Correctness beats breadth — a mis-decoded legacy file or a stalled editor is silent data loss or a hard block (R1, R3, B7); UDL is a visible missing feature with a documented workaround | **Accepted — user-confirmed 2026-09-25** |
| D11 | 2026-09-25 | MVP browser scope: **Chromium only** (Chrome/Edge/Opera). Firefox/Safari tier B/C fallback UX moves to phase 2; §8 acceptance is Chrome-only | User decision. Keeps the MVP on the single File System Access path; halves the file-I/O test matrix | **Accepted — user-confirmed 2026-09-25** |
| S0 | 2026-09-25 | Progress tracked in this ledger + `scripts/status.mjs`, not in chat history | Chat transcripts do not survive into new sessions; a repo file does | Accepted |
| S1 | 2026-09-25 | Scope doc is the authority for scope; plan for task sequencing; **this ledger for status** | Prevents drift between three files that could each claim to know the state | Accepted |
| S2 | 2026-09-25 | Each browser-verified task ships an executable check in `scripts/` | A prose "verified" claim cannot be re-checked by the next session; a script can | Accepted |
| S3 | 2026-09-25 | `manualChunks` in `vite.config.ts` must stay in **function** form | Vite 8 bundles with Rolldown, which dropped the Rollup object form; the object form fails to type-check | Accepted |
| S4 | 2026-09-25 | Task 4 ships a **thin capability check** (`src/platform/capabilities.ts`) that reports an unsupported browser instead of throwing; the full tier B/C implementation stays phase 2 | D11 defers non-Chromium support; a 10-line guard keeps the deferral honest and gives phase 2 a seam to plug into (mitigates R8) | Accepted |

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
- D1, D3–D6, D8, D9 remain `Proposed`. D3 and D4 gate Task 4; D9 gates Task 6.

## Blockers / open questions

Nothing blocking. All four original scope questions are closed (see `docs/scope.md` §10).

Still `Proposed` (not blocking Task 3, confirm when the owning task starts):

1. **D3 + D4** — the two-tier file-I/O design and the encoding policy, both as narrowed by
   D10/D11. Gate **Task 4**.
2. **D9** — the MVP language set. Gates **Task 6**.
3. **D1, D5, D6, D8** — lower-stakes consolidations of choices already implied by the accepted
   decisions.

One loose end, not a decision: **is mobile/tablet in scope at all?** D11 didn't address it.

Resolved: ~~D2~~ · ~~D7~~ · ~~D10~~ · ~~D11~~ (all accepted 2026-09-25).

## Definition of done for the whole project

The MVP acceptance criteria in `docs/scope.md` §8 — six testable statements, including a
byte-identical open→save round-trip, the 50k-line responsiveness check, and "unsupported
browsers fail loudly", all passing **in Chrome/Chromium** (D11).
