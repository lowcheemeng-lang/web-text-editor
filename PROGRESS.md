# Progress Ledger — Notepad++ Web Edition

**This file is the single source of truth for project state.**
The plan is the *spec*; this ledger is the *state*. Keep them separate.

| Artifact | Role | Owner |
|---|---|---|
| `PROGRESS.md` (this file) | Current status, next action, decisions, session log | Updated at the **end of every work session** |
| `.hermes/plans/2026-09-24_notepadpp-web-plan.md` | Task specs (what to build, file paths, verification) | Edited only when the plan genuinely changes |
| `docs/scope.md` | Locked scope + browser compatibility matrix | Edited when a decision is *reversed* |

---

## Session start protocol

A new session (human or agent) needs zero prior context if it reads these three files
**in this order**:

1. `PROGRESS.md` — where we are, what is next (this file)
2. `docs/scope.md` — what is in scope, what is impossible, locked decisions D1–D9
3. `.hermes/plans/2026-09-24_notepadpp-web-plan.md` — the task-by-task spec

**Verify state before trusting it:** `node scripts/status.mjs`

**Copy-paste prompt for a new Hermes session:**

> Read `PROGRESS.md` in `/home/lowcheemeng/dev/web-text-editor`, then do the "Next action"
> it records. Follow the conventions in the ledger: one task at a time, record evidence,
> commit as `task-N: <summary>`, and update `PROGRESS.md` before you finish.

---

## Status board

| # | Task | Status | Evidence | Commit |
|---|------|--------|----------|--------|
| 1 | Define scope & compatibility matrix | DONE | `docs/scope.md` — 3 tiers, capability matrix, encoding matrix, R1–R7 risks; all claims sourced | `1b5bcd4` |
| 2 | Initialize project scaffold | TODO | - | - |
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
43 passed" is.

## Next action

**Start Task 2 — initialize the project scaffold** (`package.json`, `vite.config.ts`,
`tsconfig.json`, `index.html`, `src/main.ts`), per the plan's Task 2 spec. Acceptance for
that task is `npm install && npm run dev` serving the editor on `http://localhost:5173`.

Before writing code, get sign-off on the four open questions in `docs/scope.md` §10 —
especially **D2 (CodeMirror 6 vs Monaco)**, because Task 3's editor core depends on it.
Working agreement for now: proceed on the documented recommendations (`CodeMirror 6`) unless
told otherwise, and treat that choice as reversible until Task 3 starts.

## Conventions

- **One task per session** where practical. Finish it, verify it, record it.
- **Commit format:** `task-N: <summary>` (e.g. `task-2: scaffold vite + ts`). `git log --oneline` is then a second, tamper-evident progress ledger.
- **Branch:** `master` (solo project, no PR flow needed yet). Switch to feature branches if collaborators join.
- **Evidence before status:** update the board in the same session as the work, never later from memory.
- **Never edit a `DONE` row's evidence** to make a later failure go away — add a new session-log entry instead.
- **Decisions get an ID** (`D1`–`D9` in scope, `S1`+ below for implementation decisions). Reference the ID in commit messages and code comments so the "why" survives.

## Decision log

| ID | Date | Decision | Rationale | Status |
|----|------|----------|-----------|--------|
| D1 | 2026-09-25 | Browser-first SPA/PWA; desktop wrapper deferred | Reuses same bundle later; not a one-way door | Proposed |
| D2 | 2026-09-25 | CodeMirror 6 as the editor core | 4× smaller than Monaco incl. languages; modular; syntax tree enables Function List/folding; `StreamLanguage` is the only UDL path | **Proposed — blocks Task 3** |
| D3 | 2026-09-25 | Two-tier file I/O, feature-detected | Pickers are Chromium-only; Mozilla position on them is *harmful* | Proposed |
| D4 | 2026-09-25 | Encoding: WHATWG label set only in MVP; UTF-32/DOS codepages deferred to WASM | Encoding API's label list is fixed | Proposed |
| D5 | 2026-09-25 | Plugins = runtime-loaded ES modules + WASM, no native ABI | Only backend-free option | Proposed |
| D6 | 2026-09-25 | Macros = editor transaction record/replay | CM6 exposes all changes as transactions | Proposed |
| D7 | 2026-09-25 | Run/exec + native plugins permanently out of scope | Impossible without a process/shell | Proposed |
| D8 | 2026-09-25 | OPFS for documents, IndexedDB for metadata/prefs | OPFS is Baseline cross-browser since March 2023 | Proposed |
| D9 | 2026-09-25 | MVP: ~20 official CM6 languages + legacy-modes long tail | Official packages cover the popular set; legacy-modes covers breadth | Proposed |
| S0 | 2026-09-25 | Progress tracked in this ledger + `scripts/status.mjs`, not in chat history | Chat transcripts do not survive into new sessions; a repo file does | Accepted |
| S1 | 2026-09-25 | Scope doc is the authority for scope; plan is the authority for task sequencing | Prevents drift between the two | Accepted |

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

**Not done / carried forward**
- No code yet. No `package.json` — Task 2 owns that.
- D1–D9 are *proposed*, not confirmed.

**Repo state at session end**
- Everything from this session is committed in `1b5bcd4`, except the SHA-recording edit itself.
- Pre-existing: commit `25c7edd "First release of Hello World!"` with `sample.html`
  deleted in the worktree and **not staged** — not this project's file to remove, left for
  the user to decide. `node scripts/status.mjs` will keep reporting it as uncommitted.

## Blockers / open questions

Nothing blocking. Four decisions await the user (`docs/scope.md` §10):
1. Confirm D2 — CodeMirror 6 over Monaco (**blocks Task 3**).
2. Confirm D7 — Run/exec and native plugins permanently out.
3. Tier-3 priority: UDL parity vs encoding/large-file handling (pick one).
4. Firefox/Safari inside the MVP acceptance gate, or Chromium-only first.

## Definition of done for the whole project

The MVP acceptance criteria in `docs/scope.md` §8 — six testable statements, including a
byte-identical open→save round-trip and the 50k-line responsiveness check, passing on both
Chrome and Firefox.
