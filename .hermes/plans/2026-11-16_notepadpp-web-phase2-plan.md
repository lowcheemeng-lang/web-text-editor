# Notepad++ Web Edition — Phase 2 Implementation Plan

> **For Hermes:** this file is the **spec**. It began as planning only; **Task 10 is implemented**
> (2026-11-16) and carries an Outcome block, and **Tasks 11–22 are still unstarted**. Progress lives
> in [`PROGRESS.md`](../../PROGRESS.md), not here. Start a session by reading `PROGRESS.md` →
> `docs/scope.md` → the phase-1 plan → this plan, in that order.

**Status:** Task 10 (Dark Mode) is **DONE** (2026-11-16). **Tasks 11–22 are unstarted.** Phase 1
(Tasks 1–8) is fully built and verified; the Language menu was Task 9 and is not part of this
document.

**Predecessor:** `.hermes/plans/2026-09-24_notepadpp-web-plan.md` (Tasks 1–8, all DONE).
**Scope authority:** `docs/scope.md` §4 (Tier 1 / Tier 2 / Tier 3) — this plan claims what that
table already ranked, and invents no feature.

**Goal:** close the two Tier-1 gaps phase 1 left, then do D10's scheduled correctness work
(encoding fidelity, large-file mode), then the Tier-2 backlog in an order where every task can be
verified on its own and nothing earlier has to be re-opened to finish something later.

**Architecture:** the same single-page, backend-free app. One `EditorState` per document, one view
per pane. Document-wide state (marks, bookmarks, folds, review state) lives in `StateField`s and is
reconciled across the panes by `workspace.ts`; per-document settings go through `Compartment`s.
Every new feature follows that shape or it will desynchronise a split view.

**Tech Stack:** unchanged — TypeScript (strict) + Vite 8 (Rolldown) + CodeMirror 6, OPFS +
IndexedDB, File System Access (Tier A only until Task 20).

---

## What phase 1 left, and where it is claimed here

| Left over from | Item | Why it was left | Task |
|---|---|---|---|
| Tier 1, unclaimed | **Dark Mode** — the *preference* shipped in Task 7, the skin did not | no task claimed it; `THEMES` has one value | **10** |
| D10, scheduled | **UTF-32 + DOS codepage** encode/decode | D4 refused them with a warning until this work | **11** |
| D10, scheduled | **Large-file mode** | needs a measured threshold, not a guess | **12** |
| Task 6 | overview ruler **saturates at 2000 ticks** instead of thinning out | fine at 10k lines (measured 8.5 ms), wrong at 1M | **12** |
| Tier 2 | Smart Highlighter + incremental search | phase 1 shipped Mark All only | **13** |
| S5 | **per-pane independent tab sets** (the split today clones one document) | S5 chose the clone; the other flavour was deferred | **14** |
| Tier 2 | Function List panel | needs first-class grammars only (D9's 27) | **15** |
| Tier 2 | column/block edit UI | `rectangularSelection()` is in the core; no UI or keymap | **16** |
| Tier 2 | Document Map (minimap) | S8 rejected the minimap in favour of the ruler | **17** |
| Tier 2 | autocompletion | `@codemirror/autocomplete` removed in Task 3 | **18** |
| Tier 2 | drop files onto the window | Chromium path only | **19** |
| D11, phase 2 | **non-Chromium file I/O** (Tier B/C) | D11 kept the MVP Chromium-only | **20** |
| Tier 2 | print | degraded vs N++ (R4); needs a print stylesheet | **21** |
| D6, unbuilt | **macros** (transaction record/replay) | accepted as the mechanism, never scheduled | **22** |

**Not claimed here** (Tier 3, still unscheduled, still out): UDL, Compare/diff, column-sort dialog,
spellcheck, and the whole "impossible backend-free" table (D7). **The plugin host is the exception:
D5 was amended and accepted by the user on 2026-11-17 and the work is scheduled immediately after
this plan's Task 22** — tasks P0–P8 in
`.hermes/plans/2026-11-17_130500-notepadpp-web-plugin-host-plan.md`, design in `docs/plugins.md`. It
is not claimed here because nothing in Tasks 10–22 depends on it, and Tasks 11–22 keep changing the
seams it would sit on (`notepadpp-config.ts`'s compartments, the chrome, the storage layer). D1 and
D8 stay `Proposed` and need the user, not a task.

## Ordering rules

1. **Tier 1 before Tier 2.** Dark Mode is a gap in a tier that is supposed to be finished.
2. **Correctness before breadth** — D10's own rule: a mis-decoded legacy file or a stalled editor
   is silent data loss or a hard block; a missing convenience is visible and has a workaround.
3. **One task per session**, each with a reproducible check in `scripts/` (S2) and its own row in
   `PROGRESS.md`. A task that cannot be checked by a script does not get a `DONE` row.
4. **Spike before building an unknown.** R2 (split view) and Task 8's offline measurements are the
   standing example: measure the failure mode first, then choose the design. Tasks 11, 12, 14, 17
   and 22 each start with a spike whose numbers decide the implementation.
5. **Nothing earlier is re-opened.** If a task changes an earlier task's contract, it says so in
   the task and updates that task's check deliberately, as Task 5 did with `verify-task4.py`.

---

## Task 10 — Dark Mode (Tier 1 gap) — ✅ DONE (2026-11-16)

**Objective:** Notepad++'s Dark Mode as a second palette selected by the preference that already
exists, applied to the editor *and* the chrome, with N++'s dark token colours — not a CSS filter.

**Outcome.** The two palettes now live in `src/editor/palettes.ts` and the token tables in
`src/languages/token-colours.ts` (both free of CodeMirror imports, so `scripts/test-themes.mjs` can
read them in Node); `highlight.ts` builds the `HighlightStyle` from the table in force and
`notepadpp-config.ts` holds a `highlightCompartment` beside the look compartment. Every chrome
colour in `style.css` became a variable, with `[data-theme="dark"]` carrying `NppDarkMode.cpp`'s
values. The theme is mirrored into `localStorage`, and an inline script in `index.html` sets the
attribute before the first paint; `#applyPreferences()` keeps it in step. `verify-task10.py`
(24/24) drives the real dialog and menus, and `test-themes.mjs` (18/18) checks the tables.

**One acceptance line in this plan was wrong, and the measurement is the record:** the verification
below asked for "WCAG contrast ≥ 4.5:1 for every token colour". N++'s own palettes do not meet
that — dark comment/docComment 3.59:1, operator 3.77, regexp 3.97, string 4.09 on #3f3f3f; light
number/heading 2.52:1, string 3.95, added 3.80, attribute/error 4.00, removed 4.13 on white. The
task keeps N++'s colours and pins both sets in the Node test and in `DEVIATIONS_FROM_NPP`, which is
the honest version of "match Notepad++".

**Files (as built):** `src/editor/palettes.ts` *(new)*; `src/languages/token-colours.ts` *(new)*;
`src/editor/notepadpp-config.ts`; `src/languages/highlight.ts`; `src/storage/preferences.ts`;
`src/style.css`; `src/editor/preferences-dialog.ts`; `src/editor/workspace.ts`; `index.html`;
`scripts/test-themes.mjs`; `scripts/verify-task10.py`.

**Why it is first:** it is the only Tier-1 row no task has claimed, and every phase-2 feature that
adds chrome (panels, print stylesheet, minimap) is cheaper to theme once.

**Files:**
- Modify: `src/editor/notepadpp-config.ts` — `PALETTES` gains a `dark` entry; `nppEditorLook()`
  already takes `theme`, so the chrome colour side needs a hook for CSS variables.
- Modify: `src/storage/preferences.ts` — `THEMES` gains its second value; the store is already
  theme-agnostic (no schema change, a `oneOf` list).
- Modify: `src/style.css` — the `--chrome-*` variables need a dark block; every hard-coded
  `#ffffff` / `#e2e2e2` in the chrome is a candidate (the menu popup is one).
- Modify: `src/editor/preferences-dialog.ts` — the select already renders `THEMES`; its help text
  currently says Dark Mode is not built and has to change.
- Modify: `src/languages/highlight.ts` — the token `HighlightStyle` is a static export; it must
  become selectable per theme (a `Compartment` in `workspace.ts`, the same pattern as
  `editorLookCompartment`).
- Test: `scripts/verify-task10.py`, plus `scripts/test-themes.mjs` for the palette tables in Node.

**Spec:**
1. Source N++'s dark values, not invented ones: `darkMode` colours live in N++'s
   `NppDarkMode.cpp` constants and its dark `stylers.model.xml`. Cite the file and the value
   beside each colour, as the light palette already does.
2. Both palettes must have **the same key set** — a Node test compares `Object.keys()` and fails
   on drift, because a missing key is a silently unpainted token.
3. Apply the theme in three places: editor theme (`nppEditorLook`), token highlight style (new
   compartment), chrome CSS (a `data-theme` attribute on the app root that the variables key off).
4. The stored preference keeps its existing shape; switching themes applies live via the
   compartment and survives a reload (Task 7 already persists it).
5. The status bar, tab strip, menus, dialogs and notices all switch — a screenshot pass is part of
   the check, and a contrast assertion is part of it too (see verification).
6. No flash of light theme on a reload: the theme attribute is set before the first paint if the
   preference is readable synchronously. If it is not, record the flash as a measured limit rather
   than pretending.

**Verification** (`scripts/verify-task10.py`):
- choose Dark Mode in Settings ▸ Preferences, assert the app root's `data-theme`, the editor
  background, the gutter, the menu popup and the status bar computed colours;
- assert token colours on rendered spans (`def` blue, comment green, string grey) are the dark
  palette's values, not the light ones;
- assert WCAG contrast ≥ 4.5:1 for every token colour against the dark background (pure
  arithmetic, no library);
- reload and assert the theme comes back without a preference write;
- screenshots of editor + open menu + Preferences dialog + the S4 notice.
- Node: `test-themes.mjs` — both palettes, identical key sets, N++ source citations non-empty.

**Risks:** N++'s dark palette is defined partly in code (`NppDarkMode.cpp`) and partly per-lexer;
the lexer table is the one that matters for token colours. If a value cannot be sourced, say so in
`DEVIATIONS_FROM_NPP` rather than inventing a plausible hex.

---

## Task 11 — Encoding fidelity: UTF-32 and the DOS/IBM codepages (D4 → D10)

**Objective:** read and write UTF-32 and the DOS codepages N++ offers, under D4's standing rule —
what cannot be done is refused *loudly*, and what is done round-trips byte-identically.

**What exists today** (`src/file/file-io.ts`): UTF-8 and UTF-16 encode by hand; every single-byte
WHATWG label gets an encoder *derived from its own decoder*; multi-byte legacy encodings are
decode-only; **UTF-32 is detected only to refuse it** (`decodeFile` returns `unsupported` for the
`FF FE 00 00` / `00 00 FE FF` BOMs). `DECODE_ONLY_ENCODINGS` is the honest list.

**The design question to settle first (spike):** D10 said "WASM encoders". The measurement to take
before writing any C/Rust: which of N++'s encodings are actually missing, and is the missing part a
*table* or *arithmetic*?
- UTF-32 decode/encode is arithmetic — no WASM, no table.
- CP437/CP850/CP852 are single-byte; WHATWG labels only IBM866. A 256-entry table per codepage,
  generated from Unicode's own mapping files, covers them exactly as `singleByteEncoder()` already
  derives the WHATWG single-byte encoders.
- Only a genuinely large multi-byte legacy set would justify WASM. **Do the JS route if the table
  size is what the spike measures; record the numbers that decided it** (this is the same rule that
  made S12 refuse a language precache).

**Files:**
- Create: `src/file/codepages.ts` (generated tables + their names), `scripts/gen-codepages.mjs`
  (a generator with `--check`, modelled on `gen-language-registry.mjs` so a stale table fails the
  build rather than a user's file).
- Modify: `src/file/file-io.ts` — BOM handling for UTF-32 LE/BE (order matters: UTF-32LE's BOM
  starts with UTF-16LE's, the existing comment already says so); `SINGLE_BYTE_ENCODINGS` and
  `DECODE_ONLY_ENCODINGS` move to the generated source of truth.
- Modify: `src/file/types.ts` — `BomKind` already has the UTF-32 pair; `DocumentFormat` needs no
  shape change.
- Modify: `scripts/test-file-io.mjs` — the byte-level suite grows the new codecs.
- Modify: `scripts/verify-task4.py` — the picker check's existing UTF-32 *refusal* assertion
  becomes an acceptance, and that change is recorded deliberately, never quietly.

**Verification:**
- `node --experimental-strip-types scripts/test-file-io.mjs` — byte-identical round trips for
  UTF-32LE/BE (BMP and astral characters) and each added codepage, including every byte 0x00–0xFF
  for the single-byte tables, plus the existing windows-1252/UTF-16 cases unchanged;
- `gen-codepages.mjs --check` — every codepage N++ lists is either implemented or named as refused,
  with the same "no export unaccounted for" guarantee the language registry has;
- `scripts/verify-task11.py` — a UTF-32 file opens, shows the right status-bar encoding, saves
  byte-identically; a CP437 file with box-drawing characters paints them and round-trips;
- the decode-only refusal still fires for what is still impossible, with a message naming the
  encoding.

**Acceptance:** D4's line in `PROGRESS.md`/`docs/scope.md` moves from "refused" to "shipped for
UTF-32 and the DOS codepages; multi-byte legacy remains decode-only", with the numbers.

---

## Task 12 — Large-file mode (D10), and the ruler's tick cap

**Objective:** a *measured* threshold above which the expensive extensions are disabled so a
million-line file stays editable, and a ruler that thins its ticks instead of truncating them.

**Spike first (mandatory, R2-style):** generate 100k / 500k / 1M-line JavaScript files and measure,
with every extension on and with groups off: open-to-first-paint, a keystroke's update time, a
scroll's frame time, memory, and the session/backup cost (a 1M-line dirty buffer must not be
snapshotted every 7 seconds). **The threshold comes from the table, not from a round number.**

**Files:**
- Create: `src/editor/large-file.ts` — the policy as pure functions (given a document size, which
  extensions are on), so Node can test it without a DOM.
- Modify: `src/editor/workspace.ts` — apply per document through `Compartment`s; the status bar
  must say the mode is on and why (a silent downgrade is the failure D4's rule exists to prevent).
- Modify: `src/editor/overview-ruler.ts` — `STRUCTURE_LIMIT = 2000` becomes a thinning rule
  (aggregate fold starts into buckets, keep one tick per pixel row), removing the phase-1 debt.
- Modify: `src/editor/notepadpp-config.ts` — the extension groups the spike proves expensive
  (`nppHighlighting`, `codeFolding`, `overviewRuler`, `bracketMatching`) become compartment-held.
- Modify: `src/storage/backup-store.ts` / session writer — respect the policy so a giant dirty
  buffer does not serialise on N++'s 7-second interval.
- Test: `scripts/verify-task12.py`, `scripts/test-large-file.mjs`.

**Verification:**
- `test-large-file.mjs` — the policy table: every threshold boundary, both sides, and that
  "restore highlighting" is possible;
- `verify-task12.py` — open generated files at each size, assert the policy state through
  `inspect()`, keystroke latency within a stated budget at each size, the status bar names the
  mode, the ruler draws ≤ one tick per pixel row and no longer saturates, and a normal file is
  unaffected;
- the measured table goes in the plan/ledger, not a prose "fast enough".

**Risks:** disabling *folding* changes a document's restored fold state (Task 7). Decide explicitly
whether folds survive the mode; if they are dropped, say so and make the session record it.

---

## Task 13 — Smart Highlighter and incremental search (Tier 2)

**Objective:** N++'s two search-adjacent conveniences: double-click a word → every occurrence is
highlighted in N++'s Smart Highlighting colour (`NPP_COLORS.smartHighlight`, `#00ff00`, already
reserved); and incremental search (N++'s Ctrl+Alt+I) with N++'s "while typing" behaviour.

**Files:** `src/search/find-replace.ts` (a `StateField` for smart highlights, like `markField` and
its S7 reconciliation), `src/editor/workspace.ts` (the command and the split mirroring),
`src/editor/notepadpp-config.ts` (the colour is reserved; add the CSS class and the key),
`scripts/verify-task13.py`.

**Spec:**
1. The highlighter's range set is a `StateField`, mapped through transactions, copied into a
   freshly mounted clone and reconciled *by change*, not by state (S11's rule — a clone
   legitimately starts empty).
2. Double-click is CM6's normal word selection; the highlight must follow the *selection*, and
   clear when the selection is empty or moves to a non-word.
3. Incremental search finds as you type, without opening the Find dialog; Escape returns to the
   pre-search selection (N++'s own escape behaviour: it snaps back).
4. A measurement decides whether the incremental path can reuse Task 5's `SearchQuery` iteration
   or needs the panel-free cursor — `search-package-internals.md` in the CM6 skill documents why.

**Verification:** `verify-task13.py` — double-click paints every occurrence (state count + rendered
spans in N++'s green), Escape/Escape clears them, the split shows the same set in both panes and a
bookmark/fold in one does not erase the other (the S11 sequence), and incremental typing moves the
selection with no dialog open. Regressions: `verify-task5.py` 105/105 unchanged.

---

## Task 14 — Per-pane independent tab sets (Tier 2; S5's deferred half)

**Objective:** N++'s other split flavour: each pane carries its own tab set and its own active
document, instead of the clone showing one document twice.

**Spike first:** `renderTabs(pane, …)` already takes a pane, and `#primary`/`#secondary` are
`PaneElements`, so the UI half exists. What must be measured is the *runtime*: two documents with
two histories, the session's `mainView`/`subView` mapping, and what "close the split" means for a
pane whose active document is not the other pane's (`Session activeView` already exists). Measure
before changing `document.runtime`.

**Files:** `src/editor/workspace.ts` (the pane→active-document map, session record, close/split
rules), `src/editor/split-view.ts` (it currently assumes one document across both views),
`src/editor/tabs.ts` (a tab descriptor gains its pane), `src/storage/session-store.ts` (the record
already has `subView`; it needs per-pane active indices), `scripts/verify-task14.py`.

**Verification:** open A and B, split, put A in the left pane and B in the right; assert both texts,
both tab strips, one undo history each; edit both, reload, assert both restored with the right pane
active; close the split without losing either; `verify-task7.py` and `verify-task3.py` green.

---

## Task 15 — Function List panel (Tier 2)

**Objective:** N++'s Function List: the document's own syntax tree, grouped by scope, click to jump.

**Spec:** walk `syntaxTree(state)` with the language's `foldNodeProp`/node names; **only the 27
first-class grammars have a tree** — a legacy `StreamLanguage` has none, which the panel must say in
one line rather than showing an empty panel (D9's trade-off, stated in public as S8 did for the
ruler). The panel is chrome, so it must fit the split (one panel per pane or one shared, decided by
measurement) and must not steal focus from the editor when refreshed.

**Files:** create `src/editor/function-list.ts`; modify `chrome.ts` (a panel host), `workspace.ts`
(a Settings/View toggle, refreshed on document change, debounced), `style.css`, and
`scripts/verify-task15.py`.

**Verification:** for `.js`/`.py`/`.cs`/`.md` assert the list names N++'s own node kinds and jumps
to the right line; for a legacy language assert the one-line explanation and no crash; assert the
list updates after an edit and survives a split.

---

## Task 16 — Column/block editing UI (Tier 2)

`rectangularSelection()` is already in the core (Task 3). What is missing is N++'s affordance: Alt-drag
and Alt+Shift+arrows, and a status-bar indicator when a rectangular selection is active. Files:
`notepadpp-config.ts` (the bindings), `workspace.ts` (the indicator), a new
`scripts/verify-task16.py` that drives real mouse and keys (the S6 lesson: measure the browser first
— Alt-drag may be the browser's own gesture on some platforms).

---

## Task 17 — Document Map / minimap (Tier 2)

S8 rejected the minimap in favour of the overview ruler; the scope still lists it as Tier 2. A canvas
minimap is a second view of the same geometry the ruler already computes (`position / doc.length`),
so it reuses that mapping and the `devicePixelRatio` discipline. It must not be the ruler's
replacement: both stay, toggled in View. Files: create `src/editor/minimap.ts`; modify `chrome.ts`
(a right-edge host), `workspace.ts` (toggle + persistence as a preference), `style.css`, plus
`scripts/verify-task17.py` with pixel samples of the canvas and a measured update cost at 10k lines.

---

## Task 18 — Autocompletion (Tier 2)

Word-from-document plus HTML/XML close-tag completion (`@codemirror/autocomplete`, removed in Task 3
because `basicSetup` carried it). Vite's `manualChunks` must keep the package out of the entry chunk
if it grows (S3's cousin: the build output is the only place that failure shows). Files:
`src/editor/workspace.ts` (a compartment), `notepadpp-config.ts` (keymap), `scripts/verify-task18.py`
(popup appears from real typing, Enter accepts, Escape dismisses, and no completion inside a
comment/string — N++'s own behaviour).

---

## Task 19 — Drop files onto the window (Tier 2)

`DataTransferItem.getAsFileSystemHandle()` is Chromium; the `File`-API fallback is Tier B and stays
in Task 20. Files: `src/file/file-io.ts` (a drop boundary that reuses `#adopt`), `workspace.ts` (the
drop target, refusing directories explicitly), `scripts/verify-task19.py` (a real `DataTransfer` in
the page; the drop opens through the same path as File ▸ Open and inherits encoding detection).

---

## Task 20 — Non-Chromium file I/O, Tier B/C (D11's phase 2)

**Objective:** the fallback UX D11 deferred: open via `<input type=file>`, save via a Blob download,
with OPFS as the editable working copy so nothing is lost between edits, and Safari/iOS's
storage-eviction warning plus an "Export backup" action.

**The seam already exists:** `src/platform/capabilities.ts` (S4) reports what the browser can do,
and `src/file/file-io.ts` is the single I/O boundary R8 required. The plan's phase-1 file list names
the file to create: **`src/file/fallbacks.ts`** — this task creates it.

**Spec:**
1. Capability detection chooses the path; nothing branches on a user-agent string.
2. Tier B/C never claims in-place save. The banner/Docs must say "saved to your downloads" once, not
   every save.
3. The OPFS working copy makes a re-download identical to the in-memory document; the eviction
   warning is the one thing Safari/iOS get that Tier A does not.
4. The S4 notice changes from "not supported yet" to the tier B/C explanation, and that is the only
   user-visible change on unsupported browsers.

**Verification:** `scripts/verify-task20.py` with the pickers deleted and `HTMLInputElement.showPicker`
stubbed to serve a real `File`; assert open → edit → export produces a byte-identical download
(Chromium's download path can be intercepted through Playwright), that a save reports "downloaded"
and not "saved in place", and that the Tier A path is untouched (`verify-task4.py` green). A real
Firefox/Safari run is the honest gap; state it rather than implying it was measured.

---

## Task 21 — Print (Tier 2)

`window.print()` plus a print stylesheet that hides the chrome and prints the document in N++'s
colours on white, with line numbers off (N++'s print output is text, not a screenshot). Files:
`src/style.css` (`@media print`), `workspace.ts` (View ▸ Print), `scripts/verify-task21.py`
(emulates print media, asserts the chrome is hidden and the text is present; a real printer is not
testable and is not claimed).

---

## Task 22 — Macros: record, replay, save (D6, accepted and unbuilt)

**Objective:** N++'s macro recorder, implemented as D6 says: CM6 transaction record/replay, not OS
input. Record every document-change transaction (not selection-only ones), replay through the same
`dispatch` path, run N times, and store named macros — as `localStorage`/IndexedDB entries, with
N++'s `shortcuts.xml`-style names. Playback speed and "run until the document changes no further"
are N++ features; take them only if the measurement shows they are cheap.

**Files:** create `src/macros/recorder.ts` (a `StateField` capturing change transactions with their
annotations), `src/macros/store.ts` (IndexedDB, fail-soft like `recent-files.ts`), a Macro menu in
`workspace.ts`, `scripts/verify-task22.py`, `scripts/test-macros.mjs`.

**Verification:** record typing + a replace-all, replay on a fresh buffer and compare the text
exactly; a recording spanning a language switch replays the same changes; a recording is refused
when it would capture a transaction from another document (the annotation makes this checkable);
persistence across a reload in Node where IndexedDB is absent (the fail-soft contract).

---

## Cross-cutting rules for every task above

- **A script per task** in `scripts/` (S2), named `verify-task<N>.py` (browser) or
  `test-<area>.mjs` (Node), and re-runnable at HEAD. A row without a re-runnable check is not `DONE`.
- **Evidence in the row**, not prose: a command and its observed result, a measured number, or a
  file plus the check it passes.
- **Regressions at HEAD**: the previous task's script, plus Task 3/5/6/7 as they are touched;
  batch failures must be re-run alone before being reported (the Task 8 lesson).
- **S-decisions** for anything the agent chooses (a threshold, a table source, a panel's
  placement); **D-decisions stay the user's** — none of these tasks needs a new D, and a task that
  finds it does must stop and file a proposal instead.
- **Deviation honesty**: anything N++ has and this port cannot do goes into `DEVIATIONS_FROM_NPP`
  with the reason, in the task that discovers it.
- **No drive-by refactors.** Each task touches the files it names.

## Suggested session order

```
10 Dark Mode ──► 11 encoding ──► 12 large-file ──► 13 smart highlight ──► 14 per-pane tabs
   ──► 15 Function List ──► 16 block edit ──► 17 minimap ──► 18 autocomplete
   ──► 19 drop files ──► 20 tier B/C I/O ──► 21 print ──► 22 macros
```

Tasks 10–12 are the ones the scope already ranked; 13–19 are breadth; 20–22 are the deferred
contracts (D11, R4, D6). 14 and 20 are the two that can reopen architecture, which is why they come
after the measured work and before the cosmetic ones (17, 21). If a task's spike says the design is
wrong, the correct move is the R2/S5 move: record the measurement and change the plan, not ship it.

## Phase 2 exit criteria

1. Dark Mode is a stored preference with two complete palettes, verified in pixels and contrast —
   no Tier-1 row remains unclaimed.
2. UTF-32 and the DOS codepages round-trip byte-identically; what is still refused is refused with
   a named encoding and a written reason.
3. A million-line file opens and accepts keystrokes within the measured budget, with the mode
   stated in the UI; the ruler thins instead of saturating.
4. The Tier-2 list above is either built with its check, or explicitly re-ranked in `docs/scope.md`
   with the reason — nothing is silently dropped.
5. Every task has its `scripts/` check green at HEAD and a row in `PROGRESS.md`; `npm run typecheck`
   and `npm run build` are green, and the entry chunk has not grown by a language-sized jump
   (S12/S3's rule).

## Open questions this plan does **not** answer

- **D1, D8** stay `Proposed`. D8 is fully exercised; D1 only bites if a desktop wrapper is ever taken.
  **D5 closed 2026-11-17** (amended and accepted by the user) and its build is scheduled after this
  plan's Task 22 — see `.hermes/plans/2026-11-17_130500-notepadpp-web-plugin-host-plan.md`.
- **A real Firefox/Safari run** for Task 20 cannot be done in this environment (Chrome via Playwright
  only). The task ships the fallback and states that limit, rather than implying it was measured.
- **WASM vs JS for encoding** is deliberately left to Task 11's spike, because D10's "WASM encoders"
  was a priority, not a measurement. If the tables are small, the JS route is simpler and ships
  sooner; the numbers decide.
- **The single-file portable HTML** stays declined (Task 8 measured 1699.9 kB and the `file://` losses).
  No task re-opens it; re-opening starts from `docs/offline-pwa.md`'s numbers.

---

*Planning only — no code was written for phase 2 in the session that produced this file. The
Language menu and the current-line selection fix belong to Task 9, not here.*
