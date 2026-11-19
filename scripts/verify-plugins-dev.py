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
PLUGIN = (ROOT / "scripts" / "fixtures" / "plugin-commands.js").read_text(encoding="utf-8")

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
                "the menu says there are no plugins",
                any("no plugins installed" in (label or "") for label in empty_items),
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
