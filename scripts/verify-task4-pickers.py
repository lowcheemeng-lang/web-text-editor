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
"""
from __future__ import annotations

import hashlib
import os
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


def sh(cmd: list[str], timeout: int = 30) -> str:
    # DISPLAY is set to the virtual display in main(); everything below (xdotool,
    # ffmpeg, tesseract) must talk to that one, not to the desktop we inherited.
    r = subprocess.run(cmd, capture_output=True, text=True, env=os.environ, timeout=timeout)
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


def answer_write_prompt(page, timeout: float = 15.0) -> bool:
    """Grant Chrome's write permission, if it is asking.

    Returns True when the prompt was found and its affirmative button clicked. The
    click is a real X click (the prompt is browser UI, not DOM); `page` is only used
    to pace the polling.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        shot = screenshot("task4-pickers-write-prompt.png")
        if "save changes to" in " ".join(ocr(shot).split()).lower():
            spot = blue_button(shot)
            if spot:
                x(["mousemove", "--sync", str(spot[0]), str(spot[1])])
                x(["click", "1"])
                page.wait_for_timeout(600)
                return True
        time.sleep(0.4)
    return False


def save_active(page, prompt_expected: bool) -> dict:
    """Click Save, answer the permission prompt, and report what happened."""
    click_or_alert(page, "button[data-tool='save']")
    granted = answer_write_prompt(page)
    page.wait_for_timeout(900)
    return {
        "granted": granted,
        "expected_prompt": prompt_expected,
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


def type_path(wid: str, path: Path) -> None:
    """Drive the GTK chooser: location bar, the path, Return."""
    geometry = x(["getwindowgeometry", "--shell", wid])
    geom = dict(line.split("=", 1) for line in geometry.splitlines() if "=" in line)
    # PointerRoot focus: the pointer has to be inside the dialog for keys to land.
    x(["mousemove", "--sync", str(int(geom["X"]) + 40), str(int(geom["Y"]) + 10)])
    time.sleep(0.3)
    x(["key", "--clearmodifiers", "ctrl+l"])
    time.sleep(0.5)
    x(["type", "--clearmodifiers", "--delay", "25", str(path)])
    time.sleep(0.5)
    x(["key", "--clearmodifiers", "Return"])


def info(page) -> dict:
    return page.evaluate("() => window.__workspace.inspect()")


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
def open_via_dialog(page, path: Path, expect: str, warn: bool = False) -> bool:
    """Click Open, drive the real chooser, wait for the file to arrive.

    Returns False (and records a FAIL) if the dialog never appears, so no later
    assertion can pass vacuously against whatever document happened to be open.
    """
    focus_main()
    click_or_alert(page, "button[data-tool='open']")
    found = wait_for_window("select a file", timeout=20)
    check(f"Open raises the real OS file chooser for {expect}", found is not None,
          found[1] if found else f"no dialog window appeared · pickers: {picker_log(page)}")
    if not found:
        return False

    type_path(found[0], path)
    warned = False
    deadline = time.time() + 25
    while time.time() < deadline:
        # D4: a non-UTF-8 file arrives with an explicit warning to dismiss — and the
        # warning is raised *after* the document is adopted, so it can still be
        # arriving when the filename is already there. Wait for it rather than
        # racing it: a warning left open blocks every later click in the page.
        if alert_open(page):
            dismiss_alert(page)
            warned = True
            continue
        if info(page)["activeFileName"] == expect:
            if warn and not warned:
                page.wait_for_timeout(700)
                continue
            if warn:
                check(f"the assumed-encoding warning was shown for {expect}", True)
            check(f"the real dialog handed back {expect}", True)
            return True
        time.sleep(0.25)
    check(f"the real dialog handed back {expect}", False,
          f"active document is {info(page)['activeFileName']!r}")
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
    chrome = None
    try:
        time.sleep(1.5)
        profile = SCRATCH / "chrome-profile"
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
            page.wait_for_function("() => window.__workspace.inspect().documents > 1",
                                   timeout=20000)
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
            first = save_active(page, prompt_expected=True)
            check("the first write asks Chrome's permission, and the check grants it",
                  first["granted"] is True,
                  "prompt answered" if first["granted"] else "no prompt appeared")
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
                edited_save = save_active(page, prompt_expected=True)
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
                      latin["assumedEncoding"] is True)
                latin_stat = snapshot(WIN1252)
                latin_save = save_active(page, prompt_expected=True)
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
    if failed:
        print("failed: " + "; ".join(failed))
    print("fixtures after the run:")
    print(f"  {CRLF_BOM} {md5(CRLF_BOM)}  (was {before['crlf']})")
    print(f"  {WIN1252} {md5(WIN1252)}  (was {before['win1252']})")
    print("=" * 64)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
