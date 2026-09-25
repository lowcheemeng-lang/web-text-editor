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
2. `docs/scope.md` — what is in scope, what is impossible, decisions D1–D9
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
| 1 | Define scope & compatibility matrix | DONE | `docs/scope.md` — 3 tiers, capability matrix, encoding matrix, R1–R7 risks; all claims sourced | `1b5bcd4` |
| 2 | Initialize project scaffold | DONE | `npm run typecheck` → exit 0; `npm run build` → exit 0, editor-core **382.37 kB / 123.08 kB gz**; `python3 scripts/verify-task2.py` → **PASS** (HTTP 200, 1 CM6 instance, 15 lines, typing verified, 0 console errors) | _this commit_ |
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

Nothing gates Task 3 — **D2 is settled** (CodeMirror 6). Later gates: Task 4 needs **D3**
(two-tier file I/O) and **D4** (encoding policy); Task 6 needs **D9** (language set).

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
- **Decisions get an ID** (`D1`–`D9` in scope, `S1`+ below). Reference the ID in commit messages and code comments so the "why" survives.
- **Decision statuses:** `Proposed` → `Accepted` (user said yes) or `Rejected` (user said no). Only the user moves a `D*` from Proposed to Accepted.

## Decision log

| ID | Date | Decision | Rationale | Status |
|----|------|----------|-----------|--------|
| D1 | 2026-09-25 | Browser-first SPA/PWA; desktop wrapper deferred | Reuses same bundle later; not a one-way door | Proposed |
| D2 | 2026-09-25 | CodeMirror 6 as the editor core | Analysis in `docs/editor-core-decision.md`: 1.26 MB gz vs 5.01 MB; mobile supported vs officially unsupported; CSS theming for an N++ look; independent per-tab configs; native plugin-composition; viewport rendering for big files. Monaco's only wins here are built-in minimap + diff editor (both Tier 3, both substitutable) | **Accepted — user-confirmed 2026-09-25** |
| D3 | 2026-09-25 | Two-tier file I/O, feature-detected | Pickers are Chromium-only; Mozilla position on them is *harmful* | Proposed — gates Task 4 |
| D4 | 2026-09-25 | Encoding: WHATWG label set only in MVP; UTF-32/DOS codepages deferred to WASM | Encoding API's label list is fixed | Proposed — gates Task 4 |
| D5 | 2026-09-25 | Plugins = runtime-loaded ES modules + WASM, no native ABI | Only backend-free option | Proposed |
| D6 | 2026-09-25 | Macros = editor transaction record/replay | CM6 exposes all changes as transactions | Proposed |
| D7 | 2026-09-25 | Run/exec + native plugins permanently out of scope | Impossible without a process/shell | **Accepted — user-confirmed 2026-09-25** |
| D8 | 2026-09-25 | OPFS for documents, IndexedDB for metadata/prefs | OPFS is Baseline cross-browser since March 2023 | Proposed |
| D9 | 2026-09-25 | MVP: ~20 official CM6 languages + legacy-modes long tail | Official packages cover the popular set; legacy-modes covers breadth | Proposed — gates Task 6 |
| S0 | 2026-09-25 | Progress tracked in this ledger + `scripts/status.mjs`, not in chat history | Chat transcripts do not survive into new sessions; a repo file does | Accepted |
| S1 | 2026-09-25 | Scope doc is the authority for scope; plan for task sequencing; **this ledger for status** | Prevents drift between three files that could each claim to know the state | Accepted |
| S2 | 2026-09-25 | Each browser-verified task ships an executable check in `scripts/` | A prose "verified" claim cannot be re-checked by the next session; a script can | Accepted |
| S3 | 2026-09-25 | `manualChunks` in `vite.config.ts` must stay in **function** form | Vite 8 bundles with Rolldown, which dropped the Rollup object form; the object form fails to type-check | Accepted |

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
- Decisions D1, D3–D6, D8–D9 remain `Proposed`; none of them gate Task 3.

## Blockers / open questions

Nothing blocking. Two decisions still await the user (`docs/scope.md` §10):

1. **Tier-3 priority** — UDL parity, or encoding/large-file handling? Pick one.
2. **Firefox/Safari inside the MVP acceptance gate, or Chromium-only first?** Keeping them
   roughly doubles the file-I/O test matrix; D3 exists precisely so this is a choice, not a
   constraint.

Resolved: ~~D7~~ (accepted 2026-09-25) · ~~D2~~ (accepted 2026-09-25 — CodeMirror 6).

## Definition of done for the whole project

The MVP acceptance criteria in `docs/scope.md` §8 — six testable statements, including a
byte-identical open→save round-trip and the 50k-line responsiveness check, passing on both
Chrome and Firefox.
