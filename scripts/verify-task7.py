"""Task 7 acceptance check — session persistence and preferences, in real Chrome.

    npm run dev                       # in another shell
    python3 scripts/verify-task7.py   # exit 0 = Task 7 accepted

What this proves, and how
------------------------
The whole task is "what survives a reload", so almost every assertion here is made **after a real
`page.reload()`** — which throws away every in-page stub, every variable and every queued timer. A
state that comes back after a reload was genuinely stored; nothing else can survive it.

Storage cannot be inspected from outside the page, so three views of the truth are read:

  * `inspect()`      — the app's own report (preferences, restore counters, what is on screen)
  * `debugSession()` — the record that was actually written (N++'s `session.xml`, as data)
  * `debugBackups()` — the files in OPFS `backup/`, by name (N++'s `backup/` directory)

The pickers are stubbed with OPFS handles, exactly as in `verify-task4.py`: the OS dialog is the one
thing a page cannot be driven through, and OPFS yields genuine `FileSystemFileHandle`s, so
permission checks, reads and writes all run for real. The backup interval is shortened through the
preferences dialog itself, so the check exercises that preference instead of waiting N++'s 7000 ms.

Every check that asserts "something came back" also asserts the *negative* somewhere: a tab that
should be gone, an alert that says work was lost, a placeholder that refuses typing — because a
restore that silently drops a document is the failure this task exists to prevent.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:5173/"
SHOT_DIR = Path(__file__).resolve().parent.parent / ".hermes" / "cache" / "screenshots"

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))


# ── OPFS helpers, run inside the page ────────────────────────────────────────

SEED = """async ([name, data]) => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(name, { create: true });
    const stream = await handle.createWritable();
    await stream.write(new Uint8Array(data));
    await stream.close();
}"""

READ = """async (name) => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(name);
    const file = await handle.getFile();
    return Array.from(new Uint8Array(await file.arrayBuffer()));
}"""

REMOVE = """async (name) => {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(name);
}"""

STUB_PICKERS = """async ([openName, saveName]) => {
    const root = await navigator.storage.getDirectory();
    window.showOpenFilePicker = async () => [await root.getFileHandle(openName)];
    window.showSaveFilePicker = async () => await root.getFileHandle(saveName, { create: true });
}"""

# The fold gutter's marker is found the way verify-task6.py had to: the first `span[title]` is CM's
# hidden initial spacer, whose marker carries the *other* title, and CM resolves a click on the
# gutter to a line by its y coordinate — so this returns real viewport coordinates for a real click.
FOLD_MARKER = """(which) => {
    const gutter = document.querySelectorAll('.cm-foldGutter')[which];
    if (!gutter) return null;
    const marker = [...gutter.querySelectorAll('span[title="Fold line"]')].find((span) => {
        const element = span.closest('.cm-gutterElement');
        return element && getComputedStyle(element).visibility !== 'hidden'
            && element.getBoundingClientRect().height > 0;
    });
    if (!marker) return null;
    const box = marker.getBoundingClientRect();
    return { title: marker.getAttribute('title'), x: box.x + box.width / 2, y: box.y + box.height / 2 };
}"""

FOLD_PLACEHOLDERS = """() => Array.from(document.querySelectorAll('.npp-pane'))
    .map((pane) => pane.querySelectorAll('.cm-foldPlaceholder').length)"""


def info(page) -> dict:
    return page.evaluate("() => window.__workspace.inspect()")


def seeded_file(page, name: str, data: bytes) -> None:
    page.evaluate(SEED, [name, list(data)])


def read_back(page, name: str) -> bytes:
    return bytes(page.evaluate(READ, name))


def remove_file(page, name: str) -> None:
    page.evaluate(REMOVE, name)


def stub_pickers(page, open_name: str, save_name: str | None = None) -> None:
    page.evaluate(STUB_PICKERS, [open_name, save_name or open_name])


UTF8_BOM = b"\xef\xbb\xbf"


def wait_ready(page, timeout: int = 15000) -> dict:
    """Wait for the restore to have finished — `start()` restores asynchronously on purpose."""
    page.wait_for_selector(".npp-app", timeout=10000)
    page.wait_for_function(
        "() => { const w = window.__workspace; return w && w.inspect().session.complete === true; }",
        timeout=timeout,
    )
    return info(page)


def reload_and_wait(page) -> dict:
    page.reload(wait_until="load")
    return wait_ready(page)


def alert_text(page) -> str | None:
    node = page.locator("[data-dialog='alert'] .npp-dialog-body")
    return node.text_content() if node.count() else None


def alert_title(page) -> str | None:
    node = page.locator("[data-dialog='alert'] .npp-dialog-title")
    return node.text_content() if node.count() else None


def dismiss_alert(page) -> str:
    text = alert_text(page) or ""
    title = alert_title(page) or ""
    page.click("[data-dialog='alert'] [data-dialog-action='ok']")
    page.wait_for_timeout(120)
    return f"{title}: {text}"


def click_or_alert(page, selector: str, timeout: int = 10000) -> None:
    """Click, and if a modal alert is in the way, name it and dismiss it instead of hanging."""
    try:
        page.click(selector, timeout=timeout)
        return
    except Exception:
        if not page.locator("[data-dialog='alert']").count():
            raise
        check(f"a stray alert had to be dismissed before clicking {selector}", False, dismiss_alert(page))
        page.click(selector, timeout=timeout)


def set_preferences(page, values: dict[str, object], apply: bool = True) -> dict:
    """Open Settings ▸ Preferences…, set the named controls, then OK (or Cancel) and wait."""
    click_or_alert(page, ".npp-menu-title >> text=Settings")
    page.click("[data-menu-item='preferences']")
    page.wait_for_selector("[data-dialog='preferences']", timeout=5000)
    for key, value in values.items():
        selector = f"[data-pref='{key}']"
        kind = page.get_attribute(selector, "type")
        if kind == "checkbox":
            page.set_checked(selector, bool(value))
        elif page.evaluate("(s) => document.querySelector(s).tagName", selector) == "SELECT":
            page.select_option(selector, str(value))
        else:
            page.fill(selector, str(value))
    page.click(f"[data-dialog='preferences'] [data-dialog-action='{'confirm' if apply else 'cancel'}']")
    page.wait_for_function("() => document.querySelector(\"[data-dialog='preferences']\") === null",
                           timeout=5000)
    page.wait_for_timeout(150)
    return info(page)


def fold_marker(page, which: int = 0):
    return page.evaluate(FOLD_MARKER, which)


def click_fold_marker(page, which: int = 0) -> bool:
    target = fold_marker(page, which)
    if not target:
        return False
    page.mouse.click(target["x"], target["y"])
    page.wait_for_timeout(200)
    return True


def open_via_picker(page, name: str, wait_for: str | None = None) -> tuple[bool, str]:
    """Open a seeded file through the app's own Open path (the picker is the OPFS stub).

    Returns `(opened, why_not)`. The reason is assembled from the app's own state, any dialog that
    is open and the backup directory, because "the wait timed out" on its own says nothing about
    whether the picker threw, an alert blocked the click, or the open landed somewhere unexpected.
    """
    stub_pickers(page, name)
    click_or_alert(page, "button[data-tool='open']")
    try:
        page.wait_for_function(
            "(expected) => window.__workspace.inspect().activeFileName === expected",
            arg=wait_for or name,
            timeout=10000,
        )
        return True, ""
    except Exception:
        state = info(page)
        dialogs = [
            f"{kind}: {' '.join((node or '').split())[:60]}"
            for kind in ("alert", "confirm")
            if page.locator(f"[data-dialog='{kind}']").count()
            for node in [page.locator(f"[data-dialog='{kind}'] .npp-dialog-body").text_content()]
        ]
        detail = (
            f"active={state['activeFileName']!r} documents={state['documents']} tabs={state['tabs']} "
            f"backups={debug_backups(page)} dialogs={dialogs}"
        )
        for kind, action in (("alert", "ok"), ("confirm", "cancel")):
            if page.locator(f"[data-dialog='{kind}']").count():
                page.click(f"[data-dialog='{kind}'] [data-dialog-action='{action}']")
                page.wait_for_timeout(200)
        return False, detail


def debug_session(page) -> dict:
    return page.evaluate("() => window.__workspace.debugSession()")


def debug_backups(page) -> list[str]:
    return page.evaluate("() => window.__workspace.debugBackups()")


def status_text(page) -> str:
    return page.locator(".npp-statusbar").text_content() or ""


def screenshot(page, name: str) -> Path:
    SHOT_DIR.mkdir(parents=True, exist_ok=True)
    path = SHOT_DIR / name
    page.screenshot(path=str(path))
    return path


def alnum(text: str) -> str:
    """Letters and digits only. Tesseract drops punctuation ("code.js" reads as "codejs"), and the
    point of the pixel check is that the restored *name* is on screen, not how it is punctuated."""
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def ocr(path: Path, psm: str = "7") -> str:
    return subprocess.run(
        ["tesseract", str(path), "-", "--psm", psm],
        capture_output=True, text=True, timeout=60, check=True,
    ).stdout


NPP_DEFAULTS = {
    "rememberLastSession": True,
    "keepSessionAbsentFileEntries": False,
    "snapshotMode": True,
    "snapshotBackupTiming": 7000,
    "toolbarVisible": True,
    "toolbarLayout": "standard",
    "theme": "notepadpp",
    "zoom": 0,
}


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        # A context of its own: a fresh profile with no IndexedDB, no OPFS and no session, which is
        # where "the first load" of every scenario below has to start.
        page = browser.new_page(viewport={"width": 1280, "height": 760})

        console_errors: list[str] = []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: console_errors.append(f"pageerror: {e}"))
        requests: list[str] = []
        page.on("request", lambda r: requests.append(r.url))

        page.goto(URL, wait_until="load")

        # ══ 1. a fresh profile: the welcome document, N++'s defaults ═══════════
        boot = wait_ready(page)
        check("boots with exactly one document", boot["documents"] == 1, str(boot["documents"]))
        check("the restore reports itself finished", boot["session"]["complete"] is True)
        check("nothing was restored on a fresh profile", boot["session"]["restored"] == 0)
        check("the preferences are N++'s own defaults",
              boot["preferences"] == NPP_DEFAULTS, json.dumps(boot["preferences"]))
        check("the persistence request is reported, not assumed",
              isinstance(boot["persistence"]["supported"], bool)
              and isinstance(boot["persistence"]["persisted"], bool)
              and (boot["persistence"]["quota"] or 0) > 0,
              json.dumps(boot["persistence"]))
        check("the menu bar carries N++'s Settings menu",
              "Settings" in boot["menuTitles"], str(boot["menuTitles"]))
        check("a clean profile leaves no console errors", len(console_errors) == 0,
              "; ".join(console_errors[:2]))

        # ══ 2. the Preferences dialog: nothing applies until OK ════════════════
        click_or_alert(page, ".npp-menu-title >> text=Settings")
        page.click("[data-menu-item='preferences']")
        page.wait_for_selector("[data-dialog='preferences']", timeout=5000)
        check("Preferences opens with N++'s session controls",
              page.locator("[data-pref='rememberLastSession']").count() == 1
              and page.locator("[data-pref='snapshotMode']").count() == 1
              and page.locator("[data-pref='keepSessionAbsentFileEntries']").count() == 1)
        check("...and the toolbar, theme and zoom controls",
              page.locator("[data-pref='toolbarVisible']").count() == 1
              and page.locator("[data-pref='toolbarLayout']").count() == 1
              and page.locator("[data-pref='theme']").count() == 1
              and page.locator("[data-pref='zoom']").count() == 1)
        page.fill("[data-pref='zoom']", "5")
        page.click("[data-dialog='preferences'] [data-dialog-action='cancel']")
        page.wait_for_timeout(200)
        check("Cancel leaves the zoom alone", info(page)["zoom"] == 0, str(info(page)["zoom"]))
        check("Cancel leaves the stored preferences alone",
              info(page)["preferences"] == NPP_DEFAULTS, json.dumps(info(page)["preferences"]))

        applied = set_preferences(page, {
            "toolbarVisible": False,
            "toolbarLayout": "small",
            "zoom": 2,
            "snapshotBackupTiming": 1200,
        })
        check("OK stores the new values",
              applied["preferences"]["toolbarVisible"] is False
              and applied["preferences"]["toolbarLayout"] == "small"
              and applied["preferences"]["zoom"] == 2
              and applied["preferences"]["snapshotBackupTiming"] == 1200,
              json.dumps(applied["preferences"]))
        check("the toolbar is hidden — the preference did something",
              page.locator(".npp-toolbar").is_hidden())
        check("the toolbar layout reached the DOM",
              page.locator(".npp-toolbar").get_attribute("data-layout") == "small")
        # nppTheme puts the size on .cm-editor; 10 pt is 13.333 px at 96 dpi, so zoom 2 is 12 pt = 16 px.
        check("the zoom changes the editor's font size (12 pt)", applied["fontSize"] == "16px", str(applied["fontSize"]))

        after = reload_and_wait(page)
        check("the preferences survive a reload",
              after["preferences"] == applied["preferences"], json.dumps(after["preferences"]))
        check("...and are applied at startup, not just stored",
              after["fontSize"] == "16px" and page.locator(".npp-toolbar").is_hidden(),
              f"{after['fontSize']} · toolbar hidden={page.locator('.npp-toolbar').is_hidden()}")

        # ══ 3. View ▸ Zoom: N++'s own commands, and they persist ═══════════════
        click_or_alert(page, ".npp-menu-title >> text=View")
        page.click("[data-menu-item='zoom-in']")
        page.wait_for_timeout(200)
        check("Zoom In adds a point (Scintilla's model)", info(page)["zoom"] == 3, str(info(page)["zoom"]))
        click_or_alert(page, ".npp-menu-title >> text=View")
        page.click("[data-menu-item='zoom-restore']")
        page.wait_for_timeout(200)
        restored_zoom = info(page)
        # 10 pt at 96 dpi is 13.333px; the browser rounds, so this compares the number, not a string.
        size_px = re.match(r"([\d.]+)px", restored_zoom["fontSize"] or "")
        check("Restore Default Zoom returns to N++'s 0 (10 pt)",
              restored_zoom["zoom"] == 0 and size_px is not None and abs(float(size_px.group(1)) - 13.333) < 0.05,
              f"{restored_zoom['zoom']} · {restored_zoom['fontSize']}")
        check("the zoom is stored, not just applied",
              info(page)["preferences"]["zoom"] == 0)
        # Put the toolbar back: the rest of the run drives the app through its own controls.
        set_preferences(page, {"toolbarVisible": True, "zoom": 0})
        check("the toolbar can be shown again from the dialog",
              page.locator(".npp-toolbar").is_visible())

        # ══ 4. an unsaved scratch buffer survives a reload ═════════════════════
        page.click(".npp-pane .cm-content")
        page.keyboard.press("Control+End")
        page.keyboard.type("RESTORE-ME\nsecond line of the scratch buffer\n")
        page.keyboard.press("Control+F2")  # bookmark the line the caret is on
        before = info(page)
        check("the scratch buffer is dirty", before["dirty"] is True)
        check("a bookmark was set", len(before["bookmarks"]) >= 1, str(before["bookmarks"]))
        caret_status = status_text(page)
        check("the status bar reports the caret", "Ln " in caret_status, caret_status.strip()[:60])

        # No flush and no dev call: the session writes itself, on its own debounce.
        page.wait_for_function(
            "() => { const s = window.__workspace.inspect(); return s.session.written >= 1"
            " && s.backupPath !== null; }",
            timeout=10000,
        )
        record = debug_session(page)
        backups = debug_backups(page)
        check("the backup is named the way N++ names it (FILENAME@YYYY-MM-DD_HHMMSS)",
              len(backups) == 1 and re.fullmatch(r"backup/new 1@\d{4}-\d{2}-\d{2}_\d{6}", backups[0]) is not None,
              str(backups))
        check("the record points at that backup",
              record["mainView"]["files"][0]["backupPath"] == backups[0],
              json.dumps(record["mainView"]["files"][0]["backupPath"]))
        check("the record carries the caret and the bookmark",
              record["mainView"]["files"][0]["caret"] > 0 and record["mainView"]["files"][0]["marks"] != [],
              json.dumps({k: record["mainView"]["files"][0][k] for k in ("caret", "marks")}))
        check("the record knows the document is untitled and dirty",
              record["mainView"]["files"][0]["untitled"] is True and record["mainView"]["files"][0]["dirty"] is True)

        back = reload_and_wait(page)
        check("one document came back", back["documents"] == 1, str(back["documents"]))
        check("the restore reports it", back["session"]["restored"] == 1, json.dumps(back["session"]))
        check("the unsaved text came back", "RESTORE-ME" in (back["text"] or ""),
              repr((back["text"] or "")[-40:]))
        check("the document came back dirty, as N++ restores a snapshot",
              back["dirty"] is True and back["backupPath"] is not None, str(back["backupPath"]))
        check("the tab says new 1, with the modified marker", back["tabs"] == ["*new 1"], str(back["tabs"]))
        check("the bookmark came back", back["bookmarks"] == before["bookmarks"],
              f"{back['bookmarks']} vs {before['bookmarks']}")
        check("the caret came back where it was", status_text(page) == caret_status,
              f"{status_text(page).strip()[:50]} vs {caret_status.strip()[:50]}")
        check("the welcome buffer did not come back as well", back["session"]["dropped"] == 0, json.dumps(back["session"]))

        # A clean document has nothing to protect: saving it away must delete its backup.
        page.keyboard.press("Control+End")
        page.keyboard.press("Control+A")
        page.keyboard.press("Delete")  # empty the buffer, then undo back to the save point is not the point
        page.keyboard.press("Control+Z")
        page.evaluate("() => window.__workspace.flushSession()")
        page.wait_for_timeout(200)
        check("a dirty document still has its backup after a flush", len(debug_backups(page)) == 1,
              str(debug_backups(page)))

        # ══ 5. a file-backed document: edit → backup → restore → save ═════════
        seeded_file(page, "note.txt", UTF8_BOM + b"one\r\ntwo\r\n")
        opened_note, why_not = open_via_picker(page, "note.txt")
        check("the file was opened through the app's Open path", opened_note, why_not)
        opened_file = info(page)
        check("the file's own encoding and line endings are known",
              opened_file["encoding"] == "utf-8" and opened_file["eol"] == "CRLF",
              f"{opened_file['encoding']}/{opened_file['eol']}")

        page.click(".npp-pane .cm-content")
        page.keyboard.press("Control+End")
        page.keyboard.type("THREE")
        page.wait_for_function(
            "() => window.__workspace.inspect().backupPath !== null &&"
            " window.__workspace.inspect().backupPath.includes('note.txt')",
            timeout=10000,
        )
        check("the snapshot interval wrote a backup for the file's own edits (preference = 1200 ms)",
              any("note.txt@" in path for path in debug_backups(page)), str(debug_backups(page)))

        restored_file = reload_and_wait(page)
        check("the file document came back", restored_file["activeFileName"] == "note.txt",
              str(restored_file["activeFileName"]))
        check("...dirty, holding the edits the file does not have yet",
              restored_file["dirty"] is True and "THREE" in (restored_file["text"] or ""),
              repr((restored_file["text"] or "")[-20:]))
        check("...with its encoding and line endings intact",
              restored_file["encoding"] == "utf-8" and restored_file["eol"] == "CRLF",
              f"{restored_file['encoding']}/{restored_file['eol']}")

        click_or_alert(page, "button[data-tool='save']")
        page.wait_for_timeout(400)
        check("saving wrote the restored edits to the real file",
              read_back(page, "note.txt") == UTF8_BOM + b"one\r\ntwo\r\nTHREE",
              repr(read_back(page, "note.txt"))[:60])
        check("the save cleared the dirty flag and the backup",
              info(page)["dirty"] is False and info(page)["backupPath"] is None
              and not any("note.txt@" in path for path in debug_backups(page)),
              str(debug_backups(page)))

        # ══ 6. "This file has been modified by another program" ════════════════
        page.click(".npp-pane .cm-content")
        page.keyboard.press("Control+End")
        page.keyboard.type("FOUR")
        page.wait_for_function(
            "() => window.__workspace.inspect().backupPath !== null", timeout=10000)
        # The file changes behind the app's back — another program's edit, as far as the session is
        # concerned — and only then is the session flushed and the page reloaded.
        seeded_file(page, "note.txt", UTF8_BOM + b"changed by another program\r\n")
        page.evaluate("() => window.__workspace.flushSession()")
        page.reload(wait_until="load")
        page.wait_for_selector("[data-dialog='confirm']", timeout=10000)
        body = page.locator("[data-dialog='confirm'] .npp-dialog-body").text_content() or ""
        check("the modified-file question is asked, in N++'s own words",
              "This file has been modified by another program." in body
              and "Do you want to reload it and lose the changes made in Notepad++?" in body,
              " ".join(body.split())[:90])
        page.click("[data-dialog='confirm'] [data-dialog-action='cancel']")  # No
        page.wait_for_timeout(400)
        kept = wait_ready(page)
        check("answering No keeps the backup's edits (N++ keeps the snapshot)",
              "FOUR" in (kept["text"] or "") and kept["dirty"] is True, repr((kept["text"] or "")[-20:]))

        # Again, answering Yes this time: the file on disk wins and the edits are dropped.
        page.evaluate("() => window.__workspace.flushSession()")
        seeded_file(page, "note.txt", UTF8_BOM + b"another program again\r\n")
        page.reload(wait_until="load")
        page.wait_for_selector("[data-dialog='confirm']", timeout=10000)
        page.click("[data-dialog='confirm'] [data-dialog-action='confirm']")  # Yes
        page.wait_for_timeout(400)
        check("the answer is the only prompt — no second 'unsaved changes' warning",
              page.locator("[data-dialog='alert']").count() == 0)
        reloaded = wait_ready(page)
        check("answering Yes reloads the file and drops the edits",
              "another program again" in (reloaded["text"] or "") and reloaded["dirty"] is False,
              repr((reloaded["text"] or "")[:30]))
        check("...and the reload the user agreed to is not also reported as lost work",
              reloaded["session"]["unsavedLost"] == 0, json.dumps(reloaded["session"]))

        # ══ 7. folds, bookmarks, wrap, split and the language all come back ═══
        seeded_file(page, "code.js", b"function outer() {\n  if (true) {\n    return 1;\n  }\n}\n")
        opened_js, why_not = open_via_picker(page, "code.js")
        check("the JavaScript file opened", opened_js, why_not)
        page.wait_for_function(
            "() => { const l = window.__workspace.inspect().language; return l && l.loaded === true; }",
            timeout=10000,
        )
        page.click(".npp-pane .cm-content")
        page.keyboard.press("Control+Home")
        page.keyboard.press("Control+F2")
        check("a fold was made by clicking the real gutter marker", click_fold_marker(page))
        folded = info(page)
        check("...and the editor folded one range", folded["viewFolds"] == [1], str(folded["viewFolds"]))
        page.click("button[data-tool='wordwrap']")
        page.click("button[data-tool='split']")
        page.wait_for_timeout(200)
        split_state = info(page)
        check("with the split open both panes show the fold (the mirror bug this task found)",
              split_state["viewFolds"] == [1, 1], str(split_state["viewFolds"]))
        page.evaluate("() => window.__workspace.flushSession()")
        stored = debug_session(page)
        check("the session records the folded line and the bookmark",
              stored["mainView"]["files"][-1]["folds"] != [] and stored["mainView"]["files"][-1]["marks"] != [],
              json.dumps({k: stored["mainView"]["files"][-1][k] for k in ("folds", "marks")}))
        check("the session records the split", stored["subView"]["files"] == 1, json.dumps(stored["subView"]))

        deep = reload_and_wait(page)
        check("the split came back", deep["split"] is True and deep["views"] == 2,
              f"split={deep['split']} views={deep['views']}")
        check("the folds came back in both panes", deep["viewFolds"] == [1, 1], str(deep["viewFolds"]))
        check("...and are visible as folded regions, not just counted",
              page.evaluate(FOLD_PLACEHOLDERS) == [1, 1], str(page.evaluate(FOLD_PLACEHOLDERS)))
        check("the bookmark came back", len(deep["bookmarks"]) == 1, str(deep["bookmarks"]))
        check("word wrap came back", deep["wordWrap"] is True)
        check("the language came back, with its grammar loaded",
              (deep["language"] or {}).get("id") == "javascript" and (deep["language"] or {}).get("loaded") is True,
              json.dumps(deep["language"]))
        check("the ruler shows the restored document's structure (the mount-time gap this task found)",
              (deep["ruler"] or {}).get("structure", 0) >= 1, json.dumps(deep["ruler"]))
        check("which pane had the focus came back", deep["focusedPane"] == 0, str(deep["focusedPane"]))

        shot = screenshot(page, "task7-restored-session.png")
        page.locator(".npp-tabstrip").first.screenshot(path=str(SHOT_DIR / "task7-restored-tabs.png"))
        try:
            text = ocr(SHOT_DIR / "task7-restored-tabs.png")
            check("OCR of the restored tab strip finds the file name",
                  "codejs" in alnum(text) and "notetxt" in alnum(text),
                  " ".join(text.split())[:70])
        except Exception as error:
            check("OCR of the restored tab strip finds the file name", False, str(error))

        # The other half of N++'s rule: a file that is already open is activated, not opened twice.
        documents_before = info(page)["documents"]
        stub_pickers(page, "code.js")
        click_or_alert(page, "button[data-tool='open']")
        page.wait_for_timeout(500)
        check("opening an already-open file activates it rather than duplicating it (NppIO.cpp:316)",
              info(page)["documents"] == documents_before, str(info(page)["documents"]))

        # ══ 8. a file that cannot be reached: dropped, or a placeholder ═══════
        remove_file(page, "code.js")
        dropped = reload_and_wait(page)
        check("with KeepSessionAbsentFileEntries off the entry is dropped",
              dropped["session"]["dropped"] >= 1 and "code.js" not in dropped["tabs"],
              json.dumps({"dropped": dropped["session"]["dropped"], "tabs": dropped["tabs"]}))
        check("no placeholder was made for it", dropped["session"]["placeholders"] == 0
              and dropped["inaccessible"] is False)

        # And with the preference on, N++ asks once and opens read-only placeholders.
        set_preferences(page, {"keepSessionAbsentFileEntries": True})
        seeded_file(page, "gone.txt", b"here for now\n")
        opened_gone, why_not = open_via_picker(page, "gone.txt")
        check("gone.txt opened", opened_gone, why_not)
        remove_file(page, "gone.txt")
        page.reload(wait_until="load")
        page.wait_for_selector("[data-dialog='confirm']", timeout=10000)
        ask = page.locator("[data-dialog='confirm'] .npp-dialog-body").text_content() or ""
        check("the inaccessible-files question is asked, in N++'s own words",
              "Some files from your past session are inaccessible" in ask
              and "read-only documents as placeholders" in ask, " ".join(ask.split())[:80])
        page.click("[data-dialog='confirm'] [data-dialog-action='confirm']")  # Yes
        page.wait_for_timeout(400)
        holder = wait_ready(page)
        check("a placeholder was opened for the missing file",
              holder["session"]["placeholders"] == 1 and "gone.txt" in holder["tabs"],
              json.dumps({"placeholders": holder["session"]["placeholders"], "tabs": holder["tabs"]}))
        check("the placeholder is empty, read-only and marked inaccessible",
              (holder["text"] or "") == "" and holder["readOnly"] is True and holder["inaccessible"] is True,
              json.dumps({k: holder[k] for k in ("readOnly", "inaccessible")}))

        # A read-only document must actually refuse typing, or "read-only" is a claim with nothing
        # behind it: press keys and compare the document afterwards.
        page.click(".npp-pane .cm-content")
        page.keyboard.type("this must not land")
        page.wait_for_timeout(200)
        check("typing into the placeholder changes nothing", (info(page)["text"] or "") == "",
              repr((info(page)["text"] or "")[:24]))

        # ══ 9. unsaved work that cannot be restored is reported, never silent ══
        set_preferences(page, {"snapshotMode": False, "keepSessionAbsentFileEntries": False})
        seeded_file(page, "plain.txt", b"plain\n")
        opened_plain, why_not = open_via_picker(page, "plain.txt")
        check("plain.txt opened", opened_plain, why_not)
        page.click(".npp-pane .cm-content")
        page.keyboard.press("Control+End")
        page.keyboard.type("UNSAVED-TYPING")
        page.evaluate("() => window.__workspace.flushSession()")
        page.wait_for_timeout(200)
        check("with snapshot mode off, no backup was written",
              info(page)["backupPath"] is None and all("plain.txt" not in path for path in debug_backups(page)),
              str(debug_backups(page)))
        page.reload(wait_until="load")
        page.wait_for_selector("[data-dialog='alert']", timeout=10000)
        lost = alert_text(page) or ""
        check("the lost work is reported, by name", "unsaved changes" in lost.lower() and "plain.txt" in lost,
              " ".join(lost.split())[:90])
        dismiss_alert(page)
        page.wait_for_timeout(300)
        after_lost = wait_ready(page)
        check("the restore counted it", after_lost["session"]["unsavedLost"] >= 1, json.dumps(after_lost["session"]))
        check("the file came back from disk, without the edits it never had",
              "UNSAVED-TYPING" not in (after_lost["text"] or "") and after_lost["dirty"] is False,
              repr((after_lost["text"] or "")[:24]))

        # ══ 10. the promises that survive every task ══════════════════════════
        set_preferences(page, {"snapshotMode": True})
        final = info(page)
        check("the status bar still reports the caret", "Ln " in status_text(page), status_text(page).strip()[:60])
        check("preferences are back to N++'s snapshot default", final["preferences"]["snapshotMode"] is True)
        check("no console errors", len(console_errors) == 0, "; ".join(console_errors[:3]))
        offsite = [
            url for url in requests
            if not url.startswith(("http://127.0.0.1", "http://localhost", "ws://127.0.0.1", "ws://localhost", "data:"))
        ]
        check("no request left the machine (D1 backend-free)", len(offsite) == 0, ", ".join(offsite[:3]))

        browser.close()

    failed = [name for name, ok, _ in results if not ok]
    print(f"\n{'=' * 60}")
    print(f"VERIFY-TASK7: {'PASS' if not failed else 'FAIL'}  ({len(results) - len(failed)}/{len(results)} checks)")
    if failed:
        print("failed: " + "; ".join(failed))
    print("=" * 60)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
