# Scope & Browser Compatibility Matrix

**Deliverable:** Task 1 of the Notepad++ Web Edition plan.
**Status:** D7 accepted (user-confirmed 2026-09-25). **D2 under review** — see
`docs/editor-core-decision.md`. D1, D3–D6, D8–D9 still need a yes/no.
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

## 2. Non-goals

- Not a 1:1 port of Notepad++/Scintilla. Behaviour is *aligned*, not identical.
- No backend, no server-side rendering, no cloud sync in the MVP.
- No native plugin (`.dll` / Plugin Admin) compatibility — see §5.
- Windows-only integration (registry, shell context menu, GPG release flow) is out of scope.

## 3. Decisions to confirm

| ID | Decision | Rationale |
|----|----------|-----------|
| **D1** | **Browser-first SPA/PWA.** Desktop packaging (Tauri/Wails/Electron) deferred to a later phase. | Answers open question 1 in the plan. Desktop wrappers can reuse the same bundle later, so this is not a one-way door. |
| **D2** | **Editor core: CodeMirror 6** (not Monaco). | Monaco is monolithically loaded (no lazy loading) and Replit measured it at 51.17 MB raw / 5.01 MB gzip vs CM6 + all languages at 8.23 MB raw / 1.26 MB gzip. CM6 is modular, its syntax tree powers Function List and folding for free, and `StreamLanguage` lets us build runtime-defined tokenizers — the only credible path to UDL parity. Monaco's minimap is the one thing we lose; a canvas minimap is a Tier-3 substitute. |
| **D3** | **Two-tier file I/O, capability-detected at runtime.** Tier A (Chromium): File System Access pickers, real in-place save. Tier B (Firefox/Safari/iOS): `<input type=file>` read + Blob download write, with OPFS as the editable home. | Pickers are Chromium-only and Mozilla's standards position is formally *harmful*, so a single-API implementation would exclude ~30% of users. |
| **D4** | **Encoding: what the Encoding API gives us, and be honest about the rest.** | The WHATWG label list is fixed; UTF-32 and DOS/IBM codepages are absent. See §6. |
| **D5** | **"Plugins" = runtime-loaded ES modules** against a documented host API, plus WASM. No native ABI. | The only backend-free option. Chromium can load them from a user-picked local folder; elsewhere, paste-source install. |
| **D6** | **Macro recording = editor transaction recording**, not OS input replay. | CM6 exposes every change as a transaction, so record/replay/run-N-times is genuinely feasible without native hooks. |
| **D7** | **Run/exec features (NppExec-style, external tools) are out of scope.** | Requires a process/shell. Impossible backend-free; would need a desktop wrapper. |
| **D8** | **Persistence: OPFS for document bodies, IndexedDB for metadata/preferences.** Handles are also storable in IndexedDB, which is what makes Tier A "recent files" work. | OPFS is Baseline widely available (since March 2023) across Chromium/Firefox/Safari. |
| **D9** | **MVP language set: ~20 first-class languages** (official CM6/Lezer packages) **+ the long tail via `@codemirror/legacy-modes`** ports. UDL via `StreamLanguage` is Tier 3. | NPP claims ~90 languages; official CM6 packages cover the popular set with better parsing, legacy-modes covers breadth. |

## 4. Feature tiers

### Tier 1 — MVP (must ship)

| Notepad++ feature | Web implementation | Confidence |
|---|---|---|
| Multi-document tabs | Custom tab strip; one `EditorState` per doc | High |
| Open / Save / Save As | Tier A pickers, Tier B input+download (D3) | High |
| New document, dirty indicator, close prompt | App state + `beforeunload` guard | High |
| Find / Replace: regex, match case, whole word, wrap, replace-all | `@codemirror/search` `SearchQuery` + custom N++-style dialog | High |
| Go to line | `EditorView.dispatch` selection jump | High |
| Undo / redo, unlimited | `@codemirror/commands` history | High |
| Line numbers, current-line highlight, active-line gutter | `@codemirror/view` | High |
| Word wrap toggle, whitespace/special-char display, EOL display | `EditorView.lineWrapping`, `highlightSpecialChars` | High |
| Zoom in/out (Ctrl+±, Ctrl+wheel) | Editor theme font-size facet | High |
| Syntax highlighting | CM6 language packages (D9) | High |
| Code folding | Fold gutter + language fold service | High |
| Multi-cursor & column/rectangular selection | CM6 core ships `rectangularSelection()` + `crosshairCursor()` | High |
| Auto-indent, tab/space config, tab size | `indentUnit`, `indentOnInput`, language indent service | High |
| EOL conversion (CRLF/LF/CR) | `EditorState.lineSeparator` + document-wide re-write | Medium — see R3 |
| Case conversion (UPPER/lower/Title), duplicate/delete/move/sort lines, trim trailing whitespace, remove blank/duplicate lines | Pure JS line operations over the doc | High |
| Session restore (open tabs, caret, scroll) | OPFS + IndexedDB (D8) | High |
| Recent files | Tier A: stored handles. Tier B: names only | Medium |
| Dark mode / themes | CM6 theme, N++-style palette | High |
| Line ending + encoding + language indicator in status bar | Status bar component | High |
| Keyboard shortcuts matching N++ defaults | Custom keymap | High |

### Tier 2 — should-have (phase 2)

| Feature | Web implementation | Notes |
|---|---|---|
| Split view (two panes) | Second `EditorView` on the same `EditorState` | **Needs a spike** — verify two views on one state behave as required (R2) |
| Clone document to other view | As above, sharing state | Same spike |
| Bookmarks (toggle/goto/clear) | Custom `StateField` + gutter markers | High |
| Mark all / highlight matches / incremental highlight | Decoration plugin | High |
| Function List panel | Walk the CM6 syntax tree | High |
| Column/block edit mode UI (Alt-drag, Alt+Shift+arrows) | `rectangularSelection` + keymap | High |
| Document map (minimap) | Canvas render of doc + viewport box | Medium — hand-rolled |
| Auto-completion (word-from-document, HTML/XML close tags) | `@codemirror/autocomplete` | High |
| Drop files onto window to open | `DataTransferItem.getAsFileSystemHandle()` (Chromium), `File` API elsewhere | High |
| Print | `window.print()` + print stylesheet | Medium — degraded vs N++ (R4) |
| Macro record / replay / save with shortcut | Transaction recording (D6) | Medium |
| PWA install + offline | Service worker + manifest | High |
| Multi-select-all-matches, multi-caret editing | CM6 supports multiple ranges natively | High |

### Tier 3 — nice-to-have / exploratory

- **User Defined Language (UDL)** — N++'s UDL2 XML parsed into a CM6 `StreamLanguage`. Keyword lists, comments, operators map cleanly; folder/keyword nesting and delimiters only partially. Best-effort parity, not exact.
- **Plugin host API** — sandboxed ES module loader with a documented `hostAPI` (commands, decorations, panels, dialogs).
- **Large-file mode** — disable expensive extensions above a threshold.
- **Encoding conversions requiring WASM** (UTF-32, DOS codepages) — see §6.
- **Column sort dialog, advanced regex helpers, spellcheck integration.**
- **Compare / diff two open documents** — pure JS diff, no backend needed.

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

**Consequence:** the app must be designed so that *nothing in the editing loop depends on a
capability that is Chromium-only*. Pickers are an enhancement; OPFS/IndexedDB is the baseline.

## 6. Text encoding matrix

The WHATWG Encoding API mandates a fixed label list (verified against MDN). Coverage
versus Notepad++'s character-set menu:

**Covered by `TextDecoder` / `TextEncoder` (no extra work):**
UTF-8, UTF-16LE/BE, windows-1250–1258, ISO-8859-2/3/4/5/6/7/8/10/13/14/15/16,
KOI8-R/U, IBM866, Macintosh, x-mac-cyrillic, windows-874 (TIS-620), GBK, GB18030,
Big5, EUC-JP, ISO-2022-JP, Shift_JIS, EUC-KR.

**NOT covered — needs WASM (Tier 3) or an honest warning:**
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

| Tier | Browsers | Behaviour |
|---|---|---|
| **A — full** | Chrome, Edge, Opera | Native pickers; Save writes in place; recent files reopen by handle; directory workspaces; drop-to-open. |
| **B — degraded but complete** | Firefox | Open via file input, save via download, "Save" = re-download with a persistent OPFS working copy so nothing is lost between edits. Banner explains the difference once. |
| **C — most degraded** | Safari, iOS, iPadOS | Same as B; plus storage-eviction warning and an "Export backup" action. No file handling, no picker. |

Capability detection must be a single module (`src/platform/capabilities.ts`, built in Task 4)
that feature-tests rather than sniffs user-agent strings.

## 8. Acceptance criteria for the MVP

The MVP is done when, in Chrome **and** Firefox:

1. A user can create, edit, and save a text file without any network request after first load.
2. Open → edit → save round-trips a file byte-identically when no edits are made (CRLF and CRLF+BOM included).
3. All Tier 1 features in §4 pass their manual check on both browsers.
4. A 50k-line file opens, scrolls, and regex-searches without a main-thread stall > 200 ms.
5. Session restore returns the exact tabs, caret positions, and scroll offsets.
6. Every capability in §5 marked ❌ on the test browser takes its documented fallback path with no crash and no silent data loss.

## 9. Risks

| ID | Risk | Mitigation |
|---|---|---|
| R1 | Legacy encodings mis-decode silently | Only offer the §6 covered set in the MVP; explicit "unknown bytes" warning; WASM in Tier 3. |
| R2 | Two CM6 views on one `EditorState` may not give clean split-view semantics | Timeboxed spike at the start of Task 3; if it fails, fall back to independent states with a manual sync. |
| R3 | CM6 normalises the document to a single line separator — **mixed per-line EOL is not preserved** (N++ shows "Mixed") | Detect and warn at load; store the original EOL style as document metadata; convert-on-save with a prompt. Per-line EOL fidelity is a genuine downgrade. |
| R4 | Printing without the native dialog's control over colour/line numbers | Ship a print stylesheet; document the limitation. |
| R5 | A canvas minimap is hand-rolled and may be slow on large files | Render throttled, viewport-relative; skip above a size threshold. |
| R6 | Browser storage eviction loses unsaved work | Auto-export reminder + `navigator.storage.persist()` request + explicit backup action. |
| R7 | UDL parity expectations | Publish the §4 Tier-3 limits up front; never call it "UDL-compatible". |

## 10. Open questions needing your decision

1. **Confirm D2 (CodeMirror 6 over Monaco).** Full advantages/drawbacks analysis with sources:
   `docs/editor-core-decision.md`. Headline: CM6 wins on payload (1.26 MB gz vs 5.01 MB), mobile
   (Monaco is officially unsupported on mobile browsers), CSS theming to an N++ look, multiple
   independently-configured instances, plugin hosting, and viewport rendering for large files.
   Monaco's only real wins here are its built-in minimap and diff editor — both Tier 3, both
   substitutable. Reversal trigger: if Minimap **and** Compare are MVP requirements on a
   Chromium-only target, Monaco becomes the cheaper route.
2. ~~**Confirm D7** — accepting that Run/exec and native plugins are permanently out.~~
   **RESOLVED 2026-09-25: user confirmed D7.** Run/exec, NppExec, external tools and native
   plugin DLLs are permanently out of scope.
3. **Tier 3 priority** — UDL support, or better encoding/large-file handling? Only one fits phase 3.
4. **Firefox/Safari in the MVP acceptance gate, or Chromium-only first?** Including them roughly doubles the file-I/O test matrix. Recommendation: keep them, since D3 exists precisely for them.

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
