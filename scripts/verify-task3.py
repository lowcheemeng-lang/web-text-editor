"""Task 3 acceptance check — run against a real Chrome against the dev server.

S2 in the plan: every claim in PROGRESS.md about Task 3 must be backed by this
script, not by prose. It exercises the app the way a person would — real
keystrokes, real clicks — and fails loudly on console errors.

    npm run dev                       # in another shell, or use the existing one
    python3 scripts/verify-task3.py   # exit 0 = Task 3 accepted

Covers the plan's Task 3 acceptance ("tabbed editing, N++ default font/size,
word-wrap toggle, and clone-document behaviour"), plus the Notepad++ defaults
that docs/scope.md Tier 1 requires and the no-backend promise (D1).
"""
from __future__ import annotations

import sys

from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:5173/"

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))


def overflow_px(page, pane: str = "primary") -> int:
    """Horizontal overflow of a pane's scroller: 0 means the text fits (wrapped)."""
    return page.evaluate(
        """(pane) => {
            const sc = document.querySelector(`.npp-pane[data-pane="${pane}"] .cm-scroller`);
            if (!sc) return -1;
            return sc.scrollWidth - sc.clientWidth;
        }""",
        pane,
    )


def pane_text(page, pane: str) -> str | None:
    """Text shown by a pane's view. Views are listed in creation order, and the
    primary pane's view is always created first, so index 0 is the primary pane."""
    texts = page.evaluate("() => window.__workspace.inspect().viewTexts")
    index = 0 if pane == "primary" else 1
    return texts[index] if len(texts) > index else None


with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True)
    page = browser.new_page()

    console_errors: list[str] = []
    page_errors: list[str] = []
    requests: list[str] = []
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: page_errors.append(str(e)))
    page.on("request", lambda r: requests.append(r.url))

    page.goto(URL, wait_until="load")
    page.wait_for_selector(".npp-app", timeout=10000)

    # ── 1. Boot and chrome structure ────────────────────────────────────────
    check("chrome: toolbar present", page.locator(".npp-toolbar").count() == 1)
    check("chrome: status bar present", page.locator(".npp-statusbar").count() == 1)
    check("chrome: exactly one pane at boot", page.locator(".npp-pane").count() == 1)
    check("chrome: one editor mounted", page.locator(".cm-editor").count() == 1)
    check("one tab at boot", page.locator(".npp-tab").count() == 1)
    check(
        "first tab is N++'s 'new 1'",
        page.locator(".npp-tab-label").first.text_content() == "new 1",
    )
    check(
        "line numbers rendered",
        page.locator(".npp-pane[data-pane='primary'] .cm-lineNumbers").count() == 1,
    )
    check("welcome document has content", len(page.evaluate("() => window.__workspace.inspect().text")) > 0)

    info = page.evaluate("() => window.__workspace.inspect()")

    # ── 2. Notepad++ defaults ───────────────────────────────────────────────
    check(
        "N++ font family (stylers.model.xml: Courier New)",
        "Courier New" in (info["fontFamily"] or ""),
        info["fontFamily"] or "none",
    )
    size = float((info["fontSize"] or "0px").replace("px", ""))
    # NPP_FONT_SIZE is 10pt, which is 13.333px at the standard 96dpi.
    check("N++ font size 10pt ≈ 13.3px", 13.0 <= size <= 13.7, f"{size}px")
    check("tab size = 4", info["tabSize"] == 4, str(info["tabSize"]))
    check("indent unit = real TAB", info["indentUnit"] == "\t", repr(info["indentUnit"]))
    check("word wrap off by default", info["wordWrap"] is False, str(info["wordWrap"]))
    check("not split at boot", info["split"] is False and info["views"] == 1, str(info["views"]))
    check("active line highlighted", page.locator(".cm-activeLine").count() >= 1)

    # ── 3. Multi-document tabs ──────────────────────────────────────────────
    page.click("button[data-tool='new']")
    check("New creates a second tab", page.locator(".npp-tab").count() == 2)
    check("new tab is named 'new 2'", page.locator(".npp-tab-label").nth(1).text_content() == "new 2")
    check("new document starts empty", page.evaluate("() => window.__workspace.inspect().text") == "")

    # Tab indent: pressing Tab at column 1 must insert a real tab character.
    page.click(".npp-pane[data-pane='primary'] .cm-content", position={"x": 2, "y": 8})
    page.keyboard.press("Tab")
    check(
        "Tab inserts a real \\t (N++: not replaced by space)",
        page.evaluate("() => window.__workspace.inspect().text") == "\t",
        repr(page.evaluate("() => window.__workspace.inspect().text")),
    )
    page.keyboard.press("Control+z")

    page.keyboard.type("hello")
    check("typing marks the document dirty", page.evaluate("() => window.__workspace.inspect().dirty") is True)
    check("dirty tab shows the modified marker", page.locator(".npp-tab").nth(1).text_content().startswith("*"))
    status = page.locator(".npp-statusbar").text_content() or ""
    check("status bar reports cursor position", "Ln 1, Col 6" in status, status.strip())

    # Switch away and back: each tab must keep its own document.
    page.click(".npp-tab", position={"x": 40, "y": 8})
    # Match the product name, not a task number: the welcome text is rewritten each
    # task and a check that pins "Task 3" would fail for the wrong reason.
    check("switching tabs keeps the welcome document",
          "Notepad++ Web" in (page.evaluate("() => window.__workspace.inspect().text") or ""))
    page.locator(".npp-tab").nth(1).click()
    check("switching back preserves edits", page.evaluate("() => window.__workspace.inspect().text") == "hello")

    # ── 4. Word wrap toggle ─────────────────────────────────────────────────
    # A 400-char line overflows when wrap is off, and fits when it is on.
    page.evaluate(
        "() => window.__workspace.activeView.dispatch("
        "{changes: {from: 0, to: 0, insert: 'X'.repeat(400) + '\\n'}})"
    )
    overflowing = overflow_px(page) > 0
    check("unwrapped long line overflows horizontally", overflowing, f"{overflow_px(page)}px")
    page.click("button[data-tool='wordwrap']")
    check("wrap toggle turns word wrap on", page.evaluate("() => window.__workspace.inspect().wordWrap") is True)
    check("wrapped line no longer overflows", overflow_px(page) <= 0, f"{overflow_px(page)}px")
    page.click("button[data-tool='wordwrap']")
    check("wrap toggle turns word wrap back off", page.evaluate("() => window.__workspace.inspect().wordWrap") is False)

    # Clear the probe line so later assertions are about known text. Deleting it
    # directly (rather than undoing) leaves "hello" in place: undoing here would
    # restore the probe line we just removed.
    page.evaluate("() => window.__workspace.activeView.dispatch({changes: {from: 0, to: 401, insert: ''}})")
    check("document back to 'hello' after cleanup", page.evaluate("() => window.__workspace.inspect().text") == "hello")

    # ── 5. Split / clone view (risk R2) ─────────────────────────────────────
    page.click("button[data-tool='split']")
    check("split creates a second pane", page.locator(".npp-pane").count() == 2)
    check("split creates a second view of the document", page.evaluate("() => window.__workspace.inspect().views") == 2)
    check("second pane has no tab strip of its own", page.locator(".npp-pane[data-pane='clone'] .npp-tabstrip").is_hidden())
    check("splitter is visible", page.locator(".npp-splitter").is_visible())

    # Start from a clean, empty document so the expected text is predictable.
    page.click("button[data-tool='new']")
    check("New while split gives 3 tabs", page.locator(".npp-tab").count() == 3)

    page.click(".npp-pane[data-pane='primary'] .cm-content", position={"x": 2, "y": 8})
    page.keyboard.type("AAA")
    page.wait_for_timeout(750)  # > CM6 newGroupDelay (500ms): keep the two edits separate
    page.click(".npp-pane[data-pane='clone'] .cm-content", position={"x": 2, "y": 8})
    page.keyboard.type("BBB")

    primary_text = pane_text(page, "primary")
    clone_text = pane_text(page, "clone")
    check("typing in the owner reaches the clone", primary_text is not None and "AAA" in primary_text, repr(primary_text))
    check("both panes hold identical text", primary_text == clone_text, f"{primary_text!r} vs {clone_text!r}")
    check("clone's own edit landed too", clone_text is not None and "BBB" in clone_text, repr(clone_text))

    # Undo from the clone must drive the shared history (one document, one undo).
    page.click(".npp-pane[data-pane='clone'] .cm-content", position={"x": 2, "y": 8})
    page.keyboard.press("Control+z")
    page.wait_for_timeout(50)
    after_undo = pane_text(page, "clone")
    check(
        "Ctrl+Z in the clone undoes only the clone's edit",
        after_undo is not None and after_undo == "AAA",
        repr(after_undo),
    )
    check("both panes stay identical after undo", pane_text(page, "primary") == after_undo)

    # Undo from the owner continues the same history rather than starting a new one.
    page.click(".npp-pane[data-pane='primary'] .cm-content", position={"x": 2, "y": 8})
    page.keyboard.press("Control+z")
    page.wait_for_timeout(50)
    after_second_undo = pane_text(page, "primary")
    check("second Ctrl+Z clears the document (shared history)", after_second_undo == "", repr(after_second_undo))
    check("both panes still identical", pane_text(page, "clone") == after_second_undo)

    # Turning the split off leaves one pane and one view.
    page.click("button[data-tool='split']")
    check("split off restores a single pane", page.locator(".npp-pane").count() == 1)
    check("split off leaves one view", page.evaluate("() => window.__workspace.inspect().views") == 1)

    # ── 6. Closing a modified document prompts ──────────────────────────────
    # The active document was fully undone in the split test, which lands it back
    # on its save point — a close there is correctly silent, so modify it first.
    page.click(".npp-pane[data-pane='primary'] .cm-content", position={"x": 2, "y": 8})
    page.keyboard.type("unsaved")
    check("document is modified before the close test",
          page.evaluate("() => window.__workspace.inspect().dirty") is True)

    page.locator(".npp-tab.is-active .npp-tab-close").click()
    page.wait_for_selector("[data-dialog='save-changes']", timeout=3000)
    check("closing a modified document prompts", page.locator("[data-dialog='save-changes']").count() == 1)
    # Task 3 asserted the opposite of this ("discard, not a Save button that cannot
    # save") because saving did not exist yet. Task 4 made it real, so the prompt
    # must now offer N++'s full three-way choice — the stronger contract.
    check("prompt offers Save", page.locator("[data-dialog-action='save']").count() == 1)
    check("prompt offers Don't Save", page.locator("[data-dialog-action='discard']").text_content() == "Don't Save")
    check("prompt offers Cancel", page.locator("[data-dialog-action='cancel']").count() == 1)
    page.click("[data-dialog-action='cancel']")
    page.wait_for_timeout(50)
    check("Cancel keeps the document open", page.locator(".npp-tab").count() == 3)

    page.locator(".npp-tab.is-active .npp-tab-close").click()
    page.wait_for_selector("[data-dialog='save-changes']", timeout=3000)
    page.click("[data-dialog-action='discard']")
    page.wait_for_timeout(50)
    check("Don't Save closes the document", page.locator(".npp-tab").count() == 2)

    # The converse: an unmodified document must close with no prompt at all.
    page.locator(".npp-tab").first.click()
    check("first tab is unmodified", page.evaluate("() => window.__workspace.inspect().dirty") is False)
    page.locator(".npp-tab.is-active .npp-tab-close").click()
    page.wait_for_timeout(150)
    check("closing an unmodified document needs no prompt", page.locator("[data-dialog='confirm']").count() == 0)
    check("unmodified close removes the tab", page.locator(".npp-tab").count() == 1)

    # ── 7. Keyboard: the Alt substitutes for the browser-owned Ctrl keys ────
    before = page.locator(".npp-tab").count()
    page.click(".npp-pane[data-pane='primary'] .cm-content")
    page.keyboard.press("Alt+n")
    page.wait_for_timeout(50)
    check("Alt+N creates a document", page.locator(".npp-tab").count() == before + 1,
          f"{before} -> {page.locator('.npp-tab').count()}")

    page.keyboard.press("Alt+z")
    page.wait_for_timeout(50)
    wrapped_by_key = page.evaluate("() => window.__workspace.inspect().wordWrap")
    check("Alt+Z toggles word wrap", wrapped_by_key is True, str(wrapped_by_key))
    page.keyboard.press("Alt+z")

    # ── 8. No backend (D1) ──────────────────────────────────────────────────
    offsite = [u for u in requests if not (u.startswith(("http://127.0.0.1", "http://localhost", "ws://127.0.0.1", "ws://localhost", "data:")))]
    check("no request left the machine (D1 backend-free)", len(offsite) == 0, ", ".join(offsite[:3]))

    # ── 9. No errors ────────────────────────────────────────────────────────
    check("no console errors", len(console_errors) == 0, "; ".join(console_errors[:3]))
    check("no uncaught page errors", len(page_errors) == 0, "; ".join(page_errors[:3]))

    page.screenshot(path="/home/lowcheemeng/.hermes/cache/scratch/task3.png", full_page=False)
    browser.close()

failed = [name for name, ok, _ in results if not ok]
print(f"\n{'=' * 60}")
print(f"VERIFY-TASK3: {'PASS' if not failed else 'FAIL'}  ({len(results) - len(failed)}/{len(results)} checks)")
if failed:
    print("failed: " + "; ".join(failed))
print("=" * 60)
sys.exit(1 if failed else 0)
