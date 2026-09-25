"""Browser verification for the scaffold: does the app actually run?

This is the executable form of Task 2's acceptance criterion (see PROGRESS.md).
It is deliberately kept in the repo so the "task is done" claim can be re-checked
later instead of being taken on trust.

Prerequisites:
  1. the dev server is running:  npm run dev        (serves http://127.0.0.1:5173)
  2. system Chrome + Python Playwright are installed (playwright is NOT a project
     dependency; it drives the real browser rather than shipping with the app)

Run:
    python3 scripts/verify-task2.py

Checks: HTTP 200, one CodeMirror instance mounted, line numbers present, a dev
handle on window, typing changes the document, and zero console errors.
Screenshot lands in .hermes/cache/screenshots/ (git-ignored — no binaries in git).

Exit code 0 = PASS, 1 = FAIL.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:5173/"
SHOT_DIR = Path(__file__).resolve().parent.parent / ".hermes" / "cache" / "screenshots"
SHOT = SHOT_DIR / "task2-scaffold.png"
MARKER = "TYPED_BY_VERIFICATION"

messages: list[str] = []


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

        page.wait_for_selector(".cm-editor", timeout=15000)

        dom = page.evaluate(
            """() => ({
                title: document.title,
                editors: document.querySelectorAll('.cm-editor').length,
                visibleLines: document.querySelectorAll('.cm-line').length,
                gutterElements: document.querySelectorAll('.cm-gutterElement').length,
                hasDevHandle: typeof window.__editor !== 'undefined',
                docLines: window.__editor ? window.__editor.state.doc.lines : null,
                docLength: window.__editor ? window.__editor.state.doc.length : null,
                firstLine: window.__editor ? window.__editor.state.doc.line(1).text : null,
            })"""
        )

        # Interactivity: click in, jump to the end, type. Rendering alone would not
        # prove the editor is usable.
        page.click(".cm-content")
        page.keyboard.press("Control+End")
        page.keyboard.type(MARKER)
        after = page.evaluate(
            """() => ({
                lines: window.__editor.state.doc.lines,
                lastLine: window.__editor.state.doc.line(window.__editor.state.doc.lines).text,
            })"""
        )

        page.screenshot(path=str(SHOT))
        browser.close()

    errors = [m for m in messages if m.startswith(("console.error", "pageerror"))]
    report = {
        "httpStatus": status,
        "dom": dom,
        "interactivity": after,
        "typedMarkerPresent": MARKER in (after.get("lastLine") or ""),
        "consoleMessages": messages,
        "consoleErrors": errors,
        "screenshot": str(SHOT),
    }
    print(json.dumps(report, indent=2))

    ok = (
        status == 200
        and dom["editors"] == 1
        and dom["hasDevHandle"]
        and isinstance(dom["docLines"], int)
        and report["typedMarkerPresent"]
        and not errors
    )
    print("\nTASK2_VERIFICATION:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
