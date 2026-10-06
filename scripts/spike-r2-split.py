"""R2 spike — can two CodeMirror 6 views present one document as N++ split view?

Run BEFORE the tab strip / split-view UI was written, and keep running it after:
this is the executable evidence for risk R2 (`docs/scope.md` §12) and for the
mechanism in `src/editor/split-view.ts`.

What it does: loads the dev server, mounts `src/editor/spike-r2.ts` (two views over
one document via the production sync dispatcher, plus a naive unsynced control
pair), then drives **real Chrome keystrokes** and measures:

  1. control  — two views on one state, no sync: documents DIVERGE (why the sync
                mechanism is needed at all — the CM6 docs' claim, reproduced);
  2. forward  — typing in the owner view shows up in the clone, state AND pixels;
  3. backward — typing in the clone shows up in the owner, state AND pixels;
  4. undo     — Ctrl+Z in the clone undoes exactly the last shared edit, in both
                views (one history per document, like N++'s clone-to-other-view);
  5. redo     — Ctrl+Y in the clone re-applies it in both views;
  6. no scroll-jacking — editing one view does not scroll the other view;
  7. per-view selection and per-view scroll;
  8. no feedback loop  — dispatch counts stay ~1 per keystroke, not exploding;
  9. undo granularity when both panes are edited inside CM6's history group delay
     (recorded as data, not asserted — see docs/r2-shared-state-spike.md).

Prerequisites: `npm run dev` on http://127.0.0.1:5173, system Chrome + Python
Playwright. Exit code 0 = PASS, 1 = FAIL.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:5173/"
SHOT_DIR = Path(__file__).resolve().parent.parent / ".hermes" / "cache" / "screenshots"
SHOT = SHOT_DIR / "spike-r2-split-view.png"

FROM_SOURCE = "_SYNCED_FROM_OWNER"
FROM_CLONE = "_SYNCED_FROM_CLONE"
SCROLL_MARK = "_NO_SCROLL_JACK"
NAIVE_MARKER = "_NAIVE_DIVERGENCE"

# CM6's history merges consecutive same-user-event transactions that arrive close
# together (HistoryConfig `newGroupDelay`, default 500 ms). Phases that must become
# separate undo steps wait longer than that, so the assertions test the mechanism
# instead of timing luck.
GROUP_DELAY_MS = 700

messages: list[str] = []

SNAPSHOT = """() => {
  const h = window.__spikeR2;
  const lines = (sel) => Array.from(document.querySelectorAll(sel + ' .cm-line'))
    .map((l) => l.textContent).join('\\n');
  return {
    source: h.source.state.doc.toString(),
    clone: h.clone.state.doc.toString(),
    sourceDom: lines('#spike-source'),
    cloneDom: lines('#spike-clone'),
    sourceScroll: h.source.scrollDOM.scrollTop,
    cloneScroll: h.clone.scrollDOM.scrollTop,
    sourceSel: h.source.state.selection.main.anchor,
    cloneSel: h.clone.state.selection.main.anchor,
    counts: { ...h.counts },
  };
}"""


def main() -> int:
    SHOT_DIR.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.on(
            "console",
            lambda m: messages.append(f"console.{m.type}: {m.text}")
            if m.type in ("error", "warning")
            else None,
        )
        page.on("pageerror", lambda e: messages.append(f"pageerror: {e}"))

        response = page.goto(URL, wait_until="load")
        status = response.status if response else None

        # Mount the harness through Vite's module graph. The first import of a
        # dependency Vite has not pre-bundled forces it to optimise and reload the
        # page, destroying the execution context mid-evaluate — tolerate that here
        # rather than failing the spike for an unrelated reason.
        mounted = False
        for _ in range(4):
            try:
                page.evaluate(
                    "async () => { const m = await import('/src/editor/spike-r2.ts');"
                    " m.runSpikeR2(document.body); return true; }"
                )
                if page.evaluate("() => Boolean(window.__spikeR2)"):
                    mounted = True
                    break
            except Exception:
                pass
            page.wait_for_load_state("load")
            page.wait_for_timeout(500)
        if not mounted:
            raise RuntimeError("could not mount the R2 spike harness (Vite kept reloading?)")

        for pane in ("#spike-source", "#spike-clone", "#spike-naive-a", "#spike-naive-b"):
            page.wait_for_selector(f"{pane} .cm-editor", timeout=15000)

        def snap() -> dict:
            return page.evaluate(SNAPSHOT)

        initial = snap()

        # -- 1. control: no sync → divergence ---------------------------------
        page.click("#spike-naive-a .cm-content")
        page.keyboard.press("Control+End")
        page.keyboard.type(NAIVE_MARKER)
        naive = page.evaluate(
            """() => ({
                a: window.__spikeR2.naive.a.state.doc.toString(),
                b: window.__spikeR2.naive.b.state.doc.toString(),
                initial: window.__spikeR2.naive.initial,
            })"""
        )

        # -- 2. forward: type at the top of the owner view ---------------------
        # At the top of the document, so both viewports render the change and the DOM
        # assertion is about syncing rather than about scroll position.
        page.evaluate("() => { window.__spikeR2.source.scrollDOM.scrollTop = 0; }")
        page.click("#spike-source .cm-content")
        page.keyboard.press("Control+Home")
        page.keyboard.type(FROM_SOURCE)
        page.wait_for_timeout(GROUP_DELAY_MS)
        forward = snap()

        # -- 3. backward: type at the top of the clone -------------------------
        page.click("#spike-clone .cm-content")
        page.keyboard.press("Control+Home")
        page.keyboard.type(FROM_CLONE)
        page.wait_for_timeout(GROUP_DELAY_MS)
        backward = snap()

        # -- 4/5. undo and redo from the clone: one shared history -------------
        page.keyboard.press("Control+z")
        page.wait_for_timeout(150)
        undo_clone = snap()
        page.keyboard.press("Control+y")
        page.wait_for_timeout(150)
        redo_clone = snap()

        # -- 6. no scroll-jacking, then 7. per-view scroll --------------------
        page.evaluate(
            "() => { window.__spikeR2.source.scrollDOM.scrollTop = 0;"
            " window.__spikeR2.clone.scrollDOM.scrollTop = 0; }"
        )
        page.click("#spike-source .cm-content")
        page.keyboard.press("Control+End")
        before_jack = snap()
        page.keyboard.type(SCROLL_MARK)
        page.wait_for_timeout(GROUP_DELAY_MS)
        after_jack = snap()

        page.evaluate("() => { window.__spikeR2.source.scrollDOM.scrollTop = 120; }")
        page.wait_for_timeout(150)
        scrolled = snap()

        # -- 7b. selection stays per-view -------------------------------------
        page.click("#spike-clone .cm-content")
        page.keyboard.press("Control+Home")
        page.keyboard.press("ArrowDown")
        selection = snap()

        # -- 9. undo granularity across the two panes --------------------------
        # Recorded, not asserted: characterises how CM6's history groups an edit made
        # in one pane with a preceding edit made in the other. `newGroupDelay` is
        # 500 ms, so 600 ms is the "must be a separate step" case and the two short
        # spacings are inside the grouping window.
        granularity: list[dict[str, object]] = []
        for spacing in (50, 120, 600):
            owner_mark = f"_GRAN{spacing}_OWNER"
            clone_mark = f"_GRAN{spacing}_CLONE"
            page.click("#spike-source .cm-content")
            page.keyboard.press("Control+Home")
            page.keyboard.type(owner_mark)
            page.wait_for_timeout(spacing)
            page.click("#spike-clone .cm-content")
            page.keyboard.press("Control+Home")
            page.keyboard.type(clone_mark)
            page.wait_for_timeout(150)
            page.keyboard.press("Control+z")  # focus is in the clone → routed to the owner
            page.wait_for_timeout(150)
            after = snap()
            granularity.append(
                {
                    "spacingMs": spacing,
                    "cloneEditUndone": clone_mark not in after["source"],
                    "ownerEditAlsoUndone": owner_mark not in after["source"],
                }
            )

        counts_final = page.evaluate("() => ({ ...window.__spikeR2.counts })")
        page.screenshot(path=str(SHOT))
        browser.close()

    errors = [m for m in messages if m.startswith(("console.error", "pageerror"))]

    checks = {
        # The CM6 docs' divergence claim, reproduced: without forwarding, the two
        # views' states go their separate ways.
        "control_diverges": naive["a"] != naive["b"]
        and NAIVE_MARKER in naive["a"]
        and NAIVE_MARKER not in naive["b"]
        and naive["b"] == naive["initial"],
        "forward_sync_state": FROM_SOURCE in forward["source"] and FROM_SOURCE in forward["clone"],
        "forward_sync_dom": FROM_SOURCE in forward["cloneDom"],
        "backward_sync_state": FROM_CLONE in backward["source"] and FROM_CLONE in backward["clone"],
        "backward_sync_dom": FROM_CLONE in backward["sourceDom"],
        "undo_in_clone_removes_last_edit_only": FROM_CLONE not in undo_clone["source"]
        and FROM_CLONE not in undo_clone["clone"]
        and FROM_SOURCE in undo_clone["source"],
        "redo_in_clone_restores_both": FROM_CLONE in redo_clone["source"]
        and FROM_CLONE in redo_clone["clone"],
        "no_scroll_jacking": after_jack["cloneScroll"] == before_jack["cloneScroll"]
        and SCROLL_MARK in after_jack["clone"],
        "scroll_stays_per_view": scrolled["cloneScroll"] == after_jack["cloneScroll"]
        and scrolled["sourceScroll"] != after_jack["sourceScroll"],
        "selection_stays_per_view": selection["cloneSel"] != selection["sourceSel"],
        "no_feedback_loop": counts_final["source"] <= 150 and counts_final["clone"] <= 150,
        "no_console_errors": not errors,
    }

    report = {
        "httpStatus": status,
        "initialViewsAgree": initial["source"] == initial["clone"],
        "control": {
            "a_has_marker": NAIVE_MARKER in naive["a"],
            "b_has_marker": NAIVE_MARKER in naive["b"],
            "b_unchanged": naive["b"] == naive["initial"],
        },
        "dispatchCounts": {"afterTyping": backward["counts"], "final": counts_final},
        "scroll": {
            "cloneBefore": before_jack["cloneScroll"],
            "cloneAfterEditInSource": after_jack["cloneScroll"],
            "cloneAfterSourceScrolled": scrolled["cloneScroll"],
            "sourceBefore": before_jack["sourceScroll"],
            "sourceAfter": scrolled["sourceScroll"],
        },
        "selection": {"source": selection["sourceSel"], "clone": selection["cloneSel"]},
        "undoGranularityAcrossPanes": granularity,
        "checks": checks,
        "consoleMessages": messages,
        "screenshot": str(SHOT),
    }
    print(json.dumps(report, indent=2))

    ok = all(checks.values())
    print("\nR2_SPIKE:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
