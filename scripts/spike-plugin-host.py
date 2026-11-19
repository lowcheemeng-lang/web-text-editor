"""P1 — plugin host loader spike.

The plan's gate on P2–P8. It measures six things the design must not assume:

  1. a plugin module imports from a **blob URL** (`import()`), in the dev server;
  2. an extension built from the host's own CodeMirror modules is **accepted** by
     a mounted view (the singleton rule), and the plugin sees the same EditorView
     class the host built the view with;
  3. the same extension reaches **both panes** of a split view through one shared
     `Compartment`;
  4. disposing the plugin's registration removes it from both panes;
  5. a module that throws in `activate` is contained — the editor still types,
     and the app's own workspace is still alive;
  6. a persisted source re-imports after a reload with a **fresh** blob URL
     (the storage half is P2; this measures the module-cache behaviour), and a
     blob import also works in a **production build** with the service worker
     controlling the page.

It starts its own dev server, builds and serves `dist/` for the production half,
and exits 0 only if every check passes. Prerequisites: `npm install`, system
Chrome, Python Playwright (the same harness the other checks use).

Run: python3 scripts/spike-plugin-host.py
"""

from __future__ import annotations

import functools
import http.server
import json
import os
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "scripts" / "fixtures"
SHOT_DIR = ROOT / ".hermes" / "cache" / "screenshots"

PROBE = (FIXTURES / "plugin-probe.js").read_text(encoding="utf-8")
BROKEN = (FIXTURES / "plugin-broken.js").read_text(encoding="utf-8")

# A module that needs nothing but the page: what "does blob import work here?"
# means in the production bundle, where the dev-only harness is not included.
PROD_SOURCE = """
export default {
  id: "spike.prod",
  name: "Production blob probe",
  version: "1.0.0",
  apiVersion: 1,
  activate() { window.__prodBlob = { answer: 42, loaded: true }; },
};
"""

checks: list[tuple[str, bool, str]] = []
console: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    checks.append((name, bool(ok), detail))
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {name}" + (f" — {detail}" if detail else ""))
    return bool(ok)


def free_port(start: int) -> int:
    for port in range(start, start + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise RuntimeError(f"no free port in {start}..{start + 20}")


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
    if not binary.exists():
        raise RuntimeError("node_modules/.bin/vite is missing — run npm install")
    log = open(ROOT / ".hermes" / "cache" / "spike-plugin-host.dev.log", "w", encoding="utf-8")
    process = subprocess.Popen(
        [str(binary), "--port", str(port), "--strictPort"],
        cwd=ROOT,
        stdout=log,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    if not wait_port(port):
        stop_process(process)
        raise RuntimeError(f"dev server did not open port {port}")
    return process


def stop_process(process: subprocess.Popen[str]) -> None:
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


def serve_dist(port: int) -> tuple[http.server.ThreadingHTTPServer, threading.Thread]:
    class Handler(http.server.SimpleHTTPRequestHandler):
        def end_headers(self) -> None:
            # The browser's HTTP cache must never stand in for the service worker
            # (the same rule verify-task8.py follows).
            self.send_header("Cache-Control", "no-cache")
            super().end_headers()

        def log_message(self, fmt: str, *args: object) -> None:  # keep the output readable
            pass

    handler = functools.partial(Handler, directory=str(ROOT / "dist"))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


def mount_harness(page) -> bool:
    """Import the dev-only harness through Vite's module graph.

    The first import of a dependency Vite has not pre-bundled forces an optimise
    pass and a reload, which destroys the execution context — so retry, exactly
    as scripts/spike-r2-split.py does.
    """
    for _ in range(4):
        try:
            page.evaluate(
                "async () => { const m = await import('/src/editor/spike-plugin-host.ts');"
                " m.runSpikePluginHost(document.body); return true; }"
            )
            if page.evaluate("() => Boolean(window.__spikePlugin)"):
                return True
        except Exception:
            pass
        page.wait_for_load_state("load")
        page.wait_for_timeout(500)
    return False


def snapshot(page) -> dict:
    return page.evaluate("() => window.__spikePlugin.snapshot()")


def load(page, source: str) -> dict:
    return page.evaluate(
        "async ({ source }) => await window.__spikePlugin.load(source)",
        {"source": source},
    )


def main() -> int:
    SHOT_DIR.mkdir(parents=True, exist_ok=True)
    (ROOT / ".hermes" / "cache").mkdir(parents=True, exist_ok=True)

    dev_port = free_port(5174)
    dev = start_dev(dev_port)
    prod_server = None
    browser = None

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome", headless=True)
            page = browser.new_page(viewport={"width": 1280, "height": 800})
            page.on(
                "console",
                lambda m: console.append(f"console.{m.type}: {m.text}")
                if m.type in ("error", "warning")
                else None,
            )
            page.on("pageerror", lambda e: console.append(f"pageerror: {e}"))

            url = f"http://127.0.0.1:{dev_port}/"
            response = page.goto(url, wait_until="load")
            check("dev server answers", bool(response and response.status == 200), f"HTTP {response.status if response else 'none'}")

            mounted = mount_harness(page)
            check("harness mounts from the dev server", mounted)
            if not mounted:
                raise RuntimeError("could not mount the plugin spike harness")

            page.wait_for_selector("#spike-plugin-owner .cm-editor", timeout=15000)
            page.wait_for_selector("#spike-plugin-clone .cm-editor", timeout=15000)
            editors = page.eval_on_selector_all("#spike-plugin .cm-editor", "els => els.length")
            check("two panes over one document", editors == 2, f"{editors} editors")

            # -- 1 + 2: blob import, and an extension from the host's CM6 ------
            first = load(page, PROBE)
            check("plugin imports from a blob URL", first.get("ok") is True, first.get("error", ""))
            check("blob URL is a blob: URL", str(first.get("url", "")).startswith("blob:"), str(first.get("url", ""))[:40])

            after_load = snapshot(page)
            results = after_load.get("results", {})
            check("plugin received the host's EditorView class", results.get("viewInstanceof") is True)
            check("plugin sees apiVersion 1", results.get("apiVersion") == 1)
            check("ctx.cm exposes the app's commands module", results.get("cmHasCommands") is True)
            check("ctx.cm exposes the app's search module", results.get("cmHasSearch") is True)
            check("plugin id arrives from the module", results.get("pluginId") == "spike.probe")
            check("extension accepted by the mounted view", results.get("extensionAccepted") is True)
            check("extension applied to the owner pane", after_load.get("ownerHasClass") is True)
            check("extension applied to the clone pane", after_load.get("cloneHasClass") is True)
            check("decorations render in the owner pane", after_load.get("ownerMarks", 0) > 0, f"{after_load.get('ownerMarks')} marks")
            check("decorations render in the clone pane", after_load.get("cloneMarks", 0) > 0, f"{after_load.get('cloneMarks')} marks")

            # -- 4: teardown reaches both panes --------------------------------
            page.evaluate("() => window.__spikePlugin.unload()")
            after_unload = snapshot(page)
            check("teardown clears the owner pane", after_unload.get("ownerHasClass") is False and after_unload.get("ownerMarks") == 0)
            check("teardown clears the clone pane", after_unload.get("cloneHasClass") is False and after_unload.get("cloneMarks") == 0)
            check("no extensions left registered", after_unload.get("extensions") == 0, str(after_unload.get("extensions")))

            # -- 6a: enabling again is a new module instance -------------------
            second = load(page, PROBE)
            after_second = snapshot(page)
            urls = after_second.get("urls", [])
            check("second enable succeeds", second.get("ok") is True, second.get("error", ""))
            check("each enable creates a fresh blob URL", len(urls) == 2 and urls[0] != urls[1], f"{len(urls)} URLs, distinct={len(set(urls)) == len(urls)}")
            check("re-enabled plugin paints again", after_second.get("ownerHasClass") is True and after_second.get("cloneHasClass") is True)

            page.evaluate("() => window.__spikePlugin.unload()")

            # -- 5: a failing plugin is contained -------------------------------
            broken = load(page, BROKEN)
            check("broken plugin reports its error", broken.get("ok") is False and "spike boom" in str(broken.get("error")), str(broken.get("error")))

            before_typing = snapshot(page)
            page.click("#spike-plugin-owner .cm-content")
            page.keyboard.type("Z")
            after_typing = snapshot(page)
            check(
                "editor still accepts typing after a failed plugin",
                len(after_typing.get("ownerText", "")) > len(before_typing.get("ownerText", "")),
                f"{len(before_typing.get('ownerText', ''))} -> {len(after_typing.get('ownerText', ''))}",
            )
            check(
                "the app's own workspace is still mounted",
                page.evaluate("() => Boolean(window.__workspace && window.__workspace.inspect().documents >= 1)") is True,
            )

            # -- 6b: source persists, module re-imports after a reload ----------
            page.evaluate(
                "([key, value]) => localStorage.setItem(key, value)",
                ["spike.plugin.source", PROBE],
            )
            page.reload(wait_until="load")
            remounted = mount_harness(page)
            check("harness remounts after reload", remounted)
            restored = page.evaluate("() => localStorage.getItem('spike.plugin.source') ?? ''")
            check("source survives the reload", restored == PROBE, f"{len(restored)} bytes")
            if remounted:
                page.wait_for_selector("#spike-plugin-owner .cm-editor", timeout=15000)
                reloaded = load(page, restored)
                after_reload = snapshot(page)
                check("restored source imports again", reloaded.get("ok") is True, reloaded.get("error", ""))
                check(
                    "a reload starts a fresh module cache",
                    len(after_reload.get("urls", [])) == 1,
                    f"{len(after_reload.get('urls', []))} URL this page",
                )
                check("restored plugin paints in both panes", after_reload.get("ownerHasClass") is True and after_reload.get("cloneHasClass") is True)

            # -- 6c: production build, service worker controlling --------------
            dev_snapshot = page.url
            stop_process(dev)
            page.close()

            build = subprocess.run(
                ["npm", "run", "build"], cwd=ROOT, capture_output=True, text=True
            )
            check("production build succeeds", build.returncode == 0, (build.stderr or build.stdout)[-200:] if build.returncode else "")
            if build.returncode != 0:
                raise RuntimeError("npm run build failed")

            prod_port = free_port(5180)
            prod_server, _ = serve_dist(prod_port)
            prod_requests: list[str] = []
            prod = browser.new_page(viewport={"width": 1280, "height": 800})
            prod.on("request", lambda request: prod_requests.append(request.url))
            prod.on("pageerror", lambda e: console.append(f"prod pageerror: {e}"))
            prod.goto(f"http://127.0.0.1:{prod_port}/", wait_until="load")
            prod.wait_for_selector(".cm-editor", timeout=15000)
            check("production app mounts", prod.eval_on_selector_all(".cm-editor", "els => els.length") >= 1)

            # The worker controls the page after its activate handler claims it.
            controlled = False
            for _ in range(40):
                controlled = prod.evaluate("() => Boolean(navigator.serviceWorker.controller)")
                if controlled:
                    break
                prod.wait_for_timeout(100)
            check("service worker controls the production page", controlled)

            prod_result = prod.evaluate(
                "async ({ source }) => {"
                " const url = URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));"
                " const mod = await import(url);"
                " await mod.default.activate();"
                " return { ok: true, url, flag: window.__prodBlob };"
                "}",
                {"source": PROD_SOURCE},
            )
            check("blob import works in the production build", prod_result.get("ok") is True)
            check("the production module actually ran", (prod_result.get("flag") or {}).get("answer") == 42, json.dumps(prod_result.get("flag")))

            page_requests = [u for u in prod_requests if not u.startswith("blob:")]
            off_origin = [u for u in page_requests if not u.startswith(f"http://127.0.0.1:{prod_port}/")]
            check("no request leaves the app's origin", not off_origin, "; ".join(off_origin[:3]))
            check("the blob import fetched nothing", not [u for u in page_requests if "spike" in u or "plugin" in u])

            prod.screenshot(path=str(SHOT_DIR / "spike-plugin-host-prod.png"), full_page=False)
            prod.close()

            check("no console errors or page errors", not [line for line in console if "error" in line.lower()], "; ".join(console[:3]))

            _ = dev_snapshot  # kept for debugging when a phase fails
    finally:
        if prod_server is not None:
            prod_server.shutdown()
        try:
            stop_process(dev)
        except Exception:
            pass
        # The `with sync_playwright()` block owns the browser; closing it here runs
        # after that block has stopped the driver's event loop ("Event loop is closed",
        # measured on the first run) and turns a passing spike into a traceback.

    passed = sum(1 for _, ok, _ in checks if ok)
    total = len(checks)
    print()
    print(f"PLUGIN_SPIKE: {'PASS' if passed == total else 'FAIL'} ({passed}/{total})")
    if passed != total:
        print("\nFailures:")
        for name, ok, detail in checks:
            if not ok:
                print(f"  - {name}" + (f" — {detail}" if detail else ""))
        if console:
            print("\nConsole:")
            for line in console[:20]:
                print(f"  {line}")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
