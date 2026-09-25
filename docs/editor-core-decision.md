# D2 — Editor Core: CodeMirror 6 vs Monaco

**Decision under review:** D2 in `docs/scope.md` §3 — use CodeMirror 6 (CM6) as the editor core
rather than Monaco.
**Status:** Recommendation below, **awaiting your confirmation.** D2 blocks Task 3, not Task 2.
**Written:** 2026-09-25. Every factual claim is attributed in [Sources](#sources).

---

## 0. How to read this

Two things make this comparison unusual:

1. **We are not building VS Code.** IntelliSense, a command palette, sticky scroll and a language
   server are Monaco's headline strengths and **none of them are Notepad++ features**. Weighting
   them heavily would be a category error.
2. **Monaco's "batteries included" is also its cost.** Out-of-the-box polish you must then fight
   to remove is not a free win — Sourcegraph's migration write-up is essentially a list of exactly
   that fight.

So the tables below carry a **weight for this project** column. A disadvantage weighted *Low* is
not being hidden; it is being priced.

---

## 1. Recommendation

**Keep CodeMirror 6.** It wins on the axes this project is actually built on — bundle size, mobile,
styling to a Notepad++ look, multiple independently-configured editor instances, plugin hosting,
and main-thread behaviour on large files. Monaco wins on four built-in widgets, only two of which
we want (Minimap, Compare), both of which are Tier 3 in `docs/scope.md` and both of which have
viable CM6 substitutes.

**Reversal trigger, stated plainly:** if this becomes a Chromium-only desktop-class app and you
insist on Document Map *and* Compare in the MVP, Monaco is the cheaper route. Otherwise CM6.

---

## 2. Advantages of choosing CodeMirror 6 over Monaco

| # | Advantage | Evidence | Weight here |
|---|-----------|----------|-------------|
| A1 | **~4× smaller shipped payload.** CM6 + all extensions and language packages = 8.23 MB raw / **1.26 MB gzip**; Monaco = 51.17 MB raw / **5.01 MB gzip** (Replit). Sourcegraph measured Monaco at **2.4 MB of their 6 MB** search-page JS (40% of all JS); dropping it cut their JS download **43%**. | Replit blog; Sourcegraph blog | **High** — a PWA's first load is the app's install experience |
| A2 | **Mobile/touch actually works.** Monaco's own project page states: *"The Monaco editor is not supported in mobile browsers or mobile web frameworks."* CM6 was rewritten around native browser editing (contentEditable) specifically to support touch — that was a stated motivation for the 6.0 rewrite, and it's why Replit standardised on it. | microsoft.github.io/monaco-editor; Replit blog | **High** — Notepad++ is desktop-only; a web port's genuinely new audience is phones/tablets |
| A3 | **You can style it to look like Notepad++, using CSS.** CM6 themes are ordinary CSS with variables. Sourcegraph on Monaco: to customise its look they *"had to hard-code hex color codes into our JavaScript instead of being able to use our site-wide CSS classes and variables."* | Sourcegraph blog | **High** — the goal is N++ chrome (menu, toolbar, tab bar, status bar), not a VS Code clone |
| A4 | **Multiple instances with different configuration are trivial.** Sourcegraph: *"Monaco has a global reference model, which makes it tricky to run several instances of it on the same page with small configuration differences."* CM6 is `EditorState` per document + `EditorView` per pane. | Sourcegraph blog | **High** — tabs each need their own language/config; split view needs a second view |
| A5 | **The plugin host (D5) is the native extension model, not a bolt-on.** CM6 *is* a composition of extensions, so an in-app plugin API is a thin wrapper over first-class concepts. VS Code extensions do **not** run inside Monaco — Monaco gives you its API, not an ecosystem. | CM6 reference; Monaco docs | **High** — D5 is a committed project goal |
| A6 | **No web workers, no build plugin.** CM6 is plain ESM and tree-shakes under plain Vite. Monaco needs worker bundling plus a plugin (`monaco-editor-webpack-plugin`, `vite-plugin-monaco-editor-esm`) and has well-known ESM/worker resolution pitfalls in Vite that people paper over with pins and shims. | vite discussion #21426; monaco official | **Medium** — build friction + extra worker files for the service worker to cache |
| A7 | **Large documents are a design goal, not a flag.** CM6 renders only the viewport and parses incrementally; the official million-line example loads a document of millions of lines and highlights only as far as you scroll. Monaco *does* ship `largeFileOptimizations` (default on) and `maxTokenizationLineLength` (20000) — a real advantage — **but** Monaco's tokenizer is Monarch running on the main thread, and a VS Code maintainer confirmed VS Code's newer async tokenization *"not the monaco editor, as it uses monarch."* | codemirror.net/examples/million/; Monaco typedoc; microsoft/monaco-editor#2054 | **Medium-High** — "opens huge files fast" is a core N++ bragging right, and it's the closest of these calls |
| A8 | **Accessibility was an explicit design goal.** CM6's 6.0 rewrite "aims to be more extensible and accessible than previous versions", with initial work funded by Germany's Prototype Fund. | Marijn Haverbeke's 6.0 announcement | **Medium** |
| A9 | **Documentation you can answer questions from.** Sourcegraph: *"Monaco's documentation is not great, so we couldn't always figure out if it was possible to make it do what we needed."* Replit: Monaco's *"API is not the most stable and has subtle changes"*, still no v1.0 semver. CM6's reference is dense but complete and its API has been stable since 6.0. | Sourcegraph blog; Replit blog | **Medium** — solo development means doc quality converts directly into velocity |
| A10 | **Language breadth is not the gap people assume.** `@codemirror/legacy-modes` ports the CodeMirror 5 mode catalogue (1.96 MB unpacked) — the plausible route to matching N++'s claimed ~90 languages beyond the ~20 first-class Lezer packages (D9). Monaco also ships a large built-in set (Monarch-based). | npm; scope D9 | **Low-Medium** — both are adequate; depth of any single language is the real question |
| A11 | **Proven in exactly our shape of product.** Replit (IDE), Sourcegraph (search/notebook/file viewer), and Chrome DevTools' editor migration were all motivated by the same size/mobile/modularity pressures we face. | Replit; Sourcegraph | **Low-Medium** — precedent, not proof |

---

## 3. Disadvantages of choosing CodeMirror 6 (what Monaco would have given us)

| # | Drawback | Detail | Weight here | Mitigation |
|---|----------|--------|-------------|------------|
| B1 | **No built-in minimap** → Notepad++'s *Document Map* has no first-party CM6 equivalent. | The only off-the-shelf option is `@replit/codemirror-minimap@0.5.2` — third-party and pre-1.0, i.e. same maintenance risk class as any small dependency. Monaco's minimap is built in and free. | **Medium** | Canvas minimap (~150 lines, already Tier 3 in scope / risk R5), or pin the package behind our own thin wrapper. **Do not promise Document Map in the MVP.** |
| B2 | **No built-in diff editor** → Notepad++'s Compare plugin. | Monaco's diff editor ships in the box. CM6's is a separate package, `@codemirror/merge@6.12.2`. | **Low-Medium** | Use `@codemirror/merge`. Official-scope package, so lower risk than B1. No MVP promise. |
| B3 | **No zero-config language services** (TypeScript/JSON/CSS/HTML diagnostics + completion via workers). | Monaco gets these for free. CM6 requires wiring: `@codemirror/lsp-client@6.3.0` now exists officially, plus community `codemirror-languageserver`. | **Low** — this is the important one to price correctly | **Notepad++ has no IntelliSense either.** Its completion is word-from-document. Since parity with N++ is the goal, this is a non-feature, and a language *server* implies a backend, which D1 forbids. Word completion via `@codemirror/autocomplete` is all we need. |
| B4 | **Bus factor and funding.** | CM6 is primarily one very capable maintainer (Marijn Haverbeke) plus community; its site states a social-but-not-legal expectation that commercial users fund maintenance. Monaco is Microsoft-backed and structurally tied to VS Code's survival. | **Medium** | MIT licence + vendorable source means an unmaintained CM6 keeps working; the API is stable, so "frozen" ≠ "broken". Donate via thanks.dev if this becomes commercial. This is a real, non-zero risk — accepted knowingly, not waved away. |
| B5 | **Smaller ecosystem noise floor.** | Monaco: ~38k GitHub stars, ~2M weekly npm downloads. CM6: ~7.5k stars, ~5M weekly downloads. Stars favour Monaco; actual installs favour CM6. Fewer blog posts and StackOverflow answers for CM6. | **Low-Medium** | CM6 has a responsive forum/Discord; the complete reference manual compensates (A9). |
| B6 | **You assemble the shell yourself.** | Tabs, dialogs, panels, keymaps, gutters, context menus, find UI: Monaco hands you a VS Code-like shell. CM6 hands you bricks. Also a steeper architecture to learn (facets, state fields, transactions). | **Medium** | The shell Monaco gives is *not* the shell we want (A3), so this is work we'd do anyway — but it is real, additional code, and it lands in Tasks 3–5. Budget for it rather than being surprised. |
| B7 | **No productised large-file switch.** | Monaco has `largeFileOptimizations` + `maxTokenizationLineLength`. CM6 has no equivalent flag; you degrade your own extensions above a threshold (already scoped as Tier-3 "large-file mode"). | **Medium** | Implement the threshold ourselves and spike the million-line example early (adds to R2/R5 work). |
| B8 | **A few Monaco conveniences need packages.** | Bracket-pair colourisation, sticky scroll, fold gutters, placeholder text, word-based suggestions: some built in with Monaco, extensions with CM6. (Sourcegraph also hit a long-standing Monaco limitation on placeholder text — so this cuts both ways.) | **Low** | All covered by `@codemirror/language`, `@codemirror/autocomplete`, `@codemirror/view`; a few lines each. |

**Sticker-shock summary of §3:** the honest cost of choosing CM6 is *more assembly work* (B6),
*three third-party/absent widgets* (B1, B2 + large-file mode B7), and a *smaller maintenance
safety net* (B4). Nothing in §3 is a functional dead end.

---

## 4. Head-to-head on the features this project actually needs

| N++ feature (scope tier) | CodeMirror 6 | Monaco | Edge |
|---|---|---|---|
| Multi-document tabs (T1) | `EditorState` per doc, cheap | 1 model per doc; models need explicit disposal | CM6 |
| Split view / clone to other view (T2) | Second `EditorView` over one state — **verify in spike (R2)** | Multiple editors sharing one model; proven at VS Code scale | Monaco (slightly) |
| Find/replace + regex (T1) | `@codemirror/search`; N++-style dialog is custom | Built-in find widget; N++-style dialog still custom | Tie |
| Bookmarks, mark-all (T2) | Custom state field + gutters | Custom decorations | Tie |
| Folding, line numbers, current line (T1) | Fold gutter + language fold service | Built in | Tie |
| Syntax highlighting, ~90 languages (T1) | ~20 Lezer packages + `legacy-modes` | Large built-in Monarch set | Tie |
| Multi-cursor & column/rectangular selection (T1) | `rectangularSelection()` in core `@codemirror/view` | Built in, very mature | Monaco (slightly) |
| Word completion from document (T2) | `@codemirror/autocomplete` | `wordBasedSuggestions` default on | Tie |
| **Document Map / minimap (T2/T3)** | Third-party pre-1.0, or canvas | **Built in** | **Monaco** |
| **Compare / diff (T3)** | `@codemirror/merge` | **Built in** | **Monaco** |
| Function List (T2) | Walk the Lezer syntax tree directly | Write a `DocumentSymbolProvider` | CM6 |
| User Defined Language (T3) | `StreamLanguage` (runtime stream parsers) | Monarch (declarative runtime tokenizer) | Tie — both need a UDL2 XML converter |
| Macro record / replay (T2) | Record transactions — clean | Record model content deltas — workable | Tie |
| Large-file handling (T3) | Viewport rendering; **no flag** | **`largeFileOptimizations` flag**; Monarch on main thread | Monaco (slightly) |
| Theming to N++ palette (T1) | Plain CSS + variables | Hardcoded hex, per Sourcegraph | CM6 |
| Plugin host API (D5) | Composition model = native | Its own API only, no ecosystem | **CM6** |
| Mobile / touch | Designed for it | **Officially unsupported** | **CM6** |
| PWA offline payload | 1.26 MB gz | 5.01 MB gz + worker bundles | CM6 |
| LSP-grade IntelliSense | `@codemirror/lsp-client`, wiring needed | Built in | Monaco — **but N++ has no such feature (B3)** |

**Tally of features we want:** CM6 takes tabs, function list, theming, plugins, mobile, payload and
styling; Monaco takes minimap, diff, and close calls on split view / column select / large-file
defaults — precisely the set weighted Medium or below, and three of them are Tier 3.

---

## 5. What would reverse this decision

1. MVP must include **Document Map and Compare**, and hand-rolling a minimap is unacceptable → Monaco.
2. Target is **Chromium-only desktop-class** usage, making A2 (mobile) and A1/A6 (payload, workers) irrelevant → the gap narrows to roughly a tie.
3. **IntelliSense becomes a headline goal** (contradicting N++ parity and D1's no-backend rule) → Monaco.
4. CM6's maintenance (B4) deteriorates — e.g. an extended period of no releases across the `@codemirror/*` scope.

None of these hold today.

---

## 6. Cost attached to the recommendation

Choosing CM6 obliges us to do the following, already reflected in the scope:

- **Implement a canvas minimap** or pin a pre-1.0 third-party one (B1) — Tier 3, no MVP promise.
- **Use `@codemirror/merge` for Compare** rather than a built-in diff (B2) — Tier 3.
- **Build our own large-file mode** and spike the million-line case early (B7, R2) — Tier 3.
- **Budget extra assembly work** in Tasks 3–5 for chrome Monaco would have supplied (B6).
- **Treat the maintainer funding ask** as a real obligation if this goes commercial (B4).

## Sources

- **Replit**, *Betting on CodeMirror* — CM6 8.23 MB / 1.26 MB gz vs Monaco 51.17 MB / 5.01 MB gz; "lazy-loading features are not possible"; CM6's touch motivation and contentEditable basis.
- **Replit**, *Comparing Code Editors: Ace, CodeMirror and Monaco* — Monaco API instability, no v1.0 semver.
- **Sourcegraph**, *Migrating from Monaco Editor to CodeMirror* — Monaco = 2.4 MB / 40% of their JS, 43% download reduction after removal; hard inability to trim; poor docs; global reference model hindering multiple instances; CSS theming requiring hardcoded hex; placeholder-text limitation; CM6 described as composable ("playing with lego"); the commercial funding ask.
- **microsoft.github.io/monaco-editor** — "The Monaco editor is not supported in mobile browsers or mobile web frameworks."
- **Monaco editor typedoc** — `IGlobalEditorOptions.largeFileOptimizations` (default `true`), `maxTokenizationLineLength` (default 20000).
- **microsoft/monaco-editor#2054** — whole-document tokenization cost; maintainer comment that VS Code's async tokenization is *not* in Monaco because Monaco uses Monarch.
- **codemirror.net/docs/ref/** — `rectangularSelection()` / `crosshairCursor()` in `@codemirror/view`; `StreamLanguage` in `@codemirror/language`; `EditorStateConfig.lineSeparator`.
- **codemirror.net/examples/million/** — million-line document rendering.
- **Marijn Haverbeke**, *CodeMirror 6.0* (June 2022) — extensibility and accessibility goals; Prototype Fund funding.
- **vitejs/vite discussion #21426** and the `vite-plugin-monaco-editor-esm` docs — Monaco worker/ESM resolution problems in Vite; shared-worker language constraints.
- **npm versions checked live 2026-09-25:** `@codemirror/lsp-client@6.3.0`, `@codemirror/merge@6.12.2`, `@replit/codemirror-minimap@0.5.2`, `@codemirror/legacy-modes@6.5.4` (1.96 MB unpacked), `@codemirror/autocomplete@6.20.3`, `codemirror-languageserver@1.22.1`, `monaco-editor@0.57.0`.
- **pkgpulse** comparison table — GitHub stars (Monaco ~38k vs CM6 ~7.5k) and weekly npm downloads (Monaco ~2M vs CM6 ~5M).
