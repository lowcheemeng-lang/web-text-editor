"""Task 8 acceptance check — the installable, offline-capable web app.

    python3 scripts/verify-task8.py     # exit 0 = Task 8 accepted

Every other acceptance script in this repo drives the dev server. This one cannot: the offline
shell only exists in a **production build** (`vite.config.ts` emits `dist/sw.js`, and `src/main.ts`
registers it in PROD only, because a worker caching the dev server's unbundled modules would serve
yesterday's code through a hot reload). So the check builds `dist/`, serves it from its own HTTP
server, and drives Chrome against that.

Three things about the harness are deliberate, and each one exists to stop the check being
vacuously green:

* **The static server sends `Cache-Control: no-cache`.** Without it a reload with the server stopped
  (or the network emulated away) could be satisfied by Chrome's own HTTP cache and the check would
  pass without the service worker doing anything at all.
* **A fresh Chrome profile per run** (`tempfile.mkdtemp`, removed afterwards). Task 7 restores the
  previous session and Task 4 stores file handles; a reused profile hands the checks a state their
  assertions do not describe — the lesson `verify-task4-pickers.py` learned the hard way.
* **CDP `Network.responseReceived`'s `fromServiceWorker` flag**, not a proxy. "It worked offline" is
  not evidence that the *worker* did it, so every response of the offline loads is read back from
  the protocol and must say it came from the worker.

What the plan's Task 8 asks for, and where it is checked here:
  step 1  PWA manifest + a service worker caching the static assets             §1, §2, §3
  step 2  optionally bundle a single portable HTML file — measured, not assumed  §7 (and
          `docs/offline-pwa.md` records why it is not shipped)
  step 3  verify the offline load path                                           §4, §5, §6
  verification  "load app once, disable network, reload; confirm editor loads
          and functions offline"                                                 §4 (network emulated)
          and §5 (nothing listening at all)
  carried from Task 7: the session restore must work with no network             §4, §5
  the ledger's own question: what "offline" means for a language never opened     §3, §6
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

from playwright.sync_api import sync_playwright

ROOT = "/home/lowcheemeng/dev/web-text-editor"
DIST = f"{ROOT}/dist"
PORT = 4199
URL = f"http://127.0.0.1:{PORT}/"
SHOTS = "/home/lowcheemeng/.hermes/cache/screenshots"
SHOT_OFFLINE = f"{SHOTS}/task8-offline.png"
SHOT_NOTICE = f"{SHOTS}/task8-language-notice.png"

results: list[tuple[str, bool, str]] = []
console_errors: list[str] = []
page_errors: list[str] = []
requests: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))
    return bool(ok)


# ── the static server ────────────────────────────────────────────────────────────────────────
# A hand-rolled one rather than `vite preview`, for three reasons: the request log is itself
# evidence ("no request reached the server during the offline load"), `no-cache` keeps the browser's
# HTTP cache from standing in for the worker, and stopping it mid-run is how §5 removes the network
# for real instead of asking a browser to pretend.

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
        super().__init__(*args, directory=DIST, **kwargs)

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


def stop_server(server: http.server.ThreadingHTTPServer) -> None:
    server.shutdown()
    server.server_close()


# ── page-side helpers ────────────────────────────────────────────────────────────────────────

SEED = """async ([name, data]) => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(name, { create: true });
    const stream = await handle.createWritable();
    await stream.write(new Uint8Array(data));
    await stream.close();
}"""

# Raw source, not a function expression: `add_init_script` evaluates its argument as a page script,
# so an arrow-function string would be a no-op statement — measured, after a run in which the real
# OS chooser opened invisibly and every assertion downstream failed for the wrong reason.
# A mutable name lets one stub serve every phase: File ▸ Open is the real path, only the dialog is
# replaced. `__stubPickers` is set so the check can assert the harness itself is in place before it
# blames the app for anything.
STUB_PICKERS = """window.__stubPickers = true;
window.__nextOpen = window.__nextOpen || null;
window.showOpenFilePicker = async () => {
    const root = await navigator.storage.getDirectory();
    return [await root.getFileHandle(window.__nextOpen)];
};
window.showSaveFilePicker = async (options) => {
    const root = await navigator.storage.getDirectory();
    return await root.getFileHandle(options.suggestedName || window.__nextOpen);
};
"""

READ_OPFS = """async (name) => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(name);
    return await (await handle.getFile()).text();
}"""

CACHES = """async () => {
    const found = [];
    for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        found.push({
            name,
            entries: (await cache.keys()).map((request) => new URL(request.url).pathname),
        });
    }
    return found;
}"""

TOKENS = """() => [...document.querySelectorAll('.cm-content .cm-line span')].map((span) => {
    const style = getComputedStyle(span);
    return { text: span.textContent, color: style.color, weight: style.fontWeight };
})"""

NOTICE = """() => {
    const notice = document.querySelector("[data-notice='language']");
    return notice ? { title: notice.querySelector('.npp-notice-title').textContent,
                      body: notice.querySelector('.npp-notice-body').textContent } : null;
}"""

BACKUPS = """async () => {
    const root = await navigator.storage.getDirectory();
    try {
        const dir = await root.getDirectoryHandle("backup");
        const names = [];
        for await (const [name] of dir.entries()) names.push(name);
        return names;
    } catch {
        return [];  // N++'s backup/ exists only while something unsaved needs it
    }
}"""


def status_items(page) -> list[str]:
    return page.evaluate("() => [...document.querySelectorAll('.npp-status-item')].map((n) => n.textContent)")


def tab_title(page) -> str:
    """The active tab's own title: N++'s modified marker, as the UI renders it."""
    return page.locator(".npp-tab.is-active").first.get_attribute("title") or ""


def focus_editor(page) -> None:
    """Click into the editor before pressing a key.

    The app's bindings live in CodeMirror's own keymap, so the editor must hold the focus — and
    this is a production build, where the dev-only `window.__workspace` handle does not exist. So
    the check does what a user does: click into the text, then type.
    """
    page.locator(".cm-content").first.click()
    page.wait_for_timeout(120)


def open_fixture(page, name: str) -> None:
    """File ▸ Open on a seeded OPFS file — the real path, with only the OS dialog stubbed."""
    page.evaluate("(name) => { window.__nextOpen = name; }", name)
    focus_editor(page)
    page.keyboard.press("Alt+o")
    page.wait_for_timeout(600)


def wait_for_token(page, text: str, colour: str, timeout_ms: int = 6000) -> bool:
    """Wait for a rendered token of that colour — the language chunk may still be arriving."""
    deadline = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < deadline:
        if any(t["text"] == text and t["color"] == colour for t in page.evaluate(TOKENS)):
            return True
        page.wait_for_timeout(150)
    return False


def wait_for_active(page, needle: str, timeout_ms: int = 8000) -> bool:
    """Wait for a document to be the active one.

    The restore is a promise chain (read the record, re-acquire handles, ask N++'s questions, adopt),
    so asserting on "the first `.cm-content`" can otherwise read the welcome buffer that the restore
    has not replaced yet — which is exactly how this check failed intermittently before the wait.
    """
    deadline = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < deadline:
        title = page.locator(".npp-tab.is-active").first.get_attribute("title") or ""
        if needle in title:
            return True
        page.wait_for_timeout(150)
    return False


def wait_for_backup(page, timeout_ms: int = 14000) -> list[str]:
    """Wait for a body to appear in N++'s `backup/` — the snapshot interval is 7000 ms."""
    deadline = time.monotonic() + timeout_ms / 1000
    names: list[str] = []
    while time.monotonic() < deadline:
        names = page.evaluate(BACKUPS)
        if names:
            return names
        page.wait_for_timeout(250)
    return names


def no_dialog(page, why: str) -> None:
    """Nothing in this check expects a modal. One appearing is a finding, and dismissing it by
    hand turns what would otherwise be a 30-second click timeout into a named failure."""
    dialogs = page.locator("dialog[open]")
    if dialogs.count() > 0:
        text = " | ".join(dialogs.all_text_contents())
        check(f"no dialog is waiting for an answer ({why})", False, text[:140])
        page.keyboard.press("Enter")
        page.wait_for_timeout(250)
    else:
        check(f"no dialog is waiting for an answer ({why})", True)


def dump_state(page, label: str) -> None:
    """Print what the app is showing. Instrumentation, not an assertion: when a check fails in a
    sequence this long, the state at that moment is worth more than a re-run."""
    state = page.evaluate(
        """() => ({
            tabs: [...document.querySelectorAll('.npp-tab')].map((t) => [t.dataset.doc, t.getAttribute('title')]),
            active: document.querySelector('.npp-tab.is-active')?.getAttribute('title') ?? null,
            status: [...document.querySelectorAll('.npp-status-item')].map((n) => n.textContent).slice(0, 3),
            dialog: document.querySelector('dialog[open]')?.textContent?.slice(0, 120) ?? null,
            notice: document.querySelector("[data-notice='language']") ? 'language notice' : null,
            tail: document.querySelector('.cm-content')?.textContent?.slice(-48) ?? null,
        })"""
    )
    print(f"      · {label}: {json.dumps(state)}")


def coloured(tokens) -> list[dict]:
    return [t for t in tokens if t["color"] not in ("rgb(0, 0, 0)", "rgba(0, 0, 0, 0)")]


def expected_console_noise(text: str) -> bool:
    """Console errors an offline run *should* produce, and nothing else is allowed through.

    Cutting the network makes the browser log the failures it caused: the language chunk that was
    never cached (§6), the worker's own update check against a server that is no longer running,
    and — in §6 only — the app's own informative `[task 6] … failed to load` line, which is the
    intended report rather than an unhandled error.
    """
    patterns = (
        "Failed to load resource",
        "net::ERR_INTERNET_DISCONNECTED",
        "net::ERR_CONNECTION_REFUSED",
        "net::ERR_NAME_NOT_RESOLVED",
        "failed to load",
    )
    return any(pattern in text for pattern in patterns)


# ── 0. build the artifact this check is about ────────────────────────────────────────────────
print("$ npm run build")
build = subprocess.run(
    ["npm", "run", "build"], cwd=ROOT, capture_output=True, text=True, timeout=600
)
if build.returncode != 0:
    print(build.stdout[-3000:])
    print(build.stderr[-3000:])
    sys.exit("verify-task8: the build failed, so there is no offline shell to check")

shell_line = next(
    (line for line in build.stdout.splitlines() if "[task 8] offline shell" in line), ""
)
print(f"  {shell_line.strip()[:400]}")

worker = open(f"{DIST}/sw.js", encoding="utf-8").read()
version = re.search(r'^const VERSION = "([^"]+)";$', worker, re.M).group(1)  # type: ignore[union-attr]
precache = json.loads(re.search(r"^const PRECACHE = (\[.*\]);$", worker, re.M).group(1))  # type: ignore[union-attr]

server = start_server()
profile = tempfile.mkdtemp(prefix="task8-verify-")

with sync_playwright() as playwright:
    # A persistent context, because Playwright wants the profile directory that way rather than as
    # a `--user-data-dir` argument.
    context = playwright.chromium.launch_persistent_context(
        profile, channel="chrome", headless=True, viewport={"width": 1280, "height": 860}
    )
    page = context.pages[0] if context.pages else context.new_page()
    page.add_init_script(STUB_PICKERS)
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: page_errors.append(str(e)))
    page.on("request", lambda r: requests.append(r.url))

    # The protocol's own answer to "who served this?", which is what makes the offline claims
    # falsifiable rather than plausible.
    cdp = context.new_cdp_session(page)
    cdp.send("Page.enable")
    cdp.send("Network.enable")
    served: list[tuple[str, bool]] = []
    cdp.on(
        "Network.responseReceived",
        lambda event: served.append(
            (event["response"]["url"], event["response"].get("fromServiceWorker", False))
        ),
    )

    page.goto(URL, wait_until="load")
    page.wait_for_selector(".npp-app", timeout=20000)
    check("the built app is served and mounts", page.locator(".cm-editor").count() == 1)
    # The harness's own precondition, named: with the stub missing, the real chooser opens with
    # nobody to answer it and every later failure reads as the app's fault.
    check(
        "the OS dialog is stubbed (the app's own File ▸ Open still runs)",
        page.evaluate("() => window.__stubPickers === true"),
    )

    # ── 1. the manifest: as we shipped it, and as Chrome reads it ────────────────────────────
    # Two different claims, deliberately checked two different ways. The *artifact* is asserted
    # against the file we wrote (exact spelling, and the icons' real pixel sizes); Chrome's *parse*
    # is asserted against what the browser hands back, in its own vocabulary — `kStandalone`,
    # `rgba(240,240,240,1)` — which is the point: it proves Chrome understood the manifest rather
    # than that we wrote something that looks right to us.
    manifest = json.loads(open(f"{DIST}/manifest.webmanifest", encoding="utf-8").read())
    check(
        "the document links the manifest",
        page.evaluate("() => !!document.querySelector('link[rel=manifest]')"),
    )
    check(
        "the manifest is served as application/manifest+json",
        any("GET /manifest.webmanifest" in line for line in LOG),
        MIMES[".webmanifest"],
    )

    manifest_cdp = cdp.send("Page.getAppManifest")
    check(
        "Chrome fetches the manifest with no errors",
        manifest_cdp.get("errors") == [],
        json.dumps(manifest_cdp.get("errors")),
    )
    parsed = manifest_cdp.get("manifest") or {}
    check(
        "Chrome resolves it to an absolute start URL and a standalone window",
        parsed.get("name") == "Notepad++ Web"
        and parsed.get("startUrl") == URL
        and parsed.get("scope") == URL
        and "Standalone" in str(parsed.get("display")),
        json.dumps({k: parsed.get(k) for k in ("name", "startUrl", "scope", "display", "id")}),
    )
    check(
        "and to N++'s own chrome grey as the window colours",
        parsed.get("themeColor") == "rgba(240,240,240,1)"
        and parsed.get("backgroundColor") == "rgba(240,240,240,1)",
        f"{parsed.get('themeColor')} / {parsed.get('backgroundColor')}",
    )
    chrome_icons = {icon.get("sizes") for icon in parsed.get("icons") or []}
    check(
        "Chrome takes up the 192 and 512 icons it needs to install the app",
        {"192x192", "512x512"} <= chrome_icons
        and all(str(icon.get("url", "")).startswith(URL) for icon in parsed.get("icons") or []),
        f"sizes={sorted(s for s in chrome_icons if s)}",
    )
    installability = cdp.send("Page.getInstallabilityErrors").get("installabilityErrors") or []
    check(
        "Chrome's own installability verdict is empty — the app is installable",
        installability == [],
        json.dumps(installability)[:300],
    )

    # The artifact itself: the fields we promised, and icons that are the size they claim.
    declared = {(icon["src"].lstrip("./"), icon["sizes"], icon["purpose"]) for icon in manifest["icons"]}
    check(
        "the manifest names N++ Web, a standalone window, and the app's own directory",
        manifest["name"] == "Notepad++ Web"
        and manifest["short_name"] == "N++ Web"
        and manifest["display"] == "standalone"
        and manifest["start_url"] == "./"
        and manifest["scope"] == "./"
        and manifest["id"] == "./",
        json.dumps({k: manifest[k] for k in ("name", "short_name", "display", "start_url", "scope", "id")}),
    )
    check(
        "it declares a 192, a 512 and a maskable 512, each from a file that exists",
        declared
        == {
            ("icon-192.png", "192x192", "any"),
            ("icon-512.png", "512x512", "any"),
            ("icon-maskable-512.png", "512x512", "maskable"),
        }
        and all(os.path.exists(f"{DIST}/{src}") for src, _, _ in declared),
        str(sorted(declared)),
    )
    try:
        from PIL import Image  # noqa: PLC0415 — only this one check needs the pixels

        measured = {
            src: Image.open(f"{DIST}/{src}").size for src, _, _ in declared
        }
        check(
            "the icons really are the sizes they declare (read from the PNGs)",
            all(measured[src] == (int(sizes.split("x")[0]), int(sizes.split("x")[1])) for src, sizes, _ in declared),
            json.dumps({src: f"{size[0]}x{size[1]}" for src, size in measured.items()}),
        )
    except ImportError as error:  # Pillow absent: say so rather than skipping quietly
        check("the icons really are the sizes they declare (read from the PNGs)", False, str(error))

    # ── 2. the worker, and the shell it caches ───────────────────────────────────────────────
    page.wait_for_function("navigator.serviceWorker.controller !== null", timeout=20000)
    state = page.evaluate(
        """async () => {
            const registration = await navigator.serviceWorker.ready;
            return { state: registration.active?.state ?? null, scope: registration.scope };
        }"""
    )
    check(
        "the worker reaches 'activated' and controls the page (scope is the app's own directory)",
        state["state"] == "activated" and state["scope"] == URL,
        f"{state}",
    )

    caches = page.evaluate(CACHES)
    shell_cache = next((entry for entry in caches if entry["name"].startswith("npp-web-")), None)
    check("there is exactly one offline cache, and it is this build's", len(caches) == 1 and shell_cache is not None and shell_cache["name"] == f"npp-web-{version}",
          ", ".join(entry["name"] for entry in caches))
    cached_paths = sorted(entry.lstrip("/") for entry in (shell_cache or {}).get("entries", []))
    check(
        "the cache holds exactly the precache list `dist/sw.js` declares",
        cached_paths == sorted(precache),
        f"{len(cached_paths)} cached vs {len(precache)} declared"
        + ("" if cached_paths == sorted(precache) else f" — diff {set(cached_paths) ^ set(precache)}"),
    )
    check(
        "no lazily loaded chunk was precached (a language is cached on first use, never at install)",
        not any(path.startswith("assets/") and path not in precache for path in cached_paths),
    )
    persistence = page.evaluate(
        """async () => ({
            supported: typeof navigator.storage?.persist === 'function',
            persisted: await navigator.storage.persisted(),
            quota: (await navigator.storage.estimate()).quota ?? null,
        })"""
    )
    check(
        "the origin's eviction exemption is reported, not assumed (R6)",
        isinstance(persistence.get("persisted"), bool),
        json.dumps(persistence),
    )

    # A reload while online: everything must now come from the worker, and the server must be left
    # alone. This is the same claim the offline sections make, with the network still available —
    # which is what proves the *worker* is serving, rather than the network simply working.
    served.clear()
    log_before = len(LOG)
    page.reload(wait_until="load")
    page.wait_for_selector(".npp-app", timeout=20000)
    page.wait_for_timeout(500)
    check(
        "an online reload is served entirely by the worker",
        len(served) > 0 and all(flag for _, flag in served),
        f"{sum(1 for _, flag in served if flag)}/{len(served)} responses fromServiceWorker",
    )
    check(
        "and needs nothing from the server",
        len(LOG) == log_before,
        f"server saw {LOG[log_before:]}",
    )

    # ── 3. a language is cached the first time it is used ────────────────────────────────────
    # No `window.__workspace` here: this is the production build, whose only handles are the DOM,
    # the status bar and the browser's own APIs. That is deliberate — the check sees what a user
    # would, and the artifact it tests is the artifact that ships.
    fixtures = {
        "verify-notes.py": "def greet(name):\n    # a comment N++ paints green\n    return name\n",
        "verify-notes.rs": "fn main() {\n    // never opened while online\n    let x = 42;\n}\n",
        "verify-offline.txt": "line one\nline two\n",
    }
    for name, text in fixtures.items():
        page.evaluate(SEED, [name, list(text.encode("utf-8"))])

    rust_chunk = next(
        (f for f in os.listdir(f"{DIST}/assets") if f.startswith("rust-") and f.endswith(".js")), ""
    )
    before = len(cached_paths)
    open_fixture(page, "verify-notes.py")
    check(
        "opening a Python file names it in N++'s status field",
        status_items(page)[0] == "Python file",
        status_items(page)[0],
    )
    page.wait_for_timeout(200)
    check(
        "and highlights it — the grammar was fetched from the network, once",
        wait_for_token(page, "def", "rgb(0, 0, 255)"),
        f"{len(coloured(page.evaluate(TOKENS)))} coloured spans",
    )
    cached_paths = sorted(
        entry.lstrip("/") for entry in page.evaluate(CACHES)[0]["entries"]
    )
    check(
        "the grammar it used is now in the offline cache",
        len(cached_paths) > before,
        f"{before} → {len(cached_paths)} entries: {sorted(set(cached_paths) - set(precache))}",
    )
    check(
        "and a language that was never opened is still absent",
        not any(path.endswith(rust_chunk) for path in cached_paths),
        f"{rust_chunk} not cached yet",
    )

    # The rest of the app's own state comes along for the ride: a dirty document is what Task 7
    # restores, and it is what makes the offline reload below a real restore rather than an empty
    # editor that merely mounted.
    focus_editor(page)
    page.keyboard.press("Control+End")
    page.keyboard.type("\nTYPED_OFFLINE_MARKER\n")
    check(
        "the document is marked modified in the tab, as N++ marks it",
        "modified" in tab_title(page),
        tab_title(page),
    )
    # N++'s own rule, not this check's invention: an unsaved body reaches `backup/` on the snapshot
    # interval (`snapshotBackupTiming`, 7000 ms — `Parameters.h:869`), and the session record that
    # points at it is written the moment the backup is created. Waiting for the *body* instead of
    # sleeping a fixed few seconds is what makes the offline restore below a test of the shipped
    # behaviour — and it names its precondition here rather than failing three checks later with a
    # message about a session that had nothing to restore.
    backups = wait_for_backup(page)
    check(
        "N++'s snapshot interval put the unsaved body in backup/ before the reload",
        any(name.startswith("verify-notes.py@") for name in backups),
        str(backups),
    )
    page.wait_for_timeout(800)  # the record naming that backup is written on its own debounce

    # ── 4. the plan's verification: no network, reload, keep working ─────────────────────────
    context.set_offline(True)
    served.clear()
    log_before = len(LOG)
    page.reload(wait_until="load")
    page.wait_for_selector(".cm-editor", timeout=20000)
    page.wait_for_timeout(600)
    no_dialog(page, "offline reload")
    check("offline: the editor mounts with the network switched off", page.locator(".cm-editor").count() == 1)
    check(
        "offline: every byte came from the worker, and the server was not asked",
        len(served) > 0 and all(flag for _, flag in served) and len(LOG) == log_before,
        f"{len(served)} responses, all from the worker; server saw {LOG[log_before:]}",
    )
    restored_offline = wait_for_active(page, "verify-notes.py")
    restored = page.evaluate("() => document.querySelector('.cm-content').textContent")
    check(
        "offline: Task 7's session restore put the file back, dirty, with its edits",
        restored_offline and "TYPED_OFFLINE_MARKER" in restored,
        repr(restored[-40:]),
    )
    check("offline: the restored document is still marked modified", "modified" in tab_title(page), tab_title(page))
    page.wait_for_timeout(200)
    check(
        "offline: the cached grammar still paints N++'s keyword colour",
        wait_for_token(page, "def", "rgb(0, 0, 255)", timeout_ms=3000),
        f"{len(coloured(page.evaluate(TOKENS)))} coloured spans",
    )
    focus_editor(page)
    page.keyboard.press("Control+End")
    page.keyboard.type("EDITABLE_OFFLINE")
    page.wait_for_timeout(300)
    check(
        "offline: typing still reaches the document",
        "EDITABLE_OFFLINE" in page.evaluate("() => document.querySelector('.cm-content').textContent"),
    )
    page.context.set_offline(False)
    check(
        "the browser reports the connection coming back — the condition the remedy needs",
        page.evaluate("() => navigator.onLine") is True,
    )

    # ── 5. the strongest form: nothing listening at all ──────────────────────────────────────
    # `set_offline` asks the browser to behave as if there were no network; stopping the server
    # *removes* it. With `no-cache` on everything, the browser's own HTTP cache cannot stand in for
    # the worker here — the only thing that can answer is Cache Storage.
    stop_server(server)
    time.sleep(0.3)
    served.clear()
    mounted = True
    try:
        page.reload(wait_until="load", timeout=30000)
        page.wait_for_selector(".cm-editor", timeout=20000)
    except Exception as error:  # noqa: BLE001 — the failure itself is the evidence
        mounted = False
        check("with the server stopped, the app still loads", False, f"{type(error).__name__}: {error}")
    if mounted:
        no_dialog(page, "reload with no server")
        restored_no_server = wait_for_active(page, "verify-notes.py")
        check(
            "with the server stopped, the app still loads",
            page.locator(".cm-editor").count() == 1,
            f"{sum(1 for _, flag in served if flag)}/{len(served)} responses from the worker",
        )
        check(
            "and every response still came from the worker",
            all(flag for _, flag in served),
            ", ".join(url for url, flag in served if not flag)[:120],
        )
        text = page.evaluate("() => document.querySelector('.cm-content').textContent")
        dump_state(page, "with the server stopped, after the reload")
        check(
            "the session restore still worked, with nothing to ask",
            restored_no_server
            and "TYPED_OFFLINE_MARKER" in text
            and "Python file" in " ".join(status_items(page)),
            repr(text[-40:]),
        )
        # File I/O with no server anywhere: open a different file, edit it, save it, and read the
        # result back out of the file system the app actually wrote to.
        open_fixture(page, "verify-offline.txt")
        focus_editor(page)
        page.keyboard.press("Control+End")
        page.keyboard.type("\nSAVED_WITH_NO_SERVER\n")
        page.keyboard.press("Alt+s")
        page.wait_for_timeout(900)
        on_disk = page.evaluate(READ_OPFS, "verify-offline.txt")
        check(
            "offline file I/O works: an edit was saved through to the file",
            "SAVED_WITH_NO_SERVER" in on_disk,
            repr(on_disk[-40:]),
        )
        check(
            "and the saved document is no longer marked modified",
            "modified" not in tab_title(page),
            tab_title(page),
        )
    server = start_server()  # back for §6, which needs a network to observe the retry

    # ── 6. a language that was never opened, offline ─────────────────────────────────────────
    # This is the honest edge of the design (see `src/pwa/service-worker.js`): the shell is
    # precached, a language is cached when first *used*, so this one is genuinely unavailable. What
    # must not happen is silence — the status bar names the language, so the notice has to say why
    # the document is plain text, and offer something that works. The retry that *doesn't* work was
    # measured and removed; the reload is what this section checks.
    context.set_offline(True)
    open_fixture(page, "verify-notes.rs")
    check(
        "offline: an uncached language still opens the document",
        page.evaluate("() => document.querySelector('.cm-content').textContent").startswith("fn main()"),
        status_items(page)[0],
    )
    notice = page.evaluate(NOTICE)
    check(
        "offline: the status bar still names it, as N++ names the language",
        status_items(page)[0] == "Rust file",
        status_items(page)[0],
    )
    check(
        "offline: and the app says the grammar could not be loaded",
        notice is not None and "Rust" in notice["title"],
        json.dumps(notice)[:160],
    )
    check(
        "offline: the notice explains what offline means for a language",
        notice is not None and "plain text" in notice["body"] and "cached" in notice["body"],
        (notice or {}).get("body", "")[:100],
    )
    check(
        "offline: and it offers the remedy that works — a reload, not an in-page retry",
        page.locator("[data-notice-action='language']").count() == 1
        and "reload" in (page.locator("[data-notice-action='language']").text_content() or "").lower(),
        (page.locator("[data-notice-action='language']").text_content() or ""),
    )
    focus_editor(page)
    page.keyboard.press("Control+End")
    page.keyboard.type("STILL_EDITABLE")
    page.wait_for_timeout(200)
    check(
        "offline: the document is still editable while its grammar is missing",
        "STILL_EDITABLE" in page.evaluate("() => document.querySelector('.cm-content').textContent"),
    )
    page.locator("[data-notice='language']").screenshot(path=SHOT_NOTICE)

    # The notice makes a claim — "the text, the editing and the saving are unaffected" — so save it
    # and read the bytes back. That verifies the copy, and it leaves the document clean, which is
    # what the reload below should restore: a *dirty* document whose snapshot interval (7000 ms) has
    # not come round yet would be reported as unrestorable work by design, and this section is about
    # the grammar, not about that.
    focus_editor(page)
    page.keyboard.press("Alt+s")
    page.wait_for_timeout(900)
    saved = page.evaluate(READ_OPFS, "verify-notes.rs")
    dump_state(page, "after saving with the grammar missing")
    check(
        "offline: and it saves — the notice's own claim about text, editing and saving",
        "STILL_EDITABLE" in saved and "modified" not in tab_title(page),
        f"{saved[-28:]!r}, tab {tab_title(page)!r}",
    )

    context.set_offline(False)
    check(
        "the connection is back, which is what the notice's remedy asks for",
        page.evaluate("() => navigator.onLine") is True,
    )
    time_origin = page.evaluate("() => performance.timeOrigin")
    page.locator("[data-notice-action='language']").click()
    try:
        page.wait_for_function("() => !document.querySelector(\"[data-notice='language']\")", timeout=15000)
    except Exception as error:  # noqa: BLE001 — report the state rather than crashing
        print(f"      (the notice was still there: {type(error).__name__})")
    page.wait_for_timeout(800)
    no_dialog(page, "after the notice's reload")
    wait_for_active(page, "verify-notes.rs")
    check(
        "the notice's button really reloaded the page (a new document, not a re-dispatch)",
        page.evaluate("() => performance.timeOrigin") != time_origin,
        f"timeOrigin {time_origin} → {page.evaluate('() => performance.timeOrigin')}",
    )
    check(
        "after the reload the notice is gone and the document is highlighted",
        page.evaluate(NOTICE) is None and wait_for_token(page, "fn", "rgb(0, 0, 255)"),
        f"{len(coloured(page.evaluate(TOKENS)))} coloured spans",
    )
    # The promise the design makes, in the form a user lives it: a language that has now been used
    # once is there with no network at all. It is deliberately *not* asserted as "the chunk is in
    # the worker's cache" — measured, a language recovered by a reload after a failed first attempt
    # can be served from the browser's own caches instead, and this app controls only one of those.
    # What must hold is the outcome; `docs/offline-pwa.md` states the limit.
    context.set_offline(True)
    served.clear()
    log_before = len(LOG)
    page.reload(wait_until="load")
    page.wait_for_selector(".cm-editor", timeout=20000)
    page.wait_for_timeout(600)
    no_dialog(page, "offline again, after the language was recovered")
    check(
        "offline again: the language used a moment ago is still highlighted, with nothing served",
        wait_for_token(page, "fn", "rgb(0, 0, 255)", timeout_ms=4000)
        and len(LOG) == log_before
        and all(flag for _, flag in served),
        f"{len(coloured(page.evaluate(TOKENS)))} coloured spans, server saw {LOG[log_before:]}, "
        f"{sum(1 for _, flag in served if flag)}/{len(served)} from the worker",
    )
    context.set_offline(False)

    # ── 7. the promises that survive every task ──────────────────────────────────────────────
    offsite = [
        url
        for url in requests
        if not url.startswith(("http://127.0.0.1", "http://localhost", "ws://127.0.0.1", "data:"))
    ]
    check("no request left the machine (D1 backend-free)", len(offsite) == 0, ", ".join(offsite[:3]))
    check(
        "the app is installable without a network of its own: everything it asked for was its own origin",
        all(re.match(r"http://127\.0\.0\.1:\d+/(.*)$", url) for url in requests),
        f"{len(requests)} requests",
    )

    page.screenshot(path=SHOT_OFFLINE)
    context.close()

check("no uncaught page errors", len(page_errors) == 0, "; ".join(page_errors[:3]))
unexpected = [text for text in console_errors if not expected_console_noise(text)]
check(
    "no console errors beyond the ones cutting the network causes",
    len(unexpected) == 0,
    "; ".join(unexpected[:3]) or f"{len(console_errors)} expected network failures",
)

shutil.rmtree(profile, ignore_errors=True)

# The pixels, not only the DOM: the notice is the entire user-visible half of §6, and "a node with
# that text existed" is a weaker claim than "a person could read it".
if os.path.exists(SHOT_NOTICE):
    try:
        text = subprocess.run(
            ["tesseract", SHOT_NOTICE, "-", "--psm", "6"],
            capture_output=True,
            text=True,
            timeout=60,
            check=True,
        ).stdout
        check("OCR of the notice reads the language it names", "Rust" in text, " ".join(text.split())[:80])
    except Exception as error:  # noqa: BLE001 — tesseract missing or unhappy: say so, do not pass
        check("OCR of the notice reads the language it names", False, str(error))

failed = [name for name, ok, _ in results if not ok]
print(f"\n{'=' * 60}")
print(f"VERIFY-TASK8: {'PASS' if not failed else 'FAIL'}  ({len(results) - len(failed)}/{len(results)} checks)")
if failed:
    print("failed: " + "; ".join(failed))
print(f"shell npp-web-{version}: {len(precache)} precached at install, {len(cached_paths)} entries after use")
print(f"screenshots: {SHOT_OFFLINE}, {SHOT_NOTICE}")
sys.exit(1 if failed else 0)
