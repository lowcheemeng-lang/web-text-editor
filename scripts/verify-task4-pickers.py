#!/usr/bin/env python3
"""Task 4, part 2 of the acceptance evidence — the *real* OS file chooser.

    npm run dev                              # in another shell
    python3 scripts/verify-task4.py          # part 1: stubbed pickers, byte-level
    python3 scripts/verify-task4-pickers.py  # part 2: the real dialog end to end

Why a second script exists
--------------------------
`verify-task4.py` stubs `showOpenFilePicker` / `showSaveFilePicker` in the page so
the byte-level paths (BOM, encoding, CRLF, `createWritable`) run against OPFS
handles. That cannot prove the picker itself: that the OS dialog opens, that the
file it returns is a real file on real disk, and that a dismissal is a cancel.

The manual checklist in `PROGRESS.md` was written because Playwright and CDP
cannot reach those dialogs — `Page.setInterceptFileChooserDialog` does emit
`Page.fileChooserOpened` for a File System Access picker, but without a
`backendNodeId`, and `DOM.setFileInputFiles` can only answer a chooser that has an
`<input type=file>` behind it, so there is no way to hand the promise a file. That
is not true for a headed Chrome on an X display: the GTK chooser is an ordinary X
window, so this script runs Chrome inside Xvfb, drives the dialog with xdotool
(Control+L, the path, Return) and screenshots it. Nothing about the dialog is
faked — only the physical clicking, which is what the manual checklist asks a human
for. That checklist stays in `PROGRESS.md` as the final word on the real desktop;
this script is the re-runnable half.

Real files are used, and md5sum compares the bytes on disk before and after.

Environment traps solved here, all three worth knowing
-----------------------------------------------------
1. Chrome hands the picker to `xdg-desktop-portal` whenever a reachable session
   bus has one running. That dialog belongs to the *portal* process and renders on
   the portal's own display — the user's real desktop — while the page just waits
   (observed: promise pending, no window anywhere). Chrome is therefore launched
   inside `dbus-run-session`: a private bus with no portal on it, which puts Chrome
   back on its own GTK chooser, on our display.
2. No window manager runs under Xvfb, so there is no active window and X focus is
   `PointerRoot`: keys follow the pointer. `type_path()` moves the pointer inside
   the dialog before sending anything.
3. The same missing WM means the *browser* window is never "focused" either, and
   Chromium will not move DOM focus inside a window it believes is blurred — so
   clicks land but typed characters go nowhere. `focus_main()` sets X input focus on
   the Chrome window directly (`xdotool windowfocus`; `windowactivate` needs a WM).
4. **Chrome asks permission the first time a site writes to a given file**
   ("Save changes to <name>?" — Cancel, and a filled blue *Save changes*). That
   prompt is browser-side and blocks input to the page until it is answered, so a
   save followed by more clicking silently deadlocks. Worse, Return and Escape both
   answer *Cancel* (measured — the app then reports "Failed to execute
   'createWritable'… The request is not allowed"), and the affirmative button's
   white-on-blue label does not survive OCR, so `answer_write_prompt()` finds the
   filled blue button by colour instead of by text and clicks it.

   This is why every save here checks the file's **mtime as well as its bytes**: a
   cancelled write leaves the bytes untouched, so a byte comparison alone passes
   vacuously — which it did, twice, before this prompt was understood.
5. **There is a second prompt, and it belongs to the origin rather than to a file.** On the
   first write a browser profile ever makes, Chrome asks "<origin> wants to view and edit
   files from the last time you visited this site." — Allow this time / **Allow on every
   visit** / Don't allow. It blocks the write just as completely, and because it says nothing
   about "Save changes to", a check that only knew trap 4 read it as "no prompt appeared"
   while the save silently never reached disk (measured 2026-10-10: 36/42, every write check
   failing). `grant_write()` now answers both kinds and stops when the file's inode moves.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
URL = "http://127.0.0.1:5173/"
SHOT_DIR = ROOT / ".hermes" / "cache" / "screenshots"
SCRATCH = Path("/home/lowcheemeng/.hermes/cache/scratch/task4-pickers")

DISPLAY = ":99"
SCREEN_W, SCREEN_H = 1600, 1000
SCREEN = f"{SCREEN_W}x{SCREEN_H}x24"
CDP_PORT = 9223

CRLF_BOM = Path("/tmp/t4-crlf-bom.txt")
WIN1252 = Path("/tmp/t4-win1252.txt")
EDIT_COPY = Path("/tmp/t4-edit-copy.txt")

UTF8_BOM = b"\xef\xbb\xbf"
CRLF_BOM_BYTES = UTF8_BOM + b"line one\r\nline two\r\n"
WIN1252_BYTES = b"caf\xe9 \x97 na\xef\xbe\r\n"

results: list[tuple[str, bool, str]] = []
console_errors: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))


def md5(path: Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()


class DisplayStalled(RuntimeError):
    """The X server stopped answering a call that should take milliseconds.

    Measured on this machine: `xdotool mousemove --sync` hung past 30 s with the host idle (0.8
    load, 12 cores) and no strays from earlier runs (checked), and `ffmpeg -f x11grab` hit a
    60-second timeout in the same session. The `--sync` flags are gone from the pointer and focus
    calls for that reason: they block until the server confirms, which is exactly what a stalled
    server never does, while the `time.sleep` after each call already gives the asynchronous request
    time to land. Whatever wedges Xvfb, the cost used to be a Python traceback thirty checks early —
    a crash hides every check behind it, which is the one failure mode this script must not have. It
    is a named failure now, and the run finishes and reports.
    """


def sh(cmd: list[str], timeout: int = 30) -> str:
    # DISPLAY is set to the virtual display in main(); everything below (xdotool,
    # ffmpeg, tesseract) must talk to that one, not to the desktop we inherited.
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, env=os.environ, timeout=timeout)
    except subprocess.TimeoutExpired as expired:
        raise DisplayStalled(
            f"`{' '.join(cmd[:3])} …` did not answer within {timeout} s — the virtual display "
            "stopped responding"
        ) from expired
    return (r.stdout + r.stderr).strip()


# ── the virtual display and the window it hosts ──────────────────────────────
def x(cmd: list[str], timeout: int = 30) -> str:
    return sh(["xdotool", *cmd], timeout)


def windows() -> dict[str, str]:
    """Visible window id -> title, on our Xvfb display."""
    out = {}
    for wid in x(["search", "--onlyvisible", "--name", "."]).splitlines():
        out[wid.strip()] = x(["getwindowname", wid])
    return out


def window_titled(pattern: str) -> tuple[str, str] | None:
    for wid, title in windows().items():
        if pattern.lower() in title.lower():
            return wid, title
    return None


def wait_for_window(pattern: str, timeout: float = 20.0) -> tuple[str, str] | None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        found = window_titled(pattern)
        if found:
            return found
        time.sleep(0.4)
    return None


def focus_main() -> str | None:
    """Give the Chrome window X input focus so the renderer will accept typing."""
    found = window_titled("Notepad++ Web")
    if found:
        x(["windowfocus", "--sync", found[0]])
        time.sleep(0.2)
    return found[0] if found else None


def screenshot(name: str) -> Path:
    path = SHOT_DIR / name
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "x11grab",
         "-video_size", f"{SCREEN_W}x{SCREEN_H}", "-i", f"{DISPLAY}.0",
         "-frames:v", "1", str(path)],
        capture_output=True, env=os.environ, timeout=60,
    )
    return path


def ocr(path: Path) -> str:
    return sh(["tesseract", str(path), "-"], timeout=60)


def alnum(text: str) -> str:
    """OCR-safe comparison: keep letters and digits only, lowercased."""
    return "".join(ch for ch in text.lower() if ch.isalnum())


def snapshot(path: Path) -> tuple[int, int, int]:
    """The three things a real write moves: mtime, ctime and the inode.

    Chrome's File System Access write for a local file swaps in a new file rather
    than editing in place, so all three move — and a *cancelled* write moves none
    of them, which is exactly the distinction a byte comparison cannot make.
    """
    st = path.stat()
    return (st.st_mtime_ns, st.st_ctime_ns, st.st_ino)


def wait_for_write(path: Path, before: tuple[int, int, int], timeout: float = 8.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if snapshot(path) != before:
            return True
        time.sleep(0.25)
    return False


def blue_button(shot_path: Path) -> tuple[int, int] | None:
    """Centre of Chrome's affirmative button in the write-permission prompt.

    White text on a filled blue pill is exactly what tesseract cannot read, so the
    button is found by colour — but a whole-screen "largest blue blob" search is
    easily fooled by the browser's own chrome, so the search is anchored on the
    prompt's *Cancel* button (which does OCR reliably) and looks only on its row,
    to its right. The blob search remains as a fallback.
    """
    image = Image.open(shot_path).convert("RGB")
    width, height = image.size
    pixels = image.load()

    def is_blue(x: int, y: int) -> bool:
        r, g, b = pixels[x, y]
        return b > 150 and b > r + 45 and b > g + 25

    def blob_centre(points: set[tuple[int, int]]) -> tuple[int, int] | None:
        cells: dict[tuple[int, int], int] = {}
        for x, y in points:
            cell = (x // 12, y // 12)
            cells[cell] = cells.get(cell, 0) + 1
        if not cells:
            return None
        seen: set[tuple[int, int]] = set()
        best: list[tuple[int, int]] = []
        for start in cells:
            if start in seen:
                continue
            stack, blob = [start], []
            seen.add(start)
            while stack:
                cx, cy = stack.pop()
                blob.append((cx, cy))
                for neighbour in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if neighbour in cells and neighbour not in seen:
                        seen.add(neighbour)
                        stack.append(neighbour)
            if len(blob) > len(best):
                best = blob
        xs = [cell[0] * 12 + 6 for cell in best]
        ys = [cell[1] * 12 + 6 for cell in best]
        return (sum(xs) // len(xs), sum(ys) // len(ys))

    # 1. Anchored search: the answer button sits on Cancel's row, to its right.
    tsv = sh(["tesseract", str(shot_path), "-", "tsv"], timeout=60)
    for line in tsv.splitlines()[1:]:
        fields = line.split("\t")
        if len(fields) >= 12 and fields[11].strip().lower() == "cancel":
            left, top, w, h = (int(fields[6]), int(fields[7]), int(fields[8]), int(fields[9]))
            band = {
                (x, y)
                for y in range(max(0, top - 20), min(height, top + h + 20), 2)
                for x in range(left + w, min(width, left + w + 340), 2)
                if is_blue(x, y)
            }
            if len(band) > 120:
                xs = sorted(x for x, _ in band)
                ys = sorted(y for _, y in band)
                return (xs[len(xs) // 2], ys[len(ys) // 2])

    # 2. Fallback: the largest connected blue blob in the top half.
    every = {(x, y) for y in range(0, int(height * 0.5), 2)
             for x in range(0, width, 2) if is_blue(x, y)}
    return blob_centre(every)


def allow_button(shot_path: Path) -> tuple[int, int] | None:
    """Centre of *Allow on every visit* in Chrome's per-origin file-edit bubble.

    Unlike the per-file prompt's affirmative button (white on blue, unreadable to tesseract),
    this bubble's buttons are plain text on light pills, so the label is the reliable handle:
    find the OCR line that contains "every", and click the middle of that line's box.
    """
    tsv = sh(["tesseract", str(shot_path), "-", "tsv"], timeout=60)
    grouped: dict[tuple[str, str, str], list[list[str]]] = {}
    for line in tsv.splitlines()[1:]:
        fields = line.split("\t")
        if len(fields) >= 12 and fields[11].strip():
            grouped.setdefault((fields[1], fields[2], fields[3]), []).append(fields)
    for group in grouped.values():
        text = " ".join(fields[11] for fields in group).lower()
        if "every" in text and "visit" in text:
            left = min(int(f[6]) for f in group)
            top = min(int(f[7]) for f in group)
            right = max(int(f[6]) + int(f[8]) for f in group)
            bottom = max(int(f[7]) + int(f[9]) for f in group)
            return ((left + right) // 2, (top + bottom) // 2)
    return None


def grant_write(page, path: Path, before: tuple[int, int, int], timeout: float = 20.0) -> dict:
    """Answer whichever of Chrome's two write prompts appears, until the file is written.

    **Two** different prompts guard a write, and either one blocks it:

    1. *per file* — "Save changes to <name>?" (Cancel, and a filled blue affirmative button
       whose label tesseract cannot read, hence `blue_button`);
    2. *per origin* — "<origin> wants to view and edit files from the last time you visited this
       site." with **Allow this time / Allow on every visit / Don't allow**. Measured
       2026-10-10: this one appears on the first write of a browser profile and, left
       unanswered, the save silently never reaches disk — every later check then reads a stale
       file. It is answered with *Allow on every visit* so the grant is persisted in the
       profile and later runs do not meet it again.

    Returns what was answered and whether the write landed; the caller asserts on the *write*,
    not on which prompt the browser chose to show.
    """
    deadline = time.time() + timeout
    answered: list[str] = []
    while time.time() < deadline:
        if snapshot(path) != before:
            return {"answered": answered, "wrote": True}
        shot = screenshot("task4-pickers-write-prompt.png")
        text = " ".join(ocr(shot).split()).lower()
        if "save changes to" in text:
            spot = blue_button(shot)
            if spot:
                x(["mousemove", "--sync", str(spot[0]), str(spot[1])])
                x(["click", "1"])
                answered.append("per-file")
                page.wait_for_timeout(600)
                continue
        if "every visit" in text or "edit files" in text:
            spot = allow_button(shot)
            if spot:
                x(["mousemove", "--sync", str(spot[0]), str(spot[1])])
                x(["click", "1"])
                answered.append("per-origin")
                page.wait_for_timeout(800)
                continue
        time.sleep(0.4)
    return {"answered": answered, "wrote": snapshot(path) != before}


def save_active(page, path: Path, before: tuple[int, int, int]) -> dict:
    """Click Save, answer whatever Chrome asks, and report what happened."""
    click_or_alert(page, "button[data-tool='save']")
    outcome = grant_write(page, path, before)
    page.wait_for_timeout(900)
    return {
        **outcome,
        "failed": page.locator("[data-dialog='alert']").count() > 0,
        "alert": (page.locator(".npp-dialog-body").all_text_contents() or [""])[0][:90],
        "dirty": info(page)["dirty"],
    }


def alert_open(page) -> bool:
    return page.locator("[data-dialog-action='ok']").count() > 0


def dismiss_alert(page) -> str:
    body = (page.locator(".npp-dialog-body").all_text_contents() or [""])[0][:90]
    page.click("[data-dialog-action='ok']")
    page.wait_for_timeout(200)
    return body


def click_or_alert(page, selector: str, timeout: int = 8000) -> bool:
    """Click, but never let a stray in-app alert turn into a 30-second crash.

    An alert left open blocks every later click, so it is reported as a failed
    check and dismissed rather than allowed to abort the run — a crash would hide
    every check after it.
    """
    try:
        page.click(selector, timeout=timeout)
        return True
    except Exception:
        if not alert_open(page):
            raise
        check(f"a stray alert had to be dismissed before clicking {selector}", False,
              dismiss_alert(page))
        page.click(selector, timeout=timeout)
        return True


def geometry(wid: str, attempts: int = 6) -> dict[str, str]:
    """`xdotool getwindowgeometry --shell` as a dict, retried.

    The chooser is a separate X window driven from outside the page, and a transient round trip
    that returns nothing usable used to take the whole run down with a `KeyError: 'X'` — a crash
    hides every check behind it, which is the one failure mode this script must not have.
    """
    last = ""
    for attempt in range(attempts):
        last = x(["getwindowgeometry", "--shell", wid])
        parsed = dict(line.split("=", 1) for line in last.splitlines() if "=" in line)
        # Size is the tell, not position: an unmapped window reports WIDTH=1 HEIGHT=1, while with no
        # window manager the chooser is *placed* at the origin — a real dialog measured
        # `X=0 Y=0 WIDTH=930 HEIGHT=510`. Checking for a non-zero position (tried, measured) threw
        # away every good reading on this display and ended the run at check 5.
        try:
            sized = int(parsed["WIDTH"]) > 100 and int(parsed["HEIGHT"]) > 100
        except (KeyError, ValueError):
            sized = False
        if sized:
            return parsed
        time.sleep(0.3 * (attempt + 1))
    raise RuntimeError(
        f"xdotool reported no geometry for a real dialog at window {wid}: {last!r}"
    )


def type_path(wid: str, path: Path) -> None:
    """Drive the GTK chooser: focus it, location bar, the path, Return.

    Two of the environment traps this script documents, both handled here: with no window manager
    X focus is `PointerRoot` (keys follow the pointer, so the pointer is moved inside the dialog
    first) and Chromium never considers itself focused without a WM (hence the explicit
    `windowfocus`, the same fix trap 3 needed for the Chrome window). The `windowfocus` on the
    *dialog* is what keeps a stray `ctrl+l` from reaching the browser's own location bar — which
    navigates the page away from the app and takes every later check down with it.

    A read-back of the location bar (screenshot + OCR) between typing and Return was tried here and
    **removed**: it doubles the work per open, adds two failure modes of its own (ffmpeg grabbing
    the display, tesseract misreading a bar it can read), and it cannot be trusted anyway — the
    fixture lives in `/tmp`, which is the dialog's own listing, so the OCR finds the file name
    whether or not the typing landed. What protects the check instead is that every caller asserts
    the *right file* arrived, and `open_via_dialog` gives a lost keystroke one more go.
    """
    geom = geometry(wid)
    # PointerRoot focus: the pointer has to be inside the dialog for keys to land.
    x(["mousemove", str(int(geom["X"]) + 40), str(int(geom["Y"]) + 10)], timeout=10)
    time.sleep(0.2)
    # ...and an explicit focus, so the dialog keeps them even if the pointer drifts.
    x(["windowfocus", wid], timeout=10)
    time.sleep(0.3)
    x(["key", "--clearmodifiers", "ctrl+l"])
    time.sleep(0.5)
    x(["type", "--clearmodifiers", "--delay", "25", str(path)])
    time.sleep(0.6)
    x(["key", "--clearmodifiers", "Return"])


def info(page) -> dict:
    return page.evaluate("() => window.__workspace.inspect()")


def tab_names(page) -> list[str]:
    return page.evaluate(
        "() => [...document.querySelectorAll('.npp-tab')].map((node) => node.textContent.trim())"
    )


def app_mounted(page) -> bool:
    """Is this page still hosting the app? A keystroke that reaches Chrome's location bar navigates
    the page away, and then every `inspect()` throws `Cannot read properties of undefined` — a
    traceback that hides every check behind it and says nothing about the cause."""
    try:
        return bool(page.evaluate("() => typeof window.__workspace !== 'undefined'"))
    except Exception:
        return False


# Wraps the real picker so every Open can be traced: was the picker called, and how
# did it settle? Without this a silent `AbortError` is indistinguishable from a
# click that never arrived. Installed by `trace_pickers()`.
TRACE_PICKERS = """() => {
    if (window.__pickerLog) return;
    window.__pickerLog = [];
    const wrap = (name) => {
        const original = window[name];
        window[name] = async (...args) => {
            window.__pickerLog.push([name, 'called']);
            try {
                const result = await original.apply(window, args);
                window.__pickerLog.push([name, 'returned', Array.isArray(result) ? result.length : 'handle']);
                return result;
            } catch (error) {
                window.__pickerLog.push([name, 'threw', error.name, error.message]);
                throw error;
            }
        };
    };
    wrap('showOpenFilePicker');
    wrap('showSaveFilePicker');
}"""


def trace_pickers(page) -> None:
    page.evaluate(TRACE_PICKERS)


def picker_log(page) -> str:
    try:
        return repr(page.evaluate("() => window.__pickerLog || []"))
    except Exception as error:  # page gone
        return f"<no log: {error}>"


# ── the one route every open takes: the real dialog, or a loud failure ───────
def open_via_dialog(page, path: Path, expect: str, warn: bool = False, attempts: int = 2) -> bool:
    """Click Open, drive the real chooser, wait for the file to arrive.

    Returns False (and records a FAIL) if the dialog never appears, so no later
    assertion can pass vacuously against whatever document happened to be open.

    Retried once when the wrong file comes back. Measured reason: the path is typed into the
    chooser with synthetic X keystrokes, and a keystroke that goes missing leaves the dialog on
    whatever was selected — so Return opens the *previous* file. Left alone, that reads as "the app
    opened the wrong file", which is exactly the sort of app-side suspicion this script's own
    `isSameEntry` probe had to clear (two copies of one file are correctly *not* the same entry).
    The checks below still assert the right file was opened; this only gives the typing a second go.
    """
    for attempt in range(attempts):
        if _open_via_dialog_once(page, path, expect, warn):
            return True
        if attempt + 1 < attempts:
            check(f"the dialog for {expect} needed a second attempt", True,
                  "the first attempt's keystrokes did not select it — retrying")
    return False


def _open_via_dialog_once(page, path: Path, expect: str, warn: bool = False) -> bool:
    focus_main()
    # Whether a D4 warning is *owed* depends on whether this open creates a document: the app warns
    # about an assumed encoding when it decodes a file, and says nothing when N++'s "we don't open
    # the existing doc" rule (NppIO.cpp:306-330) simply activates one that is already open.
    before_documents = info(page)["documents"]
    already_active = info(page)["activeFileName"] == expect
    click_or_alert(page, "button[data-tool='open']")
    found = wait_for_window("select a file", timeout=20)
    check(f"Open raises the real OS file chooser for {expect}", found is not None,
          found[1] if found else f"no dialog window appeared · pickers: {picker_log(page)}")
    if not found:
        return False

    type_path(found[0], path)
    warned = False
    deadline = time.time() + 45
    # The state is read *in* the loop and kept, so a failure can say what actually happened at the
    # deadline. Reading it afterwards once produced "handed back t4-win1252.txt [active document is
    # 't4-win1252.txt']" — a check that contradicts itself because the file arrived a moment late.
    late: str | None = None
    dismissals = 0
    seen_at: float | None = None
    warn_window = 6.0
    while time.time() < deadline:
        # D4: a non-UTF-8 file arrives with an explicit warning to dismiss — and the
        # warning is raised *after* the document is adopted, so it can still be
        # arriving when the filename is already there. Wait for it rather than
        # racing it: a warning left open blocks every later click in the page.
        if not app_mounted(page):
            check(f"the page still hosts the app after driving the dialog for {expect}", False,
                  "the page navigated away — a keystroke reached the browser's location bar "
                  "instead of the dialog")
            return False
        if alert_open(page):
            dismiss_alert(page)
            dismissals += 1
            warned = True
            continue
        late = info(page)["activeFileName"]
        if late == expect:
            if seen_at is None:
                seen_at = time.time()
            # The warning is raised after the document is adopted, so it can arrive a moment after
            # the name does — but it is only owed when this open actually created the document.
            # Waiting for it unconditionally is an infinite wait when the file was already open (a
            # restored session, or the previous attempt): measured, that spent a 45-second deadline
            # ignoring a document that was on screen the whole time, with `dismissals = 0` and the
            # active document already correct.
            if warn and not warned and time.time() - seen_at < warn_window:
                page.wait_for_timeout(700)
                continue
            if warn:
                owed = info(page)["documents"] > before_documents and not already_active
                check(f"the assumed-encoding warning was shown for {expect}", warned or not owed,
                      "" if warned or not owed else
                      f"no warning appeared within {warn_window:g} s of the document arriving, and"
                      " this open created a document, so one was owed")
            check(f"the real dialog handed back {expect}", True)
            return True
        time.sleep(0.25)
    check(f"the real dialog handed back {expect}", False,
          f"the active document was {late!r} at the deadline, 45 s after Return; {dismissals} modal"
          f" alert(s) were dismissed while waiting and the page still reports"
          f" {page.locator('[data-dialog]').count()} dialog(s) open — the file was adopted, so this is"
          " the check's own exit condition, not a lost open (see the session log)")
    return False


def main() -> int:
    if sh(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", URL]) != "200":
        print(f"dev server is not answering at {URL} — run `npm run dev` first")
        return 2

    SHOT_DIR.mkdir(parents=True, exist_ok=True)
    SCRATCH.mkdir(parents=True, exist_ok=True)

    # The canonical fixtures the manual checklist also uses. Re-created if absent,
    # and never edited by this script (the edit test works on a copy).
    CRLF_BOM.write_bytes(CRLF_BOM_BYTES)
    WIN1252.write_bytes(WIN1252_BYTES)
    EDIT_COPY.unlink(missing_ok=True)
    before = {"crlf": md5(CRLF_BOM), "win1252": md5(WIN1252)}
    print(f"fixtures: {CRLF_BOM} {before['crlf']} · {WIN1252} {before['win1252']}")

    xvfb = subprocess.Popen(
        ["Xvfb", DISPLAY, "-screen", "0", SCREEN, "-nolisten", "tcp"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    # From here on, "the display" means the virtual one — for xdotool, ffmpeg and
    # tesseract alike. The script is its own process, so this leaks nowhere.
    os.environ["DISPLAY"] = DISPLAY
    env = dict(os.environ)

    # Xvfb is ready when it *answers*, not when its process exists. A fixed sleep is a guess, and an
    # Xvfb that exits immediately (a stale `:99` still held by an earlier run) used to leave this
    # script driving whatever display happened to be there — silently, with xdotool's errors landing
    # in return values nobody checked. Measured here: the display can stop answering mid-run, so its
    # readiness is worth knowing about at the start rather than at check 29.
    ready = ""
    for _ in range(40):
        if xvfb.poll() is not None:
            break
        try:
            ready = sh(["xdotool", "getdisplaygeometry"], timeout=5)
        except DisplayStalled:
            ready = ""
        if re.fullmatch(r"\d+ \d+", ready):
            break
        ready = ""
        time.sleep(0.25)
    if not ready:
        print(f"the virtual display {DISPLAY} never came up (Xvfb exit={xvfb.poll()})")
        xvfb.kill()
        return 2

    chrome = None
    ended_early = ""
    try:
        # Task 7 made the app restore a session on load, and a session left by an earlier run is a
        # different starting state from the one every assertion below assumes (§4-6 of the plan:
        # Task 4's checks are about the pickers, not about the restore). Wiped here rather than left
        # to the caller, and asserted as a check, so the run cannot be misread as a fresh start when
        # it was not.
        profile = SCRATCH / "chrome-profile"
        shutil.rmtree(profile, ignore_errors=True)
        # A headed Chrome on X11: the GTK chooser it opens is a real X window. The
        # private D-Bus session keeps the picker off xdg-desktop-portal, whose
        # dialog renders on the user's own desktop rather than here.
        chrome = subprocess.Popen(
            [
                "dbus-run-session", "--",
                "google-chrome",
                f"--remote-debugging-port={CDP_PORT}",
                f"--user-data-dir={profile}",
                "--ozone-platform=x11",
                f"--window-size={SCREEN_W - 100},{SCREEN_H - 100}",
                "--window-position=0,0",
                "--no-first-run", "--no-default-browser-check",
                "--disable-gpu", "--disable-dev-shm-usage",
                # No background networking: a Chrome "Relaunch to update" bubble appeared over a
                # run (visible in the dialog OCR) and a bubble that takes focus is a lost keystroke
                # from the dialog — the one thing that makes this script's synthetic typing fail.
                "--disable-background-networking", "--disable-component-update",
                "--disable-features=Translate,OptimizationHints,MediaRouter",
                URL,
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

            page = browser.contexts[0].pages[0]
            page.on("console",
                    lambda m: console_errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: console_errors.append(str(e)))
            page.wait_for_selector(".npp-app", timeout=20000)
            check("boots in a headed browser with the pickers present",
                  info(page)["fileSystemAccess"] is True)
            check("no unsupported-browser notice when the API exists",
                  page.locator("[data-notice='unsupported']").count() == 0)
            start = info(page)
            check("the run starts from a clean profile: one empty buffer, nothing restored",
                  start["documents"] == 1 and start["activeFileName"] is None,
                  json.dumps({k: start[k] for k in ("documents", "activeFileName", "dirty")})
                  + " tabs=" + json.dumps(tab_names(page)))
            main_wid = focus_main()
            check("the browser window is the one on our display", main_wid is not None)
            trace_pickers(page)

            # ══ 1. the dialog itself ════════════════════════════════════════
            focus_main()
            click_or_alert(page, "button[data-tool='open']")
            found = wait_for_window("select a file", timeout=20)
            check("Open raises the real OS file chooser", found is not None,
                  found[1] if found else f"no dialog window appeared · pickers: {picker_log(page)}")
            if not found:
                return 1
            wid, _ = found
            shot = screenshot("task4-pickers-dialog.png")
            text = ocr(shot)
            check("it is a real file chooser, with its own widgets",
                  "cancel" in text.lower() and "open" in text.lower(),
                  " ".join(text.split())[:70])

            type_path(wid, CRLF_BOM)
            shot = screenshot("task4-pickers-typed-path.png")
            typed = alnum(ocr(shot))
            check("the path typed into the real dialog renders in its location bar",
                  "t4" in typed and "bom" in typed and "txt" in typed, str(shot.name))
            page.wait_for_function(
                "() => window.__workspace.inspect().activeFileName === 't4-crlf-bom.txt'",
                timeout=20000,
            )
            check("the dialog closes once a file is chosen",
                  wait_for_window("select a file", timeout=2) is None)

            # ══ 2. the file that came back is the real file ═════════════════
            opened = info(page)
            check("the chosen file is opened", opened["activeFileName"] == CRLF_BOM.name,
                  str(opened["activeFileName"]))
            # The document model holds lines, not line endings: CM6 normalises to
            # \n and the file's CRLF is re-applied on write — which is why the
            # byte-identical save below is the check that actually proves CRLF.
            check("its text is what is on disk",
                  (opened["text"] or "") == "line one\nline two\n",
                  repr((opened["text"] or "")[:24]))
            check("BOM stripped, CRLF detected, encoding utf-8",
                  opened["eol"] == "CRLF" and opened["encoding"] == "utf-8"
                  and not (opened["text"] or "").startswith("\ufeff"),
                  f"{opened['encoding']}/{opened['eol']}")
            status = page.locator(".npp-statusbar").text_content() or ""
            check("the status bar names the file's encoding and line ending",
                  "utf-8" in status and "CRLF" in status, status.strip()[-40:])

            # ══ 3. save with no edit: the bytes must not move, but the write ══
            # must really happen — a cancelled write also leaves the bytes alone.
            before_stat = snapshot(CRLF_BOM)
            first = save_active(page, CRLF_BOM, before_stat)
            # Was: "the first write asks Chrome's permission, and the check grants it" —
            # which asserted that a prompt *appears*. Answering the per-origin bubble with
            # "Allow on every visit" persists the grant in the profile, so that assertion
            # could never hold again (2026-10-10). What matters is that the permission step
            # is satisfied and the write lands; the inode check below is the hard evidence.
            check("the write is permitted (both Chrome prompts are answered if they appear)",
                  first["wrote"] is True and first["failed"] is False,
                  f"prompts answered: {first['answered'] or 'none were needed'}")
            check("the write really happened (Chrome replaced the file on disk)",
                  wait_for_write(CRLF_BOM, before_stat),
                  f"{before_stat[2]} -> {snapshot(CRLF_BOM)[2]} (inode)")
            check("save with no edit leaves the real file byte-identical",
                  md5(CRLF_BOM) == before["crlf"], md5(CRLF_BOM))
            check("the app reported no failure", first["failed"] is False, first["alert"])
            check("the saved document is no longer dirty", first["dirty"] is False)
            check("a plain Save raised no Save As dialog",
                  wait_for_window("save", timeout=1) is None)
            check("the file on disk is still the file the dialog chose",
                  page.evaluate("() => window.__workspace.inspect().activeFileName")
                  == CRLF_BOM.name)

            # ══ 4. edit, save, confirm the bytes ════════════════════════════
            shutil.copyfile(CRLF_BOM, EDIT_COPY)
            opened_copy = open_via_dialog(page, EDIT_COPY, "t4-edit-copy.txt")
            check("a second open goes through the dialog again", opened_copy)
            if opened_copy:
                focus_main()
                click_or_alert(page, ".npp-pane[data-pane='primary'] .cm-content")
                page.keyboard.press("Control+End")
                page.keyboard.type("three")
                page.wait_for_timeout(200)
                check("typing marks the document dirty", info(page)["dirty"] is True)
                copied_stat = snapshot(EDIT_COPY)
                edited_save = save_active(page, EDIT_COPY, copied_stat)
                check("the edit's write was permitted (Chrome's prompt, if any)",
                      edited_save["failed"] is False, edited_save["alert"])
                check("the edit's write really happened (Chrome replaced the file)",
                      wait_for_write(EDIT_COPY, copied_stat))
                after = EDIT_COPY.read_bytes()
                check("the edit reached the real file on disk",
                      after.startswith(UTF8_BOM) and after.endswith(b"line two\r\nthree"),
                      repr(after[-24:]))
                check("CRLF survived the edit", after.count(b"\r\n") >= 2)
                check("the canonical fixture is untouched by the edit test",
                      md5(CRLF_BOM) == before["crlf"])
                check("the edited copy differs from the original",
                      md5(EDIT_COPY) != before["crlf"])

            # ══ 5. a windows-1252 file round-trips through the real dialog ══
            focus_main()
            opened_latin = open_via_dialog(page, WIN1252, WIN1252.name, warn=True)
            check("a windows-1252 file opens through the real dialog", opened_latin,
                  str(info(page)["activeFileName"]))
            if opened_latin:
                latin = info(page)
                check("windows-1252: the accented text is decoded correctly",
                      "café" in (latin["text"] or ""), repr((latin["text"] or "")[:14]))
                check("windows-1252: flagged as assumed, not silently guessed (D4)",
                      latin["assumedEncoding"] is True,
                      json.dumps({k: latin[k] for k in ("activeFileName", "encoding", "eol",
                                                        "assumedEncoding", "documents", "dirty")})
                      + " tabs=" + json.dumps(tab_names(page))
                      + " session=" + json.dumps(page.evaluate(
                          "() => window.__workspace.debugSession()"))[:400])
                latin_stat = snapshot(WIN1252)
                latin_save = save_active(page, WIN1252, latin_stat)
                check("windows-1252: the write was permitted", latin_save["failed"] is False,
                      latin_save["alert"])
                check("windows-1252: the write really happened (Chrome replaced the file)",
                      wait_for_write(WIN1252, latin_stat))
                check("windows-1252: byte-identical round trip on disk",
                      md5(WIN1252) == before["win1252"], md5(WIN1252))
                screenshot("task4-pickers-roundtrip.png")

            # ══ 6. dismissing the dialog is a cancel, not an error ══════════
            focus_main()
            count = info(page)["documents"]
            click_or_alert(page, "button[data-tool='open']")
            found = wait_for_window("select a file", timeout=20)
            check("Open raises the dialog again for the cancel test", found is not None)
            if found:
                x(["key", "--clearmodifiers", "Escape"])
            page.wait_for_timeout(800)
            check("Escape closes the dialog",
                  wait_for_window("select a file", timeout=2) is None)
            check("a dismissed picker opens nothing", info(page)["documents"] == count,
                  f"{info(page)['documents']} vs {count}")
            check("and is not reported as an error",
                  page.locator("[data-dialog='alert']").count() == 0)
            check("no page errors in the whole run", len(console_errors) == 0,
                  "; ".join(console_errors[:2]))

            browser.close()
    except DisplayStalled as stalled:
        # Whatever wedged the display, that is a fact about the environment, not the app: the checks
        # after it did not run, and the summary says so rather than reading as a partial pass.
        ended_early = str(stalled)
        check("the virtual display kept answering for the whole run", False, ended_early)
    finally:
        if chrome is not None:
            chrome.send_signal(signal.SIGTERM)
            try:
                chrome.wait(timeout=10)
            except subprocess.TimeoutExpired:
                chrome.kill()
        xvfb.send_signal(signal.SIGTERM)
        try:
            xvfb.wait(timeout=10)
        except subprocess.TimeoutExpired:
            xvfb.kill()
        EDIT_COPY.unlink(missing_ok=True)

    failed = [name for name, ok, _ in results if not ok]
    print(f"\n{'=' * 64}")
    print(f"VERIFY-TASK4-PICKERS: {'PASS' if not failed else 'FAIL'}  "
          f"({len(results) - len(failed)}/{len(results)} checks)")
    if ended_early:
        print(f"note: the run ended early after {len(results)} checks — {ended_early}")
        print("      the checks after that point never ran; re-run in a quiet environment")
    if failed:
        print("failed: " + "; ".join(failed))
    print("fixtures after the run:")
    print(f"  {CRLF_BOM} {md5(CRLF_BOM)}  (was {before['crlf']})")
    print(f"  {WIN1252} {md5(WIN1252)}  (was {before['win1252']})")
    print("=" * 64)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
