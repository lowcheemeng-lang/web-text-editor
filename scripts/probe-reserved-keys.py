#!/usr/bin/env python3
"""Which of Notepad++'s search keys can a web page actually claim? (Task 5, decision S6)

    python3 scripts/probe-reserved-keys.py                 # every combination
    python3 scripts/probe-reserved-keys.py ctrl+f alt+f    # a subset, e.g. while choosing a substitute

Task 5 wants N++'s Find / Replace / Go to / Find Next / Bookmark keys (defaults in
Notepad++'s `Parameters.cpp` → `winKeyDefs[]`). Chrome owns some Ctrl+ combinations outright —
the project already maps Ctrl+N/O/S/W onto Alt (`WEB_PORT_KEYS`, `DEVIATIONS_FROM_NPP`) — and the
search family is the plausible next victim: Ctrl+F (find bar), Ctrl+H (history), Ctrl+G / F3
(find next). The Alt- combinations are measured too, because a substitute binding is only usable
if Chrome is not holding *that* key either (Alt+F opens Chrome's own menu).

Method: a **headed** Chrome inside Xvfb, keys sent by `xdotool` — real X input, so Chrome's own
accelerator handling runs exactly as it does for a user. (Playwright's keyboard cannot answer
this: CDP-injected events go to the renderer and skip the browser's accelerators, which is the
path under test.)

Per combination it reports:

  page_saw_key   did the page's keydown handler run at all?
  find_bar       was Chrome's find-in-page bar open afterwards? Detected by OCR of its own
                 match counter ("0/0"), not by eye — the bar is browser UI and invisible to
                 the DOM. Corroboration only: the crop is small and the OCR is not reliable
                 enough to build a verdict on, which is why the verdict below does not use it.
  new_tab        did Chrome open one (Ctrl+H does, whatever the page does)?
  typed_landed   with the page calling preventDefault(), did plain typing still reach the page?

Three traps this script had to solve, all found by its own earlier runs:

1. **Cancelling every keydown cancels the probe.** Cancelling the *typed characters* too made
   "did typing land" false for every key, including plainly free ones. Only accelerator-shaped
   keydowns are cancelled (`isAccelerator`).
2. **A stolen focus can outlive the measurement.** After Ctrl+F opened the find bar, the next
   combination's typing went into that leftover bar, which would have read as "Ctrl+G is taken
   by Chrome" when it is not. Every measurement therefore runs in a **fresh tab** and starts with
   `ensure_page_focus()`: Escape, re-focus the window (no window manager runs under Xvfb, so
   Chromium will not move DOM focus inside a window it believes is blurred), click the page, type
   a guard word and require it to land. A measurement whose precondition cannot be established is
   reported as such, never as a result.
3. **"Typing did not arrive" is a proxy, and a proxy can lie.** The find bar's own counter is
   read directly instead; `typed_landed` is kept as corroboration.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import time
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

# N++ default (Parameters.cpp winKeyDefs[]) -> what Task 5 wants from it.
DEFAULT_COMBOS: list[tuple[str, str, str]] = [
    ("ctrl+f", "Find…", "Ctrl+F"),
    ("ctrl+h", "Replace…", "Ctrl+H"),
    ("ctrl+g", "Go to…", "Ctrl+G"),
    ("F3", "Find Next", "F3"),
    ("shift+F3", "Find Previous", "Shift+F3"),
    ("ctrl+F2", "Toggle Bookmark", "Ctrl+F2"),
    ("F2", "Next Bookmark", "F2"),
    ("shift+F2", "Previous Bookmark", "Shift+F2"),
    ("ctrl+m", "Mark…", "Ctrl+M"),
    ("alt+f", "Find… substitute?", "Alt+F"),
    ("alt+h", "Replace… substitute?", "Alt+H"),
    ("alt+shift+f", "Find… substitute?", "Alt+Shift+F"),
]

DISPLAY = ":98"
CDP_PORT = 9224
SCREEN_W, SCREEN_H = 1400, 900
SCRATCH = Path("/home/lowcheemeng/.hermes/cache/scratch/probe-keys")
SHOT_DIR = Path("/home/lowcheemeng/.hermes/cache/scratch/screenshots")

PROBE_HTML = """<!doctype html>
<meta charset="utf-8"><title>key probe</title>
<style>body{font:13px system-ui;margin:8px}textarea{width:420px;height:120px}</style>
<textarea id="pad"></textarea>
<div id="log"></div>
<script>
  window.__log = [];
  const isAccelerator = (e) => e.ctrlKey || e.altKey || e.metaKey || /^F\\d+$/.test(e.key) || e.key === "Escape";
  document.addEventListener("keydown", (e) => {
    const parts = [];
    if (e.ctrlKey) parts.push("ctrl");
    if (e.altKey) parts.push("alt");
    if (e.shiftKey) parts.push("shift");
    parts.push(e.key);
    window.__log.push(parts.join("+"));
    if (window.__prevent && isAccelerator(e)) e.preventDefault();
    document.getElementById("log").textContent = window.__log.join(" ");
  });
  window.__reset = (prevent) => {
    window.__prevent = prevent; window.__log = [];
    const pad = document.getElementById("pad"); pad.value = "";
    document.getElementById("log").textContent = "";
    pad.focus();
  };
  window.__clear = () => { document.getElementById("pad").value = ""; };
  window.__pad = () => document.getElementById("pad").value;
  window.__state = () => ({ log: window.__log.slice(), pad: window.__pad() });
</script>
"""


def sh(cmd: list[str], timeout: int = 30) -> str:
    r = subprocess.run(cmd, capture_output=True, text=True, env=os.environ, timeout=timeout)
    return (r.stdout + r.stderr).strip()


def x(cmd: list[str], timeout: int = 30) -> str:
    return sh(["xdotool", *cmd], timeout)


def window_titled(pattern: str) -> str | None:
    for wid in x(["search", "--onlyvisible", "--name", "."]).splitlines():
        if pattern.lower() in x(["getwindowname", wid.strip()]).lower():
            return wid.strip()
    return None


def focus_browser() -> None:
    """Chrome must hold X input focus or the renderer refuses to move DOM focus (no WM here)."""
    deadline = time.time() + 20
    while time.time() < deadline:
        wid = window_titled("key probe")
        if wid:
            x(["windowfocus", "--sync", wid])
            time.sleep(0.2)
            return
        time.sleep(0.4)


def screenshot(name: str) -> Path:
    path = SHOT_DIR / name
    SHOT_DIR.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "x11grab",
         "-video_size", f"{SCREEN_W}x{SCREEN_H}", "-i", f"{DISPLAY}.0",
         "-frames:v", "1", str(path)],
        capture_output=True, env=os.environ, timeout=60,
    )
    return path


def find_bar_open(shot: Path) -> tuple[bool, str]:
    """Chrome's find bar carries a match counter; OCR of that area is the direct signal.

    The crop has to be this tight: a wider one catches the URL bar and Chrome's update
    bubble, and "Relaunch to update" is enough to make a digit-slash-digit match look real.
    """
    crop = SHOT_DIR / "_findbar-crop.png"
    image = Image.open(shot)
    width, _height = image.size
    image.crop((int(width * 0.48), 82, int(width * 0.80), 148)).save(crop)
    text = " ".join(sh(["tesseract", str(crop), "-"], timeout=60).split())
    return bool(re.search(r"\d\s*/\s*\d", text)), text


def ocr(path: Path) -> str:
    return " ".join(sh(["tesseract", str(path), "-"], timeout=60).split())


def ensure_page_focus(page, attempts: int = 6) -> bool:
    """Prove the page can receive typing before measuring anything (header, trap 2)."""
    for _ in range(attempts):
        x(["key", "Escape"])
        time.sleep(0.2)
        focus_browser()
        page.click("#pad")
        page.wait_for_timeout(120)
        page.evaluate("() => window.__clear()")
        x(["type", "--delay", "30", "guard"])
        page.wait_for_timeout(300)
        if page.evaluate("() => window.__pad()") == "guard":
            return True
    return False


def measure(context, url: str, combo: str, prevent: bool, tag: str) -> dict:
    """One measurement, in a tab of its own so no browser UI can leak in from the last one."""
    page = context.new_page()
    page.goto(url, wait_until="load")
    page.wait_for_selector("#pad", timeout=15000)
    try:
        focus_browser()
        if not ensure_page_focus(page):
            return {"guard": False}
        page.evaluate("(prevent) => window.__reset(prevent)", prevent)
        page.click("#pad")
        page.wait_for_timeout(120)
        _before, bar_before_text = find_bar_open(screenshot(f"probe-keys-{tag}-before.png"))
        tabs_before = len(context.pages)
        x(["key", combo])
        page.wait_for_timeout(450)
        shot = screenshot(f"probe-keys-{tag}.png")
        bar_after, bar_text = find_bar_open(shot)
        page.evaluate("() => window.__clear()")
        x(["type", "--delay", "40", "zz"])
        page.wait_for_timeout(400)
        state = page.evaluate("() => window.__state()")
        return {
            "guard": True,
            "bar_before": bar_before_text,
            "page_saw_key": any(
                part.split("+")[-1].lower() in ("f", "h", "g", "f2", "f3", "m", "z")
                for part in state["log"]
            ),
            "find_bar": bar_after,
            "bar_text": bar_text,
            "new_tab": len(context.pages) > tabs_before,
            "typed_landed": "zz" in state["pad"],
            "log": state["log"],
            "ocr": ocr(shot)[:110],
            "shot": shot.name,
        }
    finally:
        page.close()


def main() -> int:
    wanted = [arg.lower() for arg in sys.argv[1:]]
    combos = [c for c in DEFAULT_COMBOS if not wanted or c[0].lower() in wanted]
    if not combos:
        print(f"no combination matched {wanted!r}; known: {[c[0] for c in DEFAULT_COMBOS]}")
        return 2

    SCRATCH.mkdir(parents=True, exist_ok=True)
    probe = SCRATCH / "probe.html"
    probe.write_text(PROBE_HTML)
    url = f"file://{probe}"

    xvfb = subprocess.Popen(
        ["Xvfb", DISPLAY, "-screen", "0", f"{SCREEN_W}x{SCREEN_H}x24", "-nolisten", "tcp"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    os.environ["DISPLAY"] = DISPLAY
    env = dict(os.environ)
    chrome = None
    rows: list[dict] = []
    try:
        time.sleep(1.5)
        chrome = subprocess.Popen(
            [
                "dbus-run-session", "--",
                "google-chrome",
                f"--remote-debugging-port={CDP_PORT}",
                f"--user-data-dir={SCRATCH / 'chrome-profile'}",
                "--ozone-platform=x11",
                f"--window-size={SCREEN_W - 80},{SCREEN_H - 120}",
                "--window-position=0,0",
                "--no-first-run", "--no-default-browser-check",
                "--disable-gpu", "--disable-dev-shm-usage",
                url,
            ],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env,
        )

        with sync_playwright() as p:
            browser = None
            deadline = time.time() + 30
            while time.time() < deadline and browser is None:
                try:
                    browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{CDP_PORT}")
                except Exception:
                    time.sleep(1)
            if browser is None:
                print("could not attach to the headed Chrome over CDP")
                return 2
            context = browser.contexts[0]
            context.pages[0].wait_for_selector("#pad", timeout=20000)

            for combo, label, npp in combos:
                tag = f"{combo.replace('+', '_')}-prevent"
                prevented = measure(context, url, combo, True, tag)
                raw = measure(context, url, combo, False, f"{combo.replace('+', '_')}-raw")
                rows.append({"npp": npp, "label": label, "prevented": prevented, "raw": raw})
                if not prevented["guard"]:
                    print(f"\n=== {npp} ({label}) === precondition could not be established")
                    continue
                pd = prevented
                print(f"\n=== {npp} ({label}) ===")
                print(f"  page saw the keydown        : {pd['page_saw_key']}   log={pd['log']}")
                print(f"  find bar open (before/after): {bool(pd['bar_before'])} / {pd['find_bar']}"
                      f"   crop text: {pd['bar_text'][:60]!r}")
                print(f"  new tab opened              : {pd['new_tab']}")
                print(f"  preventDefault -> typing    : {pd['typed_landed']}")
                print(f"  no preventDefault -> bar     : {raw.get('find_bar')}, "
                      f"typing {raw.get('typed_landed')}, new tab {raw.get('new_tab')}")
                print(f"  screen ({pd['shot']}): {pd['ocr'][:70]!r}")

            browser.close()
    finally:
        if chrome:
            chrome.terminate()
        xvfb.terminate()

    print("\n" + "=" * 100)
    print(f"{'N++ key':<14} {'page sees':<10} {'find bar':<9} {'new tab':<8} {'typing':<7} verdict")
    for row in rows:
        npp, label = row["npp"], row["label"]
        pd = row["prevented"]
        if not pd["guard"]:
            print(f"{npp:<14} {'?':<10} {'?':<9} {'?':<8} {'?':<7} precondition failed — not measured")
            continue
        # The verdict rests on page-side facts and the tab count. The find-bar OCR is
        # reported alongside but not trusted for the decision: it is corroboration only.
        bindable = pd["page_saw_key"] and pd["typed_landed"] and not pd["new_tab"]
        verdict = "bind this key" if bindable else "browser-owned → need another key"
        print(f"{npp:<14} {str(pd['page_saw_key']):<10} {str(pd['find_bar']):<9} "
              f"{str(pd['new_tab']):<8} {str(pd['typed_landed']):<7} {verdict}  ({label})")
    print("=" * 100)
    print("bind this key     : the page got the keydown and preventDefault suppressed Chrome's own")
    print("                    action, so the N++ binding can be kept.")
    print("browser-owned     : Chrome acted anyway (find bar / history tab); the N++ key is unusable")
    print("                    and an alternative has to be measured the same way.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
