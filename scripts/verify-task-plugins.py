"""Task P7 — end-to-end acceptance for the plugin host, against a production build.

    python3 scripts/verify-task-plugins.py     # exit 0 = P7 accepted

Why a production build and a hand-rolled server: the plugin host's claims are about
the artifact that ships — a plugin stored in IndexedDB and loaded from a blob URL
while the service worker serves the shell. A dev server's unbundled modules would
test a different program. The server sends `Cache-Control: no-cache` so a reload
with it stopped cannot be answered by Chrome's HTTP cache, and a fresh profile per
run keeps Task 7's restored session out of the fixture.

There is no `window.__workspace` in a production build, and this check does not add
one: every assertion goes through the UI a user has — the menu, the manager's file
input, the dock, the editor — or through the browser's own APIs.
"""
from __future__ import annotations

import http.server
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
EXAMPLES = ROOT / "plugins" / "examples"
PORT = 4211
URL = f"http://127.0.0.1:{PORT}/"
SHOTS = ROOT / ".hermes" / "cache" / "screenshots"

results: list[tuple[str, bool, str]] = []
console_errors: list[str] = []
page_errors: list[str] = []
requests: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))
    return bool(ok)


MIMES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".png": "image/png",
    ".map": "application/json",
}
LOG: list[str] = []


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST), **kwargs)

    def guess_type(self, path):
        return MIMES.get(os.path.splitext(path)[1]) or super().guess_type(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        LOG.append(f"{self.command} {self.path}")


def start_server() -> http.server.ThreadingHTTPServer:
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


SEED = """async ([name, data]) => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(name, { create: true });
    const stream = await handle.createWritable();
    await stream.write(new Uint8Array(data));
    await stream.close();
}"""

READ_OPFS = """async (name) => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(name);
    return await (await handle.getFile()).text();
}"""

# Raw source, not a function expression: add_init_script evaluates page scripts, so
# an arrow-function string would be a no-op statement (measured in Task 8).
STUB_PICKERS = """window.__stubPickers = true;
window.showOpenFilePicker = async () => {
    const root = await navigator.storage.getDirectory();
    return [await root.getFileHandle(window.__nextOpen)];
};
window.showSaveFilePicker = async (options) => {
    const root = await navigator.storage.getDirectory();
    return await root.getFileHandle(options.suggestedName || window.__nextOpen);
};
"""


def open_menu(page, label: str = "Plugins") -> None:
    # Move off the menu bar first: a hover on an element the pointer already sits on
    # raises no mouseenter, so a menu closed with Escape would never reopen.
    page.mouse.move(6, 6)
    page.wait_for_timeout(60)
    page.hover(f".npp-menu-title:has-text('{label}')")
    page.wait_for_selector(".npp-menu-popup:not([hidden])", timeout=5000)


def menu_items(page) -> list[str]:
    return page.eval_on_selector_all(
        ".npp-menu-popup:not([hidden]) [data-menu-item]",
        "els => els.map((el) => [el.getAttribute('data-menu-item'), el.textContent])",
    )


def run_menu_command(page, item: str, label: str = "Plugins") -> None:
    open_menu(page, label)
    page.click(f'[data-menu-item="{item}"]')
    page.wait_for_timeout(250)


def open_manager(page) -> None:
    open_menu(page)
    page.click('[data-menu-item="plugin-manager"]')
    page.wait_for_selector('[data-dialog="plugin-manager"]', timeout=5000)


def close_manager(page) -> None:
    page.click('[data-dialog-action="close"]')
    page.wait_for_selector('[data-dialog="plugin-manager"]', state="detached", timeout=5000)
    page.wait_for_timeout(150)


def install_file(page, path: Path) -> None:
    open_manager(page)
    page.set_input_files("[data-plugin-file]", str(path))
    page.wait_for_function(
        "() => { const m = document.querySelector('[data-plugin-message]');"
        " return m && m.dataset.state !== 'busy'; }",
        timeout=8000,
    )
    page.wait_for_timeout(300)


def row_status(page, plugin_id: str) -> str:
    locator = page.locator(f'[data-plugin-status="{plugin_id}"]')
    return locator.inner_text() if locator.count() else ""


def message(page) -> str:
    return page.locator("[data-plugin-message]").inner_text()


def dismiss_dialogs(page) -> None:
    page.wait_for_timeout(250)
    for button in page.query_selector_all(
        "dialog[open] .npp-dialog-confirm, dialog[open] .npp-dialog-cancel"
    ):
        try:
            button.click()
        except Exception:
            pass
        page.wait_for_timeout(120)


def focus_editor(page, pane: int = 0) -> None:
    page.locator(".cm-content").nth(pane).click()
    page.wait_for_timeout(120)


def editor_text(page, pane: int = 0) -> str:
    return page.evaluate(
        "(index) => document.querySelectorAll('.cm-content')[index].textContent", pane
    )


def select_all_and_type(page, text: str) -> None:
    focus_editor(page)
    page.keyboard.press("Control+a")
    page.keyboard.type(text)
    page.wait_for_timeout(200)


def clean(page) -> None:
    """Undo back to the save point so a reload does not raise the restore alert."""
    focus_editor(page)
    for _ in range(14):
        page.keyboard.press("Control+z")
    page.wait_for_timeout(250)


def wait_for_dock(page, timeout_ms: int = 6000) -> bool:
    try:
        page.wait_for_selector('.npp-dock[data-dock="plugins"]:not([hidden])', timeout=timeout_ms)
        return True
    except Exception:
        return False


def main() -> int:
    print("$ npm run build")
    build = subprocess.run(["npm", "run", "build"], cwd=ROOT, capture_output=True, text=True, timeout=600)
    if build.returncode != 0:
        print(build.stdout[-2500:])
        print(build.stderr[-2500:])
        return 1
    print("  " + "\n  ".join(line.strip() for line in build.stdout.splitlines() if re.search(r"assets/(index|editor-core)-", line)))

    precache = subprocess.run(
        ["node", "scripts/check-precache.mjs"], cwd=ROOT, capture_output=True, text=True
    )
    check("the precache list is unchanged by plugins (they are IndexedDB, not assets)",
          precache.returncode == 0, (precache.stdout or precache.stderr).strip().splitlines()[-1][:100])

    # A throwaway plugin file for the shortcut-conflict case: the app owns Ctrl+S.
    scratch = Path(tempfile.mkdtemp(prefix="plugin-p7-"))
    conflict = scratch / "conflict.js"
    conflict.write_text(
        "export default {\n"
        '  id: "npp.conflict", name: "Conflict", version: "1.0.0", apiVersion: 1,\n'
        "  activate(ctx) {\n"
        '    ctx.commands.register({ id: "save", label: "Fake Save", shortcut: "Ctrl+S", run() { return false; } });\n'
        "  },\n"
        "};\n",
        encoding="utf-8",
    )

    server = start_server()
    profile = tempfile.mkdtemp(prefix="plugin-p7-profile-")

    try:
        with sync_playwright() as playwright:
            context = playwright.chromium.launch_persistent_context(
                profile, channel="chrome", headless=True, viewport={"width": 1300, "height": 880}
            )
            page = context.pages[0] if context.pages else context.new_page()
            page.add_init_script(STUB_PICKERS)
            page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: page_errors.append(str(e)))
            page.on("request", lambda r: requests.append(r.url))

            cdp = context.new_cdp_session(page)
            cdp.send("Network.enable")
            served: list[tuple[str, bool]] = []
            cdp.on(
                "Network.responseReceived",
                lambda event: served.append((event["response"]["url"], event["response"].get("fromServiceWorker", False))),
            )

            page.goto(URL, wait_until="load")
            page.wait_for_selector(".npp-app", timeout=20000)
            page.wait_for_function("navigator.serviceWorker.controller !== null", timeout=20000)
            check("the production build mounts", page.locator(".cm-editor").count() == 1)

            # ── 1. the empty manager ─────────────────────────────────────────────
            open_manager(page)
            check("Plugins ▸ Plugin Manager… opens", page.is_visible('[data-dialog="plugin-manager"]'))
            check("with nothing installed it says so", page.locator("[data-plugin-empty]").count() == 1)
            trust = page.locator(".npp-manager-trust").inner_text()
            check("the trust model is stated before the picker", "no sandbox" in trust, trust[:60])

            # ── 2. probe: an extension reaches a real view ───────────────────────
            page.set_input_files("[data-plugin-file]", str(EXAMPLES / "probe.js"))
            page.wait_for_function(
                "() => { const m = document.querySelector('[data-plugin-message]');"
                " return m && m.dataset.state !== 'busy'; }",
                timeout=8000,
            )
            page.wait_for_timeout(400)
            check("probe installs from the file input", page.locator('[data-plugin-row="npp.probe"]').count() == 1)
            check("its row says enabled", row_status(page, "npp.probe") == "enabled", row_status(page, "npp.probe"))
            check("no error is shown for it", page.locator('[data-plugin-error="npp.probe"]').count() == 0)
            close_manager(page)
            page.wait_for_timeout(300)
            check(
                "a ViewPlugin from the plugin reaches the editor's DOM",
                page.locator(".cm-editor[data-plugin-probe]").count() == 1,
            )
            open_menu(page)
            items = dict(menu_items(page))
            check("its command is in the Plugins menu", "plugin:npp.probe/ping" in items, ", ".join(items))
            page.keyboard.press("Escape")
            run_menu_command(page, "plugin:npp.probe/ping")
            check("running it raises nothing", len(page_errors) == 0, "; ".join(page_errors[:2]))

            # ── 3. base64: a selection, one transaction, one undo ────────────────
            install_file(page, EXAMPLES / "base64.js")
            check("base64 installs", row_status(page, "npp.base64") == "enabled")
            close_manager(page)
            select_all_and_type(page, "hello world")
            page.keyboard.press("Control+a")
            page.wait_for_timeout(150)
            run_menu_command(page, "plugin:npp.base64/encode")
            check("the command encodes the selection", editor_text(page).strip() == "aGVsbG8gd29ybGQ=", editor_text(page)[:40])
            focus_editor(page)
            page.keyboard.press("Control+z")
            page.wait_for_timeout(200)
            check("one Ctrl+Z takes the plugin's edit back", editor_text(page).strip() == "hello world", editor_text(page)[:40])
            page.keyboard.press("Control+a")
            page.keyboard.press("Control+Alt+b")
            page.wait_for_timeout(250)
            check("the plugin's own shortcut works", editor_text(page).strip() == "aGVsbG8gd29ybGQ=", editor_text(page)[:40])
            run_menu_command(page, "plugin:npp.base64/decode")
            check("and decode round-trips it", editor_text(page).strip() == "hello world", editor_text(page)[:40])
            clean(page)

            # ── 3b. JSON format: format, and refuse without corrupting ───────────
            install_file(page, EXAMPLES / "json-format.js")
            check("json-format installs", row_status(page, "npp.jsonformat") == "enabled")
            close_manager(page)
            select_all_and_type(page, '{"a":1,"b":[2,3]}')
            run_menu_command(page, "plugin:npp.jsonformat/format")
            formatted = editor_text(page)
            check(
                "valid JSON is reformatted onto more than one line",
                '"a": 1' in formatted
                and page.locator(".cm-line").count() > 1,
                f"{page.locator('.cm-line').count()} lines: {formatted[:50]}",
            )
            select_all_and_type(page, "{not json")
            before_invalid = editor_text(page)
            run_menu_command(page, "plugin:npp.jsonformat/format")
            check("invalid JSON is left exactly as it was", editor_text(page) == before_invalid)
            check(
                "and the plugin says why instead of rewriting it",
                page.locator('[data-notice="plugin:json"]').count() == 1
                and "Not JSON" in page.locator('[data-notice="plugin:json"]').inner_text(),
                page.locator('[data-notice="plugin:json"]').inner_text()[:60],
            )
            clean(page)

            # ── 4. word count: the dock ──────────────────────────────────────────
            install_file(page, EXAMPLES / "word-count.js")
            check("word-count installs", row_status(page, "npp.wordcount") == "enabled")
            close_manager(page)
            check("its panel opens the dock on activation", wait_for_dock(page))
            tabs = page.eval_on_selector_all(".npp-dock-tab", "els => els.map((el) => el.textContent)")
            check("the dock has the panel's tab", "Word Count" in tabs, ", ".join(tabs))
            panel = page.locator(".npp-dock-panel").inner_text()
            lines = page.eval_on_selector_all(".cm-line", "els => els.map((el) => el.textContent)")
            panel_chars = int(re.search(r"(\d+) characters", panel).group(1))
            panel_lines = int(re.search(r"(\d+) lines", panel).group(1))
            rendered = "\n".join(lines)
            expected_chars = sum(len(line) for line in lines) + max(0, len(lines) - 1)
            expected_words = len([word for word in rendered.split() if word])
            check(
                "the panel's character count matches the document",
                panel_chars == expected_chars,
                f"{panel_chars} vs {expected_chars}",
            )
            check(
                "and its line count does",
                panel_lines == len(lines),
                f"{panel_lines} vs {len(lines)}",
            )
            check(
                "and its word count does",
                f"{expected_words} words" in panel,
                f"{expected_words} words expected, panel says {panel.splitlines()[0]!r}",
            )
            focus_editor(page)
            page.keyboard.press("Control+End")
            page.keyboard.type(" extra")
            page.wait_for_timeout(600)
            updated = page.locator(".npp-dock-panel").inner_text()
            updated_chars = int(re.search(r"(\d+) characters", updated).group(1))
            check(
                "the panel follows typing (exactly the six characters added)",
                updated_chars - panel_chars == len(" extra"),
                f"{panel_chars} → {updated_chars}",
            )
            clean(page)

            # ── 5. split view: the extension reaches both panes ──────────────────
            page.click('[data-tool="split"]')
            page.wait_for_timeout(500)
            check("split view opens two editors", page.locator(".cm-editor").count() == 2)
            check(
                "the plugin's extension is in both panes",
                page.locator(".cm-editor[data-plugin-probe]").count() == 2,
                str(page.locator(".cm-editor[data-plugin-probe]").count()),
            )
            check(
                "and both panes show the same document",
                editor_text(page, 0) == editor_text(page, 1),
            )
            page.click('[data-tool="split"]')
            page.wait_for_timeout(300)

            # ── 6. disable: everything the plugin added goes away ────────────────
            open_manager(page)
            page.click('[data-plugin-row="npp.probe"] [data-plugin-action="disable"]')
            page.wait_for_timeout(500)
            check("the row says disabled", row_status(page, "npp.probe") == "disabled")
            close_manager(page)
            page.wait_for_timeout(300)
            check("the extension is gone from the editor", page.locator(".cm-editor[data-plugin-probe]").count() == 0)
            open_menu(page)
            labels = [label for _, label in menu_items(page)]
            check("its command is gone", not any("Probe: Ping" in (label or "") for label in labels), ", ".join(labels))
            check(
                "another plugin's command is still there",
                any("Base64 Encode" in (label or "") for label in labels),
            )
            page.keyboard.press("Escape")
            clean(page)

            # ── 7. reload: enabled plugins return, the disabled one stays off ────
            page.reload(wait_until="load")
            page.wait_for_selector(".cm-editor", timeout=20000)
            page.wait_for_timeout(900)
            dismiss_dialogs(page)
            check("enabled plugins load again after a reload", wait_for_dock(page))
            open_menu(page)
            labels = [label for _, label in menu_items(page)]
            check("their commands are back", any("Base64 Encode" in (label or "") for label in labels), ", ".join(labels))
            check("the disabled plugin did not come back", not any("Probe: Ping" in (label or "") for label in labels))
            page.keyboard.press("Escape")
            check("and its extension is still gone", page.locator(".cm-editor[data-plugin-probe]").count() == 0)

            # ── 8. ?plugins=off: recovery mode ───────────────────────────────────
            page.goto(f"{URL}?plugins=off", wait_until="load")
            page.wait_for_selector(".cm-editor", timeout=20000)
            page.wait_for_timeout(800)
            dismiss_dialogs(page)
            check("?plugins=off activates nothing (no dock)", page.locator(".npp-dock").count() == 1 and page.locator(".npp-dock").is_hidden())
            open_manager(page)
            check("the manager still opens", page.locator("[data-plugin-disabled-banner]").count() == 1)
            check("it offers no install path", page.locator("[data-plugin-install]").count() == 0)
            enable = page.locator('[data-plugin-row="npp.probe"] [data-plugin-action="enable"]')
            check("Enable is refused while the flag is on", enable.count() == 1 and enable.is_disabled())
            close_manager(page)
            page.goto(URL, wait_until="load")
            page.wait_for_selector(".cm-editor", timeout=20000)
            page.wait_for_timeout(900)
            dismiss_dialogs(page)

            # ── 9. broken plugin: install-time failure, then the startup notice ──
            install_file(page, EXAMPLES / "broken.js")
            check("a plugin that throws is listed as failed", row_status(page, "npp.broken") == "failed")
            error_text = page.locator('[data-plugin-error="npp.broken"]').inner_text()
            check("with its error text", "always fails" in error_text, error_text[:80])
            close_manager(page)
            focus_editor(page)
            page.keyboard.type("STILL_EDITABLE")
            page.wait_for_timeout(200)
            check("the app is still editable", "STILL_EDITABLE" in editor_text(page))
            clean(page)
            page.reload(wait_until="load")
            page.wait_for_selector(".cm-editor", timeout=20000)
            page.wait_for_timeout(1200)
            dismiss_dialogs(page)
            check("a plugin that fails at startup raises a notice", page.locator('[data-notice="plugin-failure"]').count() == 1)
            action = page.locator('[data-notice-action="plugin-failure"]')
            check("the notice offers the manager", action.count() == 1)
            if action.count():
                action.click()
            page.wait_for_selector('[data-dialog="plugin-manager"]', timeout=5000)
            check("the action opens the manager on the failed plugin", page.locator('[data-plugin-row="npp.broken"]').count() == 1)
            page.click('[data-plugin-row="npp.broken"] [data-plugin-action="uninstall"]')
            page.click('[data-plugin-confirm="npp.broken"]')
            page.wait_for_timeout(500)
            check("uninstalling it clears the row", page.locator('[data-plugin-row="npp.broken"]').count() == 0)
            close_manager(page)

            # ── 10. rejections: the app's Ctrl+S, and a duplicate install ────────
            install_file(page, conflict)
            check("a plugin that claims Ctrl+S is listed as failed", row_status(page, "npp.conflict") == "failed")
            conflict_error = page.locator('[data-plugin-error="npp.conflict"]').inner_text()
            check("and the reason names the shortcut", "shortcut" in conflict_error.lower(), conflict_error[:90])
            page.click('[data-plugin-row="npp.conflict"] [data-plugin-action="uninstall"]')
            page.click('[data-plugin-confirm="npp.conflict"]')
            page.wait_for_timeout(400)
            close_manager(page)

            # The app's own Ctrl+S still saves: seed a file, open it, edit, save, read.
            page.evaluate(SEED, ["verify-plugin.txt", list("one\ntwo\n".encode())])
            page.evaluate("(name) => { window.__nextOpen = name; }", "verify-plugin.txt")
            focus_editor(page)
            page.keyboard.press("Alt+o")
            page.wait_for_timeout(800)
            dismiss_dialogs(page)
            focus_editor(page)
            page.keyboard.press("Control+End")
            page.keyboard.type("CTRL_S_WORKS")
            # The app binds Save to Alt+S by design (N++'s Ctrl+S is the browser's
            # own, see WEB_PORT_KEYS.saveFile); Ctrl+S is reserved, which is why the
            # plugin above could not take it.
            page.keyboard.press("Alt+s")
            page.wait_for_timeout(900)
            saved = page.evaluate(READ_OPFS, "verify-plugin.txt")
            check(
                "the app's save shortcut still saves (the refused plugin did not take it)",
                "CTRL_S_WORKS" in saved,
                saved[-30:],
            )

            # Installing the same id again is an update, not a duplicate row.
            install_file(page, EXAMPLES / "probe.js")
            check("re-installing the same id leaves exactly one row", page.locator('[data-plugin-row="npp.probe"]').count() == 1)
            check("and enables it", row_status(page, "npp.probe") == "enabled")
            close_manager(page)
            page.wait_for_timeout(300)
            check("its extension is back", page.locator(".cm-editor[data-plugin-probe]").count() >= 1)
            clean(page)

            # ── 11. offline: the worker serves, the plugins come from IndexedDB ──
            server.shutdown()
            server.server_close()
            time.sleep(0.3)
            served.clear()
            log_before = len(LOG)
            page.reload(wait_until="load", timeout=30000)
            page.wait_for_selector(".cm-editor", timeout=20000)
            page.wait_for_timeout(1000)
            dismiss_dialogs(page)
            check("with the server stopped the app still loads", page.locator(".cm-editor").count() >= 1)
            check(
                "every response came from the service worker",
                len(served) > 0
                and all(flag for url, flag in served if not url.startswith("blob:")),
                f"{sum(1 for _, flag in served if flag)}/{len(served)} (plugin modules load from blob: URLs)",
            )
            check("the server was not asked", len(LOG) == log_before, str(LOG[log_before:]))
            check("plugins load from storage with no server", wait_for_dock(page))
            select_all_and_type(page, "offline")
            page.keyboard.press("Control+a")
            page.wait_for_timeout(150)
            run_menu_command(page, "plugin:npp.base64/encode")
            check("a plugin command still runs offline", editor_text(page).strip() == "b2ZmbGluZQ==", editor_text(page)[:30])

            # ── 12. the promises that survive every task ─────────────────────────
            offsite = [
                url
                for url in requests
                if not url.startswith(("http://127.0.0.1", "http://localhost", "blob:", "data:", "about:"))
            ]
            check("no request left the machine (D1)", not offsite, ", ".join(offsite[:3]))
            page.screenshot(path=str(SHOTS / "plugins-acceptance.png"))
            context.close()
    finally:
        try:
            server.shutdown()
        except Exception:
            pass
        shutil.rmtree(profile, ignore_errors=True)
        shutil.rmtree(scratch, ignore_errors=True)

    check("no uncaught page errors", not page_errors, "; ".join(page_errors[:3]))
    check("no console errors", not console_errors, "; ".join(console_errors[:3]))

    failed = [name for name, ok, _ in results if not ok]
    print(f"\n{'=' * 60}")
    print(f"VERIFY-PLUGINS: {'PASS' if not failed else 'FAIL'}  ({len(results) - len(failed)}/{len(results)} checks)")
    if failed:
        print("failed: " + "; ".join(failed))
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
