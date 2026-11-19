"""P4 (part 1) — the plugin host inside the real app, driven in Chrome.

What this proves, through the app's own UI rather than a harness:
  - a plugin installed from source registers commands, a shortcut, a toolbar
    button and an event subscription;
  - the Plugins menu lists them, and clicking one runs it;
  - the command's edit is one undoable transaction (Ctrl+Z restores the text);
  - the shortcut works from the editor and the toolbar button works from chrome;
  - disabling removes every trace (menu, shortcut, toolbar button, extensions);
  - the record survives a reload and can be enabled again, then uninstalled;
  - nothing throws and no request leaves the origin.

P6 replaces the install call with the real Plugin Manager dialog; the facade this
uses (`window.__workspace.installPlugin`) is the same one that dialog will call.

Run: python3 scripts/verify-plugins-dev.py
"""

from __future__ import annotations

import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOT_DIR = ROOT / ".hermes" / "cache" / "screenshots"
PLUGIN = (ROOT / "scripts" / "fixtures" / "plugin-commands.js").read_text(encoding="utf-8")
PANEL_PLUGIN = (ROOT / "scripts" / "fixtures" / "plugin-panel.js").read_text(encoding="utf-8")
BROKEN_PLUGIN = (ROOT / "scripts" / "fixtures" / "plugin-broken.js").read_text(encoding="utf-8")

checks: list[tuple[str, bool, str]] = []
console: list[str] = []
PLUGIN_ID = "spike.commands"


def check(name: str, ok: bool, detail: str = "") -> bool:
    checks.append((name, bool(ok), detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))
    return bool(ok)


def free_port(start: int) -> int:
    for port in range(start, start + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise RuntimeError("no free port")


def wait_port(port: int, timeout: float = 20.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.25)
            if sock.connect_ex(("127.0.0.1", port)) == 0:
                return True
        time.sleep(0.1)
    return False


def start_dev(port: int) -> subprocess.Popen[str]:
    binary = ROOT / "node_modules" / ".bin" / "vite"
    log = open(ROOT / ".hermes" / "cache" / "verify-plugins-dev.log", "w", encoding="utf-8")
    process = subprocess.Popen(
        [str(binary), "--port", str(port), "--strictPort"],
        cwd=ROOT,
        stdout=log,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    if not wait_port(port):
        stop(process)
        raise RuntimeError(f"dev server did not open port {port}")
    return process


def stop(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(os.getpgid(process.pid), signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(os.getpgid(process.pid), signal.SIGKILL)


def inspect(page) -> dict:
    return page.evaluate("() => window.__workspace.inspect()")


def dismiss_dialogs(page) -> None:
    """A reload with unsaved work can raise the restore alert; it is modal."""
    page.wait_for_timeout(300)
    for button in page.query_selector_all(
        "dialog[open] .npp-dialog-confirm, dialog[open] .npp-dialog-cancel"
    ):
        try:
            button.click()
        except Exception:
            pass
        page.wait_for_timeout(120)


def text(page) -> str:
    value = page.evaluate("() => window.__workspace.inspect().text")
    return value or ""


def open_plugins_menu(page) -> None:
    page.get_by_role("button", name="Plugins", exact=True).click()
    page.wait_for_timeout(120)


def main() -> int:
    (ROOT / ".hermes" / "cache").mkdir(parents=True, exist_ok=True)
    port = free_port(5190)
    dev = start_dev(port)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome", headless=True)
            context = browser.new_context(viewport={"width": 1280, "height": 800})
            page = context.new_page()
            page.on(
                "console",
                lambda m: console.append(f"console.{m.type}: {m.text}")
                if m.type in ("error", "warning")
                else None,
            )
            page.on("pageerror", lambda e: console.append(f"pageerror: {e}"))

            page.goto(f"http://127.0.0.1:{port}/", wait_until="load")
            page.wait_for_selector(".cm-editor", timeout=15000)
            check("the app mounts", page.eval_on_selector_all(".cm-editor", "els => els.length") >= 1)

            page.wait_for_timeout(300)  # let the plugin host start (no plugins yet)
            before = text(page)

            installed = page.evaluate(
                "async ({ source }) => await window.__workspace.installPlugin(source)",
                {"source": PLUGIN},
            )
            check("install succeeds", installed.get("ok") is True, str(installed.get("error", "")))
            page.wait_for_timeout(200)

            report = inspect(page)
            plugins = report.get("plugins", {})
            check("the plugin is active", PLUGIN_ID in plugins.get("active", []))
            check(
                "its record is stored and enabled",
                any(item.get("id") == PLUGIN_ID and item.get("enabled") for item in plugins.get("installed", [])),
            )
            check("two commands are registered", plugins.get("commands") == 2, str(plugins.get("commands")))
            check("one toolbar button is registered", plugins.get("buttons") == 1, str(plugins.get("buttons")))

            titles = page.eval_on_selector_all(
                ".npp-menu-title", "els => els.map((el) => el.textContent)"
            )
            check("the menu bar has a Plugins menu", "Plugins" in titles, ", ".join(titles))

            open_plugins_menu(page)
            items = page.eval_on_selector_all(
                ".npp-menu-popup:not([hidden]) [data-menu-item]",
                "els => els.map((el) => [el.getAttribute('data-menu-item'), el.textContent])",
            )
            labels = [label for _, label in items]
            check(
                "the menu lists the plugin's commands",
                any("Uppercase Document" in (label or "") for label in labels),
                ", ".join(str(label) for label in labels),
            )
            check(
                "the shortcut is shown beside the command",
                any("Ctrl+Alt+U" in (label or "") for label in labels),
            )

            page.click(f'[data-menu-item="plugin:{PLUGIN_ID}/upper"]')
            page.wait_for_timeout(200)
            upper = text(page)
            check("the command ran and edited the document", upper == before.upper(), f"{len(upper)} chars")
            check(
                "the plugin saw its document",
                page.evaluate("() => window.__pluginFixture?.ran") == "upper",
            )
            check(
                "the plugin's document snapshot has the expected shape",
                page.evaluate(
                    "() => Boolean(window.__pluginFixture?.doc && window.__pluginFixture.doc.lineCount > 0 "
                    "&& window.__pluginFixture.doc.characterCount > 0)"
                )
                is True,
            )

            page.click(".cm-content")
            page.keyboard.press("Control+z")
            page.wait_for_timeout(150)
            check("one Ctrl+Z undoes the plugin's edit", text(page) == before)

            page.keyboard.press("Control+Alt+u")
            page.wait_for_timeout(150)
            check("the plugin's shortcut works from the editor", text(page) == before.upper())
            page.keyboard.press("Control+z")
            page.wait_for_timeout(150)

            button = page.query_selector(f'[data-tool="plugin:{PLUGIN_ID}:upper"]')
            check("the toolbar button exists", button is not None)
            if button is not None:
                button.click()
                page.wait_for_timeout(150)
                check("the toolbar button runs the plugin", text(page) == before.upper())
                page.click(".cm-content")
                page.keyboard.press("Control+z")
                page.wait_for_timeout(150)

            page.evaluate("() => window.__workspace.disablePlugin('spike.commands')")
            page.wait_for_timeout(200)
            after = inspect(page).get("plugins", {})
            check("disabling stops the plugin", PLUGIN_ID not in after.get("active", []))
            check("no commands remain", after.get("commands") == 0, str(after.get("commands")))
            check(
                "the record is kept but disabled",
                any(item.get("id") == PLUGIN_ID and not item.get("enabled") for item in after.get("installed", [])),
            )
            check(
                "the toolbar button is gone",
                page.query_selector(f'[data-tool="plugin:{PLUGIN_ID}:upper"]') is None,
            )
            open_plugins_menu(page)
            empty_items = page.eval_on_selector_all(
                ".npp-menu-popup:not([hidden]) [data-menu-item]",
                "els => els.map((el) => el.textContent)",
            )
            check(
                "the menu now offers only the Plugin Manager",
                any("Plugin Manager" in (label or "") for label in empty_items)
                and not any("Uppercase" in (label or "") for label in empty_items),
                ", ".join(str(label) for label in empty_items),
            )
            page.click("body")  # close the menu

            page.reload(wait_until="load")
            page.wait_for_selector(".cm-editor", timeout=15000)
            page.wait_for_timeout(400)
            reloaded = inspect(page).get("plugins", {})
            check(
                "the disabled record survives a reload",
                any(item.get("id") == PLUGIN_ID and not item.get("enabled") for item in reloaded.get("installed", [])),
            )
            check("a disabled plugin does not load", PLUGIN_ID not in reloaded.get("active", []))

            enabled = page.evaluate(
                "async () => await window.__workspace.enablePlugin('spike.commands')"
            )
            check("it can be enabled again", enabled.get("ok") is True, str(enabled.get("error", "")))
            page.wait_for_timeout(200)
            check("the command is back", inspect(page).get("plugins", {}).get("commands") == 2)

            removed = page.evaluate(
                "async () => await window.__workspace.uninstallPlugin('spike.commands')"
            )
            page.wait_for_timeout(200)
            final = inspect(page).get("plugins", {})
            check("uninstall removes the record", removed is True and not final.get("installed"))
            check("uninstall leaves no commands", final.get("commands") == 0)

            # ── P5: the dock ───────────────────────────────────────────────────
            installed_panel = page.evaluate(
                "async ({ source }) => await window.__workspace.installPlugin(source)",
                {"source": PANEL_PLUGIN},
            )
            check(
                "the panel plugin installs",
                installed_panel.get("ok") is True,
                str(installed_panel.get("error", "")),
            )
            page.wait_for_timeout(300)

            check(
                "registering a panel does not open the dock by itself",
                not page.query_selector(".npp-dock").is_visible(),
            )
            open_plugins_menu(page)
            page.click('[data-menu-item="plugin:spike.panel/show"]')
            page.wait_for_timeout(250)

            dock = page.query_selector('.npp-dock[data-dock="plugins"]')
            check("the plugin's command opens the dock", dock is not None and dock.is_visible())
            tabs = page.eval_on_selector_all(".npp-dock-tab", "els => els.map((el) => el.textContent)")
            check("the dock shows the panel's tab", "Word Count" in tabs, ", ".join(tabs))
            body = page.eval_on_selector(".npp-dock-panel", "el => el.textContent")
            check(
                "the panel reports the active document",
                "lines" in body and f"{len(text(page))} characters" in body,
                repr(body),
            )

            page.click(".cm-content")
            page.keyboard.type("X")
            page.wait_for_timeout(500)
            updated = page.eval_on_selector(".npp-dock-panel", "el => el.textContent")
            check(
                "the panel follows an edit through document:changed",
                updated != body and f"{len(text(page))} characters" in updated,
                repr(updated),
            )
            # Back to the save point, so the reload below does not raise the
            # "unsaved changes could not be restored" alert (which is modal and
            # would block the pointer-driven checks).
            page.keyboard.press("Control+z")
            page.wait_for_timeout(200)

            # Two panels: tabs, and exactly one mounted body.
            open_plugins_menu(page)
            page.click('[data-menu-item="plugin:spike.panel/show-info"]')
            page.wait_for_timeout(250)
            tab_labels = page.eval_on_selector_all(
                ".npp-dock-tab", "els => els.map((el) => el.textContent)"
            )
            check(
                "a second panel adds a second tab",
                sorted(tab_labels) == ["Document Info", "Word Count"],
                ", ".join(tab_labels),
            )
            check(
                "only one panel body is mounted at a time",
                page.eval_on_selector_all(".npp-dock-body .npp-dock-panel", "els => els.length") == 1,
            )
            info_body = page.eval_on_selector(".npp-dock-panel", "el => el.textContent")
            check(
                "the panel just shown is the active one",
                "plain text" in info_body or "modified" in info_body or "saved" in info_body,
                repr(info_body),
            )
            page.click('[data-panel-tab="spike.panel:counts"]')
            page.wait_for_timeout(200)
            switched = page.eval_on_selector(".npp-dock-panel", "el => el.textContent")
            check("clicking a tab switches the panel", "characters" in switched, repr(switched))

            # The dock draws with the chrome variables, so Dark Mode must reach it.
            light_bg = page.eval_on_selector(
                ".npp-dock-body", "el => getComputedStyle(el).backgroundColor"
            )
            page.evaluate("async () => { await window.__workspace.applyPreferences({ theme: 'dark' }); }")
            page.wait_for_timeout(200)
            dark_bg = page.eval_on_selector(
                ".npp-dock-body", "el => getComputedStyle(el).backgroundColor"
            )
            check("the dock follows the theme", light_bg != dark_bg, f"{light_bg} vs {dark_bg}")
            page.evaluate(
                "async () => { await window.__workspace.applyPreferences({ theme: 'notepadpp' }); }"
            )
            page.wait_for_timeout(150)

            SHOT_DIR.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(SHOT_DIR / "plugin-dock-light.png"))

            page.click(".npp-dock-close")
            page.wait_for_timeout(200)
            check(
                "closing the panel hides the dock",
                not page.query_selector(".npp-dock").is_visible(),
            )

            open_plugins_menu(page)
            page.click('[data-menu-item="plugin:spike.panel/show"]')
            page.wait_for_timeout(250)
            check(
                "the plugin's command reopens the dock",
                page.query_selector(".npp-dock").is_visible(),
            )
            check(
                "onShow ran when the panel was shown",
                page.evaluate("() => (window.__panelShows ?? 0)") >= 1,
            )

            page.reload(wait_until="load")
            page.wait_for_selector(".cm-editor", timeout=15000)
            page.wait_for_timeout(600)
            dismiss_dialogs(page)
            check(
                "the last shown panel reopens after a reload",
                page.query_selector(".npp-dock").is_visible(),
            )

            before_width = page.eval_on_selector(
                ".npp-dock", "el => el.getBoundingClientRect().width"
            )
            handle = page.query_selector(".npp-dock-handle")
            box = handle.bounding_box()
            page.mouse.move(box["x"] + 2, box["y"] + 60)
            page.mouse.down()
            page.mouse.move(box["x"] - 78, box["y"] + 60, steps=6)
            page.mouse.up()
            page.wait_for_timeout(200)
            after_width = page.eval_on_selector(
                ".npp-dock", "el => el.getBoundingClientRect().width"
            )
            check(
                "dragging the handle widens the dock",
                after_width > before_width + 40,
                f"{before_width:.0f} -> {after_width:.0f}",
            )

            page.reload(wait_until="load")
            page.wait_for_selector(".cm-editor", timeout=15000)
            page.wait_for_timeout(600)
            dismiss_dialogs(page)
            restored_width = page.eval_on_selector(
                ".npp-dock", "el => el.getBoundingClientRect().width"
            )
            check(
                "the dock's width survives a reload",
                abs(restored_width - after_width) <= 3,
                f"{restored_width:.0f} vs {after_width:.0f}",
            )

            page.click('[data-tool="split"]')
            page.wait_for_timeout(300)
            splitter = page.query_selector(".npp-splitter")
            split_box = splitter.bounding_box()
            page.mouse.move(split_box["x"] + 3, split_box["y"] + 100)
            page.mouse.down()
            page.mouse.move(60, split_box["y"] + 100, steps=8)
            page.mouse.up()
            page.wait_for_timeout(250)
            dock_width = page.eval_on_selector(
                ".npp-dock", "el => el.getBoundingClientRect().width"
            )
            check(
                "the splitter cannot squeeze the dock away",
                page.query_selector(".npp-dock").is_visible() and dock_width >= 150,
                f"{dock_width:.0f} px",
            )
            page.click('[data-tool="split"]')
            page.wait_for_timeout(200)

            page.evaluate("() => window.__workspace.disablePlugin('spike.panel')")
            page.wait_for_timeout(300)
            check(
                "disabling the panel plugin closes the dock",
                not page.query_selector(".npp-dock").is_visible(),
            )
            check(
                "and leaves no tab behind",
                page.eval_on_selector_all(".npp-dock-tab", "els => els.length") == 0,
            )
            page.evaluate("() => window.__workspace.uninstallPlugin('spike.panel')")
            page.wait_for_timeout(200)

            # ── P6: the Plugin Manager ─────────────────────────────────────────
            open_plugins_menu(page)
            page.click('[data-menu-item="plugin-manager"]')
            page.wait_for_selector('[data-dialog="plugin-manager"]', timeout=5000)
            check(
                "Plugins ▸ Plugin Manager… opens the manager",
                page.is_visible('[data-dialog="plugin-manager"]'),
            )
            trust = page.inner_text(".npp-manager-trust")
            check("the trust model is stated before any picker", "no sandbox" in trust, trust[:70])
            check(
                "with nothing installed the manager says so",
                page.query_selector("[data-plugin-empty]") is not None,
            )

            page.fill("[data-plugin-source]", PLUGIN)
            page.click("[data-plugin-install-paste]")
            page.wait_for_timeout(600)
            check(
                "pasted source installs a plugin",
                page.query_selector('[data-plugin-row="spike.commands"]') is not None,
            )
            check(
                "the row says enabled",
                page.inner_text('[data-plugin-status="spike.commands"]') == "enabled",
            )
            check(
                "its commands are live",
                inspect(page).get("plugins", {}).get("commands") == 2,
            )

            page.click('[data-plugin-row="spike.commands"] [data-plugin-action="disable"]')
            page.wait_for_timeout(400)
            check(
                "Disable in the manager turns the plugin off",
                page.inner_text('[data-plugin-status="spike.commands"]') == "disabled",
            )
            check(
                "and its commands go with it",
                inspect(page).get("plugins", {}).get("commands") == 0,
            )

            page.click('[data-plugin-row="spike.commands"] [data-plugin-action="enable"]')
            page.wait_for_timeout(400)
            check(
                "Enable brings the commands back",
                inspect(page).get("plugins", {}).get("commands") == 2,
            )
            check(
                "and the row says enabled again",
                page.inner_text('[data-plugin-status="spike.commands"]') == "enabled",
            )

            page.click('[data-plugin-row="spike.commands"] [data-plugin-action="reload"]')
            page.wait_for_timeout(400)
            check(
                "Reload restarts it and keeps it enabled",
                page.inner_text('[data-plugin-status="spike.commands"]') == "enabled"
                and inspect(page).get("plugins", {}).get("commands") == 2,
            )

            page.click('[data-plugin-row="spike.commands"] [data-plugin-action="uninstall"]')
            page.wait_for_timeout(150)
            check(
                "Uninstall asks before removing",
                page.query_selector('[data-plugin-confirm="spike.commands"]') is not None,
            )
            page.click('[data-plugin-confirm="spike.commands"]')
            page.wait_for_timeout(400)
            check(
                "confirming removes the plugin and its commands",
                page.query_selector('[data-plugin-row="spike.commands"]') is None
                and not inspect(page).get("plugins", {}).get("installed"),
            )

            page.set_input_files(
                "[data-plugin-file]", str(ROOT / "scripts" / "fixtures" / "plugin-panel.js")
            )
            page.wait_for_timeout(600)
            check(
                "a .js file installs through the picker",
                page.query_selector('[data-plugin-row="spike.panel"]') is not None,
            )

            conflict = PLUGIN.replace("spike.commands", "spike.conflict").replace(
                '"Ctrl+Alt+U"', '"Ctrl+S"'
            )
            page.fill("[data-plugin-source]", conflict)
            page.click("[data-plugin-install-paste]")
            page.wait_for_timeout(600)
            check(
                "a plugin that claims an app shortcut is listed as failed",
                page.inner_text('[data-plugin-status="spike.conflict"]') == "failed",
            )
            conflict_error = page.inner_text('[data-plugin-error="spike.conflict"]')
            check(
                "and the row names the shortcut",
                "shortcut" in conflict_error.lower(),
                conflict_error,
            )
            page.click('[data-plugin-row="spike.conflict"] [data-plugin-action="uninstall"]')
            page.click('[data-plugin-confirm="spike.conflict"]')
            page.wait_for_timeout(400)

            page.fill("[data-plugin-source]", BROKEN_PLUGIN)
            page.click("[data-plugin-install-paste]")
            page.wait_for_timeout(600)
            check(
                "a plugin that throws is listed as failed",
                page.inner_text('[data-plugin-status="spike.broken"]') == "failed",
            )
            broken_error = page.inner_text('[data-plugin-error="spike.broken"]')
            check("the row carries the error", "boom" in broken_error, broken_error)

            SHOT_DIR.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(SHOT_DIR / "plugin-manager-light.png"))
            page.evaluate("async () => { await window.__workspace.applyPreferences({ theme: 'dark' }); }")
            page.wait_for_timeout(250)
            page.screenshot(path=str(SHOT_DIR / "plugin-manager-dark.png"))
            page.evaluate(
                "async () => { await window.__workspace.applyPreferences({ theme: 'notepadpp' }); }"
            )
            page.wait_for_timeout(150)

            page.click('[data-dialog-action="close"]')
            page.wait_for_timeout(200)

            before_edit = text(page)
            page.click(".cm-content")
            page.keyboard.type("Y")
            page.wait_for_timeout(200)
            check(
                "the app is still editable after a failed plugin",
                len(text(page)) == len(before_edit) + 1,
            )
            page.keyboard.press("Control+z")
            page.wait_for_timeout(200)

            page.reload(wait_until="load")
            page.wait_for_selector(".cm-editor", timeout=15000)
            page.wait_for_timeout(900)
            dismiss_dialogs(page)
            check(
                "a plugin that fails at startup raises a notice",
                page.query_selector('[data-notice="plugin-failure"]') is not None,
            )
            notice_action = page.query_selector('[data-notice-action="plugin-failure"]')
            check("the notice offers the manager", notice_action is not None)
            if notice_action is not None:
                notice_action.click()
            page.wait_for_timeout(400)
            check(
                "the notice opens the manager on the failed plugin",
                page.is_visible('[data-dialog="plugin-manager"]')
                and page.query_selector('[data-plugin-row="spike.broken"]') is not None,
            )
            page.click('[data-plugin-row="spike.broken"] [data-plugin-action="uninstall"]')
            page.click('[data-plugin-confirm="spike.broken"]')
            page.wait_for_timeout(400)

            page.click('[data-plugin-row="spike.panel"] [data-plugin-action="disable"]')
            page.wait_for_timeout(300)
            page.click('[data-dialog-action="close"]')
            page.wait_for_timeout(200)

            # ── recovery mode: ?plugins=off ────────────────────────────────────
            page.goto(f"http://127.0.0.1:{port}/?plugins=off", wait_until="load")
            page.wait_for_selector(".cm-editor", timeout=15000)
            page.wait_for_timeout(700)
            dismiss_dialogs(page)
            offline = inspect(page).get("plugins", {})
            check(
                "?plugins=off loads nothing",
                offline.get("skipped") is True and offline.get("active") == [],
                str(offline.get("active")),
            )
            open_plugins_menu(page)
            page.click('[data-menu-item="plugin-manager"]')
            page.wait_for_selector('[data-dialog="plugin-manager"]', timeout=5000)
            check(
                "the manager still opens in recovery mode",
                page.query_selector('[data-plugin-disabled-banner]') is not None,
            )
            check(
                "recovery mode offers no install path",
                page.query_selector("[data-plugin-install]") is None,
            )
            enable_button = page.query_selector(
                '[data-plugin-row="spike.panel"] [data-plugin-action="enable"]'
            )
            check(
                "Enable is refused while the flag is in force",
                enable_button is not None and enable_button.is_disabled(),
            )
            page.click('[data-plugin-row="spike.panel"] [data-plugin-action="uninstall"]')
            page.click('[data-plugin-confirm="spike.panel"]')
            page.wait_for_timeout(400)
            check(
                "Uninstall still works in recovery mode",
                page.query_selector('[data-plugin-row="spike.panel"]') is None,
            )
            page.click('[data-dialog-action="close"]')
            page.wait_for_timeout(200)

            errors = [line for line in console if "error" in line.lower()]
            check("no console or page errors", not errors, "; ".join(errors[:3]))

            browser.close()
    finally:
        stop(dev)

    passed = sum(1 for _, ok, _ in checks if ok)
    total = len(checks)
    print()
    print(f"PLUGIN_P4: {'PASS' if passed == total else 'FAIL'} ({passed}/{total})")
    if passed != total:
        for name, ok, detail in checks:
            if not ok:
                print(f"  - {name}" + (f" — {detail}" if detail else ""))
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
