# Scope & Browser Compatibility Matrix

**Deliverable:** Task 1 of the Notepad++ Web Edition plan.
**Status:** Accepted — D2 (CodeMirror 6), D7 (no Run/exec), D10 (phase-3 priority), D11 (Chromium-only
MVP), all user-confirmed 2026-09-25; **D6 (transaction record/replay macros)** and **D9 (22 official
packages + 103 legacy-modes)** confirmed 2026-10-06; **D3 (Tier A file I/O only)** and **D4 (WHATWG
encoding set, explicit warning for the rest)** also confirmed 2026-10-06; **D12 (mobile/tablet out of
the MVP)** confirmed 2026-10-12.
D1, D5, D8 remain proposed.
**Reference target:** Notepad++ 8.9.8 (Scintilla-based, C++/Win32, GPL).
**Verified on:** 2026-09-25. Source links in [Sources](#sources).

---

## 1. Purpose

Define a feature set that is realistically buildable as a **backend-free** browser
application, and record — per feature — which web API does the work and what happens
on browsers that lack that API.

Two questions drive almost every scoping call:

1. **Can the browser do it at all?** (no OS shell, no native plugin ABI)
2. **Can it be done in every target browser, or only Chromium?**
   → **Answered 2026-09-25 (D11): Chromium only for the MVP.** The Firefox/Safari
   analysis below is still maintained, but as phase-2 planning rather than MVP scope.

## 2. Non-goals

- Not a 1:1 port of Notepad++/Scintilla. Behaviour is *aligned*, not identical.
- No backend, no server-side rendering, no cloud sync in the MVP.
- No native plugin (`.dll` / Plugin Admin) compatibility — see §5.
- Windows-only integration (registry, shell context menu, GPG release flow) is out of scope.

## 3. Decisions

Proposed at Task 1; D2, D3, D4, D6, D7, D9, D10 and D11 have since been accepted by the user.
**D12 — proposed by Task 7 — was answered 2026-10-12: accepted, mobile/tablet is out of the MVP.**
See the decision log in `PROGRESS.md`, which is the authority on status.

| ID | Decision | Rationale |
|----|----------|-----------|
| **D1** | **Browser-first SPA/PWA.** Desktop packaging (Tauri/Wails/Electron) deferred to a later phase. | Answers open question 1 in the plan. Desktop wrappers can reuse the same bundle later, so this is not a one-way door. |
| **D2** | **Editor core: CodeMirror 6** (not Monaco). | Monaco is monolithically loaded (no lazy loading) and Replit measured it at 51.17 MB raw / 5.01 MB gzip vs CM6 + all languages at 8.23 MB raw / 1.26 MB gzip. CM6 is modular, its syntax tree powers Function List and folding for free, and `StreamLanguage` lets us build runtime-defined tokenizers — the only credible path to UDL parity. Monaco's minimap is the one thing we lose; a canvas minimap is a Tier-3 substitute. |
| **D3** | **Two-tier file I/O, capability-detected at runtime.** Tier A (Chromium): File System Access pickers, real in-place save. Tier B (Firefox/Safari/iOS): `<input type=file>` read + Blob download write, with OPFS as the editable home. | Pickers are Chromium-only and Mozilla's standards position is formally *harmful*, so a single-API implementation would exclude ~30% of users. **Narrowed by D11:** the MVP implements Tier A only; the Tier B/C fallback I/O moves to phase 2. The feature-detection *principle* survives as the thin capability check in Task 4 (S4). |
| **D4** | **Encoding: what the Encoding API gives us, and be honest about the rest.** | The WHATWG label list is fixed; UTF-32 and DOS/IBM codepages are absent. See §6. **Split by D10:** the MVP ships the WHATWG label set; the WASM half (UTF-32, DOS codepages) is the scheduled phase-3 priority. |
| **D5** | **"Plugins" = runtime-loaded ES modules** against a documented host API, plus WASM. No native ABI. | The only backend-free option. Chromium can load them from a user-picked local folder; elsewhere, paste-source install. |
| **D6** | **Macro recording = editor transaction recording**, not OS input replay. | CM6 exposes every change as a transaction, so record/replay/run-N-times is genuinely feasible without native hooks. |
| **D7** | **Run/exec features (NppExec-style, external tools) are out of scope.** | Requires a process/shell. Impossible backend-free; would need a desktop wrapper. |
| **D8** | **Persistence: OPFS for document bodies, IndexedDB for metadata/preferences.** Handles are also storable in IndexedDB, which is what makes Tier A "recent files" work. | OPFS is Baseline widely available (since March 2023) across Chromium/Firefox/Safari. **Both halves are now built** — Task 4 exercised the IndexedDB-for-handles half (`src/file/recent-files.ts`) and Task 7 the rest: the session and the preferences in IndexedDB, the bodies of unsaved documents in OPFS `backup/` (`src/storage/`). Status stays **Proposed**: only the user moves a `D` decision |
| **D9** | **MVP language set: all 22 official CM6 packages (first-class) + all 103 `@codemirror/legacy-modes` ports (long tail), each lazily imported.** UDL via `StreamLanguage` stays Tier 3. | **Counted and verified 2026-10-06 against the codemirror org and npm — all 22 install.** The "~20" above was written before anyone counted. First-class = Lezer grammar, so a real fold service *and* a syntax tree Function List can walk; legacy = CM5 stream parser, highlighting only, **no fold service**. Trimming the list saves nothing: `@codemirror/language-data` supplies one lazily-loaded description per language, so an unopened language costs 0 bytes. **Delivered in Task 6 (2026-10-11): 140 languages — 27 first-class rows over the 22 packages (JavaScript, JSX, TypeScript, TSX, C, C++ and two SQL dialects are separate N++ languages from shared packages) plus 113 legacy parsers out of the 152 the package exports; 281 distinct extensions.** The 39 others are 32 parsers a first-class grammar supersedes (each with its reason), and 7 exports that are factories or a keyword list, not languages — `scripts/gen-language-registry.mjs --check` fails if any export is unaccounted for. **The gap list, corrected by measurement:** makefile, batch/.bat, INI, JSON5, GraphQL, MATLAB-as-MATLAB (the Octave parser serves `.m`)… but **C#, Kotlin, Scala and Objective-C *are* covered** — `legacy-modes/mode/clike.js` exports parsers for them, which the 2026-10-06 note wrongly listed as gaps. `lang-angular@0.1.4` and `lang-vue@0.1.3` are pre-1.0. **D10 ranks UDL below encoding/large-file work**; the MVP language set is unaffected |
| **D10** | **Phase-3 priority: encoding fidelity + large-file mode.** WASM decoding for UTF-32 and DOS/IBM codepages, plus our own large-file threshold. UDL parity ranks below it and stays unscheduled. | Correctness beats breadth: a mis-decoded legacy file or a stalled editor is silent data loss or a hard block (R1, R3, B7), whereas UDL is a visible missing feature with a documented workaround. |
| **D11** | **MVP browser scope: Chromium only** (Chrome, Edge, Opera). Firefox/Safari fallback UX (§7 tiers B/C) moves to phase 2; §8 acceptance is Chrome-only. | User decision. Keeps the MVP on the single File System Access path and halves the file-I/O test matrix. Its cost is carried as risk R8 (retrofit risk). |
| **D12** *(proposed by Task 7, accepted 2026-10-12)* | **Mobile/tablet: out of scope for the MVP** — a phone or tablet gets the S4 notice, the same way Firefox and Safari do. | D11 fixed the browser (Chromium) but never addressed the *device*, and Task 7 is the task whose work it changes: a mobile browser evicts an origin's storage far more aggressively than a desktop one (iOS in particular purges non-installed sites' storage after days without use), so the promise "unsaved work is still there when you come back" — the whole point of Task 7 — is not one this port can honestly make there. The alternative would be: (a) keep mobile in scope and treat `navigator.storage.persist()` as the mitigation, which on mobile is a best-effort request that iOS refuses for non-installed sites, or (b) **out of scope, with the notice** — which costs nothing to reverse later, since everything is already feature-detected (`src/platform/capabilities.ts`) and no code branches on the device today. **Recommend (b).** **Accepted 2026-10-12** — the user's word was "D12 mobile/tablet is a no for now". Nothing needs building for it: the notice a phone receives is the one already shipped, because the check tests for the File System Access API itself rather than sniffing a device, and mobile Chromium has no pickers (`src/platform/capabilities.ts`, checked against caniuse 2026-10-06). **Measured 2026-10-12:** with the two pickers deleted before the app loaded, the notice renders and the editor still mounts, on a desktop-shaped and a phone-shaped (Pixel 5 emulation) session alike. "For now" is the cost of the decision, and it is small: nothing branches on the device, so re-opening it is a scope edit, not a retrofit. |

## 4. Feature tiers

### Tier 1 — MVP (must ship)

| Notepad++ feature | Web implementation | Confidence |
|---|---|---|
| Multi-document tabs | Custom tab strip; one `EditorState` per doc | High |
| Open / Save / Save As | Tier A pickers (Tier B input+download deferred by D11) | High |
| New document, dirty indicator, close prompt | App state + `beforeunload` guard | High |
| Find / Replace: regex, match case, whole word, wrap, replace-all | `@codemirror/search` `SearchQuery` + custom N++-style dialog | High |
| Go to line | `EditorView.dispatch` selection jump | High |
| Undo / redo, unlimited | `@codemirror/commands` history | High |
| Line numbers, current-line highlight, active-line gutter | `@codemirror/view` | High |
| Word wrap toggle, whitespace/special-char display, EOL display | `EditorView.lineWrapping`, `highlightSpecialChars` | High |
| Zoom in/out (Ctrl+±, Ctrl+wheel) | Editor theme font-size facet | High — **partly shipped in Task 7**: View ▸ Zoom In / Zoom Out / Restore Default Zoom (N++'s `IDM_VIEW_ZOOMIN`/`ZOOMOUT`/`ZOOMRESTORE`) and the zoom persisted as N++'s `ScintillaViewParams zoom`<br>the **key binding is deliberately not claimed**: N++ uses the numeric keypad's +/- and documents Ctrl+wheel in the menu label, and Ctrl+wheel is the browser's page zoom unless a page cancels the gesture — not measured here, and measuring first is S6's rule |
| Syntax highlighting | CM6 language packages (D9) | High — **shipped in Task 6**: 140 languages, lazily imported, painted in N++'s token colours (`src/languages/`) |
| Code folding | Fold gutter + language fold service | High — **shipped in Task 6**: `codeFolding()` supplies the fold state the gutter needed (Task 3 had wired the gutter only); folds follow a document into its cloned pane |
| Multi-cursor & column/rectangular selection | CM6 core ships `rectangularSelection()` + `crosshairCursor()` | High |
| Auto-indent, tab/space config, tab size | `indentUnit`, `indentOnInput`, language indent service | High |
| EOL conversion (CRLF/LF/CR) | `EditorState.lineSeparator` + document-wide re-write | Medium — see R3 |
| Case conversion (UPPER/lower/Title), duplicate/delete/move/sort lines, trim trailing whitespace, remove blank/duplicate lines | Pure JS line operations over the doc | High |
| Session restore (open tabs, caret, scroll) | OPFS + IndexedDB (D8) | High — **shipped in Task 7**: the session (`session.xml`'s fields, including N++'s `<Mark>`/`<Fold>` children, so bookmarks and folds come back), the bodies of unsaved documents in an OPFS `backup/` with N++'s `FILENAME@YYYY-MM-DD_HHMMSS` names, and the preferences (`config.xml`'s session/toolbar/zoom keys). `python3 scripts/verify-task7.py` → 82/82, everything asserted after a real reload; `docs/session-persistence.md` has the mapping and the deviations |
| Recent files | Stored handles via File System Access (D11) | High |
| Dark mode / themes | CM6 theme, N++-style palette | High — **the preference shipped in Task 7, the dark palette did not**: the theme name is stored, applied at startup and threaded through `PALETTES`/`THEMES`, but Notepad++'s Dark Mode itself (its dark token palette and chrome colours) is a skin, not a preference, and no task has claimed it |
| Line ending + encoding + language indicator in status bar | Status bar component | High — **shipped in Task 6** for the language field, in N++'s own position: `STATUSBAR_DOC_TYPE` is part 0, the leftmost (`Notepad_plus_msgs.h:185`), and the wording is N++'s long name ("Python file", "Normal text file") |
| Keyboard shortcuts matching N++ defaults | Custom keymap | High |

### Tier 2 — should-have (phase 2)

| Feature | Web implementation | Notes |
|---|---|---|
| Split view (two panes) | Two `EditorView`s over **two** `EditorState`s, with each document change forwarded to the peer views under a `syncAnnotation` | **R2 closed** — the spike proved the original "one shared `EditorState`" design wrong: the views diverge *silently*. See `docs/r2-shared-state-spike.md`. A clone of the active document shipped early in Task 3 (S5); what stays phase 2 is **per-pane independent tab sets** |
| Clone document to other view | As above | Shipped in Task 3 under S5: one undo history, per-view caret and scroll |
| Bookmarks (toggle/goto/clear) | Custom `StateField` + gutter markers | High — **shipped early in Task 5** (2026-10-10): the row stays listed here because the tier is about priority, and Task 5's own acceptance line names bookmarks. Nothing about it is deferred. |
| Mark all / highlight matches / incremental highlight | Decoration plugin | High — **Mark All shipped in Task 5**; highlighting the selected word (N++'s Smart Highlighter) and incremental search are still unbuilt and remain phase 2. |
| Function List panel | Walk the CM6 syntax tree | High |
| Column/block edit mode UI (Alt-drag, Alt+Shift+arrows) | `rectangularSelection` + keymap | High |
| Document map (minimap) | Canvas render of doc + viewport box | Medium — hand-rolled |
| Auto-completion (word-from-document, HTML/XML close tags) | `@codemirror/autocomplete` | High |
| Drop files onto window to open | `DataTransferItem.getAsFileSystemHandle()` | Chromium-only in the MVP; the `File`-API fallback goes to phase 2 with the rest of tier B |
| **Non-Chromium file I/O** (Tier B/C fallback UX) | `<input type=file>` + Blob download, OPFS working copy | **Moved here by D11** — see §7 |
| Print | `window.print()` + print stylesheet | Medium — degraded vs N++ (R4) |
| Macro record / replay / save with shortcut | Transaction recording (D6) | Medium |
| PWA install + offline | Service worker + manifest | High |
| Multi-select-all-matches, multi-caret editing | CM6 supports multiple ranges natively | High |

### Tier 3 — nice-to-have / exploratory

**Scheduled first (D10 — phase-3 priority):**

- **Encoding conversions requiring WASM** (UTF-32, DOS/IBM codepages) — see §6.
- **Large-file mode** — disable expensive extensions above a threshold; spike the million-line case.

**Below that, unscheduled:**

- **User Defined Language (UDL)** — N++'s UDL2 XML parsed into a CM6 `StreamLanguage`. Keyword lists, comments, operators map cleanly; folder/keyword nesting and delimiters only partially. Best-effort parity, not exact. Ranked below D10.
- **Plugin host API** — sandboxed ES module loader with a documented `hostAPI` (commands, decorations, panels, dialogs).
- **Column sort dialog, advanced regex helpers, spellcheck integration.**
- **Compare / diff two open documents** — `@codemirror/merge`; pure JS, no backend needed.

### Explicitly impossible backend-free

| NPP capability | Why it cannot work |
|---|---|
| Native plugin DLLs / Plugin Admin | No native code loading; requires a desktop wrapper. |
| Run external commands / NppExec / "Open in browser" shell integration | Needs a process or shell. |
| Whole-disk "Open with Notepad++", registry, shell context menu | OS-level integration. |
| True multi-window OS windows | Popup windows exist but are degraded; not an MVP claim. |
| Reading the OS "ANSI" codepage | Browsers do not expose the system codepage. Fall back to windows-1252 + explicit user choice. |

## 5. Browser capability matrix

Legend: ✅ supported · ⚠️ partial / with caveats · ❌ unavailable (fallback required)

**The Firefox and Safari columns are phase-2 planning, not MVP scope (D11).** They are kept
because the phase-2 work will need them, and because they explain *why* tier A is enough.

| Capability (API) | Chrome/Edge | Firefox | Safari / iOS | Fallback when unavailable |
|---|---|---|---|---|
| File pickers — `showOpenFilePicker` / `showSaveFilePicker` / `showDirectoryPicker` | ✅ 86+ | ❌ none; Mozilla position: *harmful* | ❌ all versions | Hidden `<input type="file">` for reads; `Blob` + `<a download>` for writes. No in-place save. |
| Persist a handle across reloads (handle in IndexedDB) | ✅ | ❌ | ❌ | Re-select file each session; keep content in OPFS. |
| OPFS — `navigator.storage.getDirectory()` | ✅ | ✅ 111+ | ✅ | `IndexedDB` blob store (slower, no in-place write). |
| Directory open → workspace | ✅ picker | ❌ | ❌ | `<input webkitdirectory>` (read-only snapshot). |
| Drag-drop file→handle | ✅ `getAsFileSystemHandle` | ⚠️ plain `File` only | ⚠️ plain `File` only | Standard `DataTransfer.files`. |
| WASM | ✅ | ✅ | ✅ | none needed |
| Web Workers | ✅ | ✅ | ✅ | Run work on main thread (degrades large-file ops). |
| Service worker / PWA install | ✅ | ✅ | ⚠️ iOS install is manual, storage evictable | App still works online-only, without offline caching. |
| Clipboard API (`navigator.clipboard`) | ✅ | ✅ | ⚠️ needs user gesture | `document.execCommand('copy')` legacy path. |
| File Handling API (OS "open with" for installed PWA) | ✅ | ❌ | ❌ | Upload / drag-drop only. |
| Encoding API (see §6) | ✅ | ✅ | ✅ | WASM decoder, or warn + lossy read. |
| Storage quota (`navigator.storage.estimate`) | ✅ | ✅ | ⚠️ quota can be aggressively cleared | Warn user; offer explicit export/backup. |

**Consequence for the MVP (as revised by D11):** Chromium is the only target, so the editing
loop *may* depend on Chromium-only capabilities — the File System Access pickers are the MVP
file path, not an enhancement.

**Device scope (D12, accepted 2026-10-12):** desktop. A phone or tablet is out of the MVP whatever
browser it runs — **Chrome for Android included** — and gets the S4 notice, because the pickers are
what the check tests for and mobile Chromium has none. Nothing in the code branches on the device.

**Consequence for phase 2:** the retrofit must not require re-architecting. Keep file I/O
behind a single module boundary (`src/file/file-io.ts`) so a tier-B implementation can be
dropped in without touching the editor or the UI, and keep the thin capability check from
Task 4 (S4) that reports "this browser is not supported yet" instead of throwing.

## 6. Text encoding matrix

The WHATWG Encoding API mandates a fixed label list (verified against MDN). Coverage
versus Notepad++'s character-set menu:

**Covered by `TextDecoder` / `TextEncoder` (no extra work):**
UTF-8, UTF-16LE/BE, windows-1250–1258, ISO-8859-2/3/4/5/6/7/8/10/13/14/15/16,
KOI8-R/U, IBM866, Macintosh, x-mac-cyrillic, windows-874 (TIS-620), GBK, GB18030,
Big5, EUC-JP, ISO-2022-JP, Shift_JIS, EUC-KR.

**NOT covered — needs WASM (phase-3 priority per D10), or an honest warning until then:**
- **UTF-32 (UCS-4) LE/BE** — not in the mandated list.
- **DOS/IBM codepages** (cp437, cp850, …) beyond IBM866.
- Autodetect of arbitrary legacy encodings (N++'s "Character sets → Autodetect").

**Trap to document in code:** the labels `iso-8859-1`, `latin1`, `cp819`, `us-ascii` and
`ascii` all **decode as windows-1252** per the standard. Notepad++ treats ISO-8859-1 and
Windows-1252 as distinct. Any "Latin-1" UI option must say so explicitly or it will silently
mis-decode C1-range bytes.

**Standing rule:** round-trip fidelity beats convenience. A file opened as windows-1252 must
save back as windows-1252 unless the user explicitly converts.

## 7. Per-browser fallback UX

| Tier | Browsers | Status | Behaviour |
|---|---|---|---|
| **A — full** | Chrome, Edge, Opera | **MVP (D11)** | Native pickers; Save writes in place; recent files reopen by handle; directory workspaces; drop-to-open. |
| **B — degraded but complete** | Firefox | Phase 2 | Open via file input, save via download, "Save" = re-download with a persistent OPFS working copy so nothing is lost between edits. Banner explains the difference once. |
| **C — most degraded** | Safari, iOS, iPadOS | Phase 2 | Same as B; plus storage-eviction warning and an "Export backup" action. No file handling, no picker. |
| **D — devices** | Phones and tablets, *any* browser (Chrome for Android included) | **Out of the MVP (D12)** | The S4 notice. Not a behaviour tier: it is a ruling about the device, and the reason is Task 7's — a mobile browser evicts an origin's storage aggressively enough that §8's "your unsaved work is still there when you come back" is not a promise this port can keep there. Phase 2 material if that story changes. |

Capability detection stays a single module (`src/platform/capabilities.ts`, built in Task 4)
that feature-tests rather than sniffs user-agent strings. In the MVP it only needs to answer
"are the File System Access pickers available?" so the app can show a clear unsupported-browser
message instead of throwing (S4); the tier B/C behaviour arrives in phase 2.

## 8. Acceptance criteria for the MVP

The MVP is done when, in **Chrome/Chromium on a desktop OS** (D11; devices are out — D12):

1. A user can create, edit, and save a text file without any network request after first load.
2. Open → edit → save round-trips a file byte-identically when no edits are made (CRLF and CRLF+BOM included).
3. All Tier 1 features in §4 pass their manual check in Chrome.
4. A 50k-line file opens, scrolls, and regex-searches without a main-thread stall > 200 ms.
5. Session restore returns the exact tabs, caret positions, and scroll offsets.
6. Unsupported browsers fail loudly, not silently: a browser without the required capabilities
   shows an explicit message, and no code path loses data without telling the user.

## 9. Risks

| ID | Risk | Mitigation |
|---|---|---|
| R1 | Legacy encodings mis-decode silently | Only offer the §6 covered set in the MVP; explicit "unknown bytes" warning. WASM conversion is now the **scheduled** mitigation (D10), not a maybe. |
| R2 | ~~Two CM6 views on one `EditorState` may not give clean split-view semantics~~ — **CLOSED 2026-10-06, risk confirmed real.** The spike reproduced it: views diverge *silently* (`a.state === b.state` before the dispatch, stale text in the second view after — no exception thrown) | Mitigated exactly as planned: independent states with a manual sync. `src/editor/split-view.ts` re-dispatches every document change to the peer views under `syncAnnotation`, and only the owner view carries `history()` so a document keeps one undo history. Evidence: `python3 scripts/spike-r2-split.py` → **PASS (12/12)**, write-up in `docs/r2-shared-state-spike.md` |
| R3 | CM6 normalises the document to a single line separator — **mixed per-line EOL is not preserved** (N++ shows "Mixed") | Detect and warn at load; store the original EOL style as document metadata; convert-on-save with a prompt. Per-line EOL fidelity is a genuine downgrade. |
| R4 | Printing without the native dialog's control over colour/line numbers | Ship a print stylesheet; document the limitation. |
| R5 | A canvas minimap is hand-rolled and may be slow on large files | Render throttled, viewport-relative; skip above a size threshold. |
| R6 | Browser storage eviction loses unsaved work | Auto-export reminder + `navigator.storage.persist()` request + explicit backup action. |
| R7 | UDL parity expectations | Publish the §4 Tier-3 limits up front; never call it "UDL-compatible". UDL is also explicitly ranked below D10. |
| R8 | **Chromium-only MVP means the non-Chromium paths are retrofitted later, which is usually when they get expensive** | Keep file I/O behind one module boundary and ship the capability check in Task 4 (S4); treat tier B/C as designed-but-deferred, not forgotten. Re-open D11 if the phase-2 estimate grows. |

## 10. Resolved decisions (history — was "open questions")

All four original open questions are now closed. Kept for the audit trail.

1. ~~Confirm D2 (CodeMirror 6 over Monaco)~~ — **RESOLVED 2026-09-25: accepted.** Analysis in `docs/editor-core-decision.md`.
2. ~~Confirm D7 — Run/exec and native plugins permanently out~~ — **RESOLVED 2026-09-25: accepted.**
3. ~~Tier 3 priority — UDL, or encoding/large-file handling?~~ — **RESOLVED 2026-09-25: encoding + large-file mode, recorded as D10.** UDL ranks below it.
4. ~~Firefox/Safari in the MVP acceptance gate, or Chromium-only first?~~ — **RESOLVED 2026-09-25: Chromium only, recorded as D11.** Non-Chromium support moves to phase 2.

## Sources

- Notepad++ repo & feature reference — `github.com/notepad-plus-plus/notepad-plus-plus`, `notepad-plus-plus.org` (v8.9.8, Scintilla-based, GPL).
- MDN File System API — generic file/directory access, OPFS description, handle serialisation into IndexedDB: `developer.mozilla.org/en-US/docs/Web/API/File_System_API`.
- MDN OPFS — Baseline *widely available*, cross-browser since March 2023: `.../Origin_private_file_system`.
- MDN `showSaveFilePicker()` — marked *Limited availability* / not Baseline; requires secure context + user activation: `.../Window/showSaveFilePicker`.
- caniuse `native-filesystem-api` — Firefox and Safari unsupported at all tested versions; Mozilla standards position *harmful* (`mozilla/standards-positions` issue #154).
- MDN Encoding API Encodings — the mandated label table used for §6: `.../Encoding_API/Encodings`.
- CodeMirror 6 reference — `rectangularSelection()`/`crosshairCursor()` documented in `@codemirror/view`; `StreamLanguage` for runtime stream parsers in `@codemirror/language`; `EditorStateConfig.lineSeparator`: `codemirror.net/docs/ref/`.
- npm versions checked live on 2026-09-25: `codemirror@6.0.2`, `@codemirror/state@6.7.6`, `@codemirror/view@6.43.13`, `@codemirror/language@6.12.4`, `@codemirror/legacy-modes@6.5.4`, `@codemirror/search@6.7.2`, `@codemirror/rectangular-selection@0.19.2`, `monaco-editor@0.57.0`.
- Replit engineering blog, "Betting on CodeMirror" — bundle-size measurements for Monaco (51.17 MB raw / 5.01 MB gz) vs CodeMirror (8.23 MB raw / 1.26 MB gz) and the no-lazy-loading limitation.
