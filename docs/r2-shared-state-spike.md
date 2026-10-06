# R2 spike — two CodeMirror 6 views over one document

**Risk R2** (`docs/scope.md` §12) said split view and "clone to other view" were
designed as *"a second `EditorView` over one `EditorState`"* and flagged that
assumption as **unverified**. This document is the verification. It was done as a
timeboxed spike **before** the tab strip and split-view UI were written, so the UI
could be built on a known-good mechanism — which is what the ledger's "Next action"
demanded.

**Verdict: split view and clone-to-other-view are supported, but the original
wording was wrong, and the correction is load-bearing.**

## 1. The assumption was wrong in a specific way

> "Though it is possible to create multiple views from a single editor state, those
> views will not, by themselves, stay in sync. States are immutable values, and their
> updated forms held in the different views will simply diverge."

— official CodeMirror 6 example *Split View*, <https://codemirror.net/examples/split/>
(fetched 2026-09-25)

So "one `EditorState`, two views" does **not** give a shared document. The two views
diverge on the first edit. The spike reproduced this deliberately as a control group:
typing `_NAIVE_DIVERGENCE` into the first of two naive views left the second view's
text byte-identical to its initial text (`b_unchanged: true`).

The supported shape — and the one now implemented — is:

| Property | How |
|---|---|
| Shared document | two states; every document-changing transaction is re-dispatched to the peer views with an annotation |
| One undo history per document (like N++) | only the **owner** view has `history()`; the clone has none and binds `Mod-z`/`Mod-y` to `undo`/`redo` **on the owner view** |
| No transaction ping-pong | `syncAnnotation` marks forwarded transactions and they are never forwarded again |
| Per-view caret and scroll | selection and scroll are deliberately *not* forwarded |
| Views can come and go | the dispatcher resolves its peers at dispatch *time* (`runtime.views`), not from closed-over view objects — required because tabs, documents and the split all open and close at runtime |

Implementation: `src/editor/split-view.ts`; states and keymaps: `src/editor/notepadpp-config.ts`.

## 2. Measured evidence

Harness: `src/editor/spike-r2.ts` (dev-only, not in the bundle), driven by
`scripts/spike-r2-split.py` — real Chrome via Playwright, real keystrokes.

```
python3 scripts/spike-r2-split.py    →  R2_SPIKE: PASS   (exit 0)
```

| Check | Result |
|---|---|
| control: two views, one state, no sync → documents diverge | ✅ diverged (`b` unchanged) |
| type in owner → clone's **state** has the text | ✅ |
| type in owner → clone's **rendered pixels** show the text | ✅ (also confirmed by OCR of the screenshot) |
| type in clone → owner's state and pixels | ✅ |
| `Ctrl+Z` in the clone → undoes the shared edit in both | ✅ one step, whole 18-character edit |
| `Ctrl+Y` in the clone → re-applies in both | ✅ |
| editing the owner does not scroll the clone | ✅ clone `scrollTop` 0 → 0 while the owner scrolled 707 |
| per-view scroll | ✅ owner 707 → 120, clone unchanged at 0 |
| per-view selection | ✅ owner anchor 3924 vs clone 70 |
| no feedback loop | ✅ 148/149 dispatches for ~150 keystrokes (≈1 per view per keystroke) |
| console errors | ✅ none |

Screenshot: `.hermes/cache/screenshots/spike-r2-split-view.png` (git-ignored).

## 3. Nuance found while measuring: undo granularity across panes

CM6's history merges consecutive same-user-event transactions that arrive within
`HistoryConfig.newGroupDelay` (default **500 ms**). Measured across the two panes:

| Spacing between an edit in the owner and an edit in the clone | Result of one `Ctrl+Z` |
|---|---|
| 50 ms | both edits undone in one step |
| 120 ms | both edits undone in one step |
| 600 ms | only the clone's edit undone |

This is the same rule CM6 applies to fast typing within one view, and it is *not*
a defect of the forwarding design — but it must be stated, because the first spike
run failed an assertion for exactly this reason (its two typing phases were 120 ms
apart, so one undo removed both panes' edits). The acceptance check therefore spaces
its phases 700 ms apart, so it tests the mechanism rather than timing luck.

## 4. What this settles, and what it does not

**Settled (R2 closed):** a document can be shown in two panes with one undo history,
per-view caret and scroll, and pixel-correct rendering — so split view and
clone-to-other-view are buildable as specified, at the cost of the pairing logic
above.

**Not settled / carried forward:**

- **Fold state is not forwarded.** `foldGutter()` is installed, but folding is
  state in the *language* extension and would need its fold effects forwarded like
  document changes. There is nothing to fold yet — Task 6 adds the languages — so
  this is deferred to Task 6 rather than shipped unverifiable.
- **Promotion loses history.** If the pane holding a document's owner view is closed
  while a clone survives, the surviving view is promoted by rebuilding a state with
  `history()` from the same text: text and caret survive, undo history does not.
  Documented in the code, not hidden.
- **Selection sync was decided against.** N++ gives each view its own caret; the
  clone therefore has an independent caret, unlike VS Code's linked panes.

Linked from `PROGRESS.md` (decision `S5`, status board row 3) and referenced by
`docs/scope.md` §12 (risk R2 status).
