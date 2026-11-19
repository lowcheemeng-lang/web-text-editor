"""Acceptance check for the XML-format example plugin (Task 11 follow-up).

    npm run dev                          # in another shell
    python3 scripts/verify-plugin-xml.py # exit 0 = the plugin works in the app

The plugin is installed through the same facade the Plugin Manager calls
(`window.__workspace.installPlugin`), then driven only through the UI a user has:
the Plugins menu, real keystrokes, Ctrl+Z. What it must prove beyond "the text got
prettier": invalid XML is left alone with a message, mixed content is left alone
with a message, and one Ctrl+Z takes the whole reformat back.
"""
from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:5173/"
PLUGIN = Path(__file__).resolve().parent.parent / "plugins" / "examples" / "xml-format.js"
SHOT_DIR = Path(__file__).resolve().parent.parent / ".hermes" / "cache" / "screenshots"
SHOT = SHOT_DIR / "plugin-xml-format.png"

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))


def info(page) -> dict:
    return page.evaluate("() => window.__workspace.inspect()")


def text(page) -> str:
    return page.evaluate("() => window.__workspace.inspect().text") or ""


def replace_document(page, value: str) -> None:
    page.click(".npp-pane[data-pane='primary'] .cm-content", position={"x": 4, "y": 10})
    page.keyboard.press("Control+a")
    page.keyboard.insert_text(value)
    page.wait_for_timeout(120)


def run_command(page) -> None:
    page.mouse.move(6, 6)
    page.wait_for_timeout(80)
    page.hover(".npp-menu-title:has-text('Plugins')")
    page.wait_for_selector(".npp-menu-popup:not([hidden])", timeout=5000)
    page.click('[data-menu-item="plugin:npp.xmlformat/format"]')
    page.wait_for_timeout(250)


def dismiss_notice(page) -> None:
    # Notices have no close button — they are transient. Removing the node is what the
    # app itself does when the next notice of the same kind replaces it.
    page.evaluate(
        "() => document.querySelectorAll('[data-notice=\"plugin:xml\"]').forEach((node) => node.remove())"
    )
    page.wait_for_timeout(80)


SHOT_DIR.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True)
    page = browser.new_page(viewport={"width": 1200, "height": 800})
    errors: list[str] = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="load")
    page.wait_for_selector(".npp-app", timeout=10000)

    # ── install ──────────────────────────────────────────────────────────────
    source = PLUGIN.read_text()
    installed = page.evaluate(
        "async ({ source }) => await window.__workspace.installPlugin(source)", {"source": source}
    )
    check("the plugin installs", bool(installed and installed.get("ok")), str(installed))
    plugins = info(page)["plugins"]
    row = next((item for item in plugins["installed"] if item["id"] == "npp.xmlformat"), None)
    check("it is listed and enabled", row is not None and row["enabled"] is True, str(row))
    base_commands = info(page)["plugins"]["commands"]
    check("its command is registered", base_commands >= 1, str(base_commands))

    # ── the happy path: a compact document becomes indented ──────────────────
    replace_document(page, "<root><a>1</a><b><c>2</c></b></root>")
    run_command(page)
    expected = "<root>\n  <a>1</a>\n  <b>\n    <c>2</c>\n  </b>\n</root>\n"
    check("the document is reformatted", text(page) == expected, repr(text(page)))
    page.keyboard.press("Control+z")
    page.wait_for_timeout(150)
    check(
        "one Ctrl+Z takes the whole reformat back",
        text(page) == "<root><a>1</a><b><c>2</c></b></root>",
        repr(text(page)),
    )

    # ── invalid XML: nothing changes, and the message says why ───────────────
    replace_document(page, "<a><b></a></b>")
    run_command(page)
    check("invalid XML is left exactly as it was", text(page) == "<a><b></a></b>", repr(text(page)))
    notice = page.locator("[data-notice='plugin:xml']")
    check("a notice explains the refusal", notice.count() == 1, str(notice.count()))
    body = notice.inner_text() if notice.count() else ""
    check("the notice names the mismatched tag", "does not close" in body, body[:100])
    dismiss_notice(page)

    # ── mixed content: reported, not reflowed ────────────────────────────────
    replace_document(page, "<a><b>one <c>x</c> two</b></a>")
    run_command(page)
    check(
        "mixed content keeps its exact text",
        "<b>one <c>x</c> two</b>" in text(page),
        repr(text(page)),
    )
    notice = page.locator("[data-notice='plugin:xml']")
    check("and the plugin says it left something alone", notice.count() == 1)
    dismiss_notice(page)

    # ── a selection is formatted on its own (fragment mode) ──────────────────
    replace_document(page, "<a>\n<b>1</b><c>2</c>\n</a>")
    page.click(".npp-pane[data-pane='primary'] .cm-content", position={"x": 4, "y": 10})
    page.keyboard.press("Control+Home")
    page.keyboard.press("ArrowDown")
    page.keyboard.press("Home")
    page.keyboard.press("Shift+End")
    run_command(page)
    check(
        "a selected fragment is formatted in place",
        "<b>1</b>\n<c>2</c>" in text(page),
        repr(text(page)),
    )

    # ── and it survives the plugin being disabled ────────────────────────────
    page.evaluate("() => window.__workspace.disablePlugin('npp.xmlformat')")
    page.wait_for_timeout(150)
    disabled = info(page)["plugins"]
    check(
        "disabling removes the command",
        disabled["commands"] < base_commands,
        f"{disabled['commands']} vs {base_commands}",
    )

    page.evaluate("() => window.__workspace.uninstallPlugin('npp.xmlformat')")
    page.wait_for_timeout(150)
    check(
        "uninstalling removes the plugin",
        not any(p["id"] == "npp.xmlformat" for p in info(page)["plugins"]["installed"]),
    )

    page.screenshot(path=str(SHOT))
    check("no console or page errors", not errors, "; ".join(errors[:3]))
    browser.close()

failed = [name for name, ok, _ in results if not ok]
print(f"\n{'=' * 60}")
print(f"VERIFY-PLUGIN-XML: {'PASS' if not failed else 'FAIL'}  ({len(results) - len(failed)}/{len(results)} checks)")
if failed:
    print("failed: " + "; ".join(failed))
print(f"screenshot: {SHOT}")
sys.exit(1 if failed else 0)
