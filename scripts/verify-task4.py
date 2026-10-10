"""Task 4 acceptance check — file operations with no backend, in real Chrome.

    npm run dev                        # in another shell
    python3 scripts/verify-task4.py    # exit 0 = Task 4 accepted

Why the pickers are stubbed: `showOpenFilePicker` / `showSaveFilePicker` open
OS-level dialogs that live outside the page, and neither Playwright nor CDP can
drive them. So this script replaces the two functions *in the page* with ones
that return handles from the Origin Private File System. OPFS yields genuine
`FileSystemFileHandle` objects, so decoding, BOM handling, encoding, line-ending
conversion and `createWritable()` all run for real — only the dialog is faked.

What that still cannot prove is the picker itself (that the OS dialog opens, that
Cancel behaves). That stays a manual checklist, recorded in PROGRESS.md as manual
evidence; this script does not claim it.
"""
from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:5173/"
SHOT_DIR = Path(__file__).resolve().parent.parent / ".hermes" / "cache" / "screenshots"
SHOT = SHOT_DIR / "task4-file-io.png"

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

STUB_PICKERS = """async ([openName, saveName]) => {
    const root = await navigator.storage.getDirectory();
    window.showOpenFilePicker = async () => [await root.getFileHandle(openName)];
    window.showSaveFilePicker = async () => await root.getFileHandle(saveName, { create: true });
}"""

STUB_CANCEL = """() => {
    window.showOpenFilePicker = async () => {
        throw new DOMException("The user aborted a request.", "AbortError");
    };
    window.showSaveFilePicker = async () => {
        throw new DOMException("The user aborted a request.", "AbortError");
    };
}"""


def seed(page, name: str, data: bytes) -> None:
    page.evaluate(SEED, [name, list(data)])


def read_back(page, name: str) -> bytes:
    return bytes(page.evaluate(READ, name))


def stub_pickers(page, open_name: str, save_name: str) -> None:
    page.evaluate(STUB_PICKERS, [open_name, save_name])


def info(page) -> dict:
    return page.evaluate("() => window.__workspace.inspect()")


UTF8_BOM = b"\xef\xbb\xbf"

SHOT_DIR.mkdir(parents=True, exist_ok=True)


with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True)

    # ══ Part 1: the supported path ═══════════════════════════════════════════
    page = browser.new_page()
    console_errors: list[str] = []
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: console_errors.append(str(e)))
    page.goto(URL, wait_until="load")
    page.wait_for_selector(".npp-app", timeout=10000)

    baseline = info(page)["documents"]
    check("boots with the capability reported", info(page)["fileSystemAccess"] is True)
    check("no unsupported notice when the API exists", page.locator("[data-notice='unsupported']").count() == 0)

    # ── the menu bar Task 3 deferred to this task ───────────────────────────
    check("menu bar exists", page.locator(".npp-menubar").count() == 1)
    check("File and View menus", info(page)["menuTitles"] == ["File", "View"], str(info(page)["menuTitles"]))
    page.click(".npp-menu-title >> nth=0")
    check("File menu opens", page.locator("[data-menu-item='save-as']").is_visible())
    check("File menu offers Open", page.locator("[data-menu-item='open']").count() == 1)
    page.keyboard.press("Escape")
    page.wait_for_timeout(50)
    check("Escape closes the menu", not page.locator("[data-menu-item='save-as']").is_visible())

    # ── byte-identical round trip: CRLF + BOM, nothing edited ───────────────
    crlf_bom = UTF8_BOM + b"line one\r\nline two\r\nline three\r\n"
    seed(page, "crlf-bom.txt", crlf_bom)
    stub_pickers(page, "crlf-bom.txt", "crlf-bom.txt")
    page.click("button[data-tool='open']")
    page.wait_for_function(
        "() => window.__workspace.inspect().documents > 1", timeout=10000
    )

    opened = info(page)
    check("open: tab is named after the file", opened["activeFileName"] == "crlf-bom.txt", str(opened["activeName"]))
    check("open: BOM is not part of the text", opened["text"].startswith("line one"), repr(opened["text"][:12]))
    check("open: CRLF detected", opened["eol"] == "CRLF", str(opened["eol"]))
    check("open: encoding recorded as utf-8", opened["encoding"] == "utf-8", str(opened["encoding"]))
    check("open: not marked assumed", opened["assumedEncoding"] is False)
    status = page.locator(".npp-statusbar").text_content() or ""
    check("status bar shows the encoding", "utf-8" in status, status.strip())
    check("status bar shows the line ending", "CRLF" in status, status.strip())

    page.click("button[data-tool='save']")
    page.wait_for_timeout(300)
    after = read_back(page, "crlf-bom.txt")
    check(
        "save with no edit is byte-identical (BOM + CRLF preserved)",
        after == crlf_bom,
        f"{len(after)}B vs {len(crlf_bom)}B",
    )
    check("save clears the dirty flag", info(page)["dirty"] is False)

    # ── edit, save, and confirm the bytes followed ──────────────────────────
    page.click(".npp-pane[data-pane='primary'] .cm-content", position={"x": 2, "y": 8})
    page.keyboard.press("Control+End")
    page.keyboard.type("four")
    check("typing marks it dirty again", info(page)["dirty"] is True)
    page.click("button[data-tool='save']")
    page.wait_for_timeout(300)
    edited = read_back(page, "crlf-bom.txt")
    # Control+End puts the caret after the final newline, so the appended text
    # correctly sits on a new last line with no trailing CRLF after it.
    check("edit: the new text reached disk", edited.endswith(b"line three\r\nfour"), repr(edited[-18:]))
    check("edit: BOM survived the edit", edited.startswith(UTF8_BOM))
    check("edit: CRLF survived the edit", b"line two\r\n" in edited)

    # ── windows-1252 fidelity (the §6 round-trip rule) ──────────────────────
    win1252 = b"caf\xe9 \x97 na\xefve\r\n"  # é, em dash, ï in windows-1252
    seed(page, "latin.txt", win1252)
    stub_pickers(page, "latin.txt", "latin.txt")
    page.click("button[data-tool='open']")
    page.wait_for_timeout(400)
    page.click("[data-dialog-action='ok']")  # the assumed-encoding warning
    page.wait_for_timeout(100)

    latin = info(page)
    check("windows-1252: opened", latin["activeFileName"] == "latin.txt", str(latin["activeFileName"]))
    check("windows-1252: decoded, not mojibake", "café" in (latin["text"] or ""), repr(latin["text"]))
    check("windows-1252: flagged as assumed (D4 — no silent guessing)", latin["assumedEncoding"] is True)
    page.click("button[data-tool='save']")
    page.wait_for_timeout(300)
    check("windows-1252: byte-identical round trip", read_back(page, "latin.txt") == win1252,
          repr(read_back(page, "latin.txt")[:12]))

    # ── UTF-32 is refused, not mojibaked (D4) ───────────────────────────────
    seed(page, "utf32.txt", b"\xff\xfe\x00\x00A\x00\x00\x00")
    stub_pickers(page, "utf32.txt", "utf32.txt")
    before_count = info(page)["documents"]
    page.click("button[data-tool='open']")
    page.wait_for_selector("[data-dialog='alert']", timeout=5000)
    body = page.locator(".npp-dialog-body").text_content() or ""
    check("UTF-32: refused with an explanation", "UTF-32" in body, body[:60])
    page.click("[data-dialog-action='ok']")
    page.wait_for_timeout(100)
    check("UTF-32: nothing was opened", info(page)["documents"] == before_count)

    # ── a dismissed picker is a cancel, not an error ────────────────────────
    page.evaluate(STUB_CANCEL)
    before_count = info(page)["documents"]
    page.click("button[data-tool='open']")
    page.wait_for_timeout(400)
    check("cancel: no error dialog", page.locator("[data-dialog='alert']").count() == 0)
    check("cancel: no document opened", info(page)["documents"] == before_count)

    # ── Save As reaches the save picker and writes where told ───────────────
    stub_pickers(page, "latin.txt", "copy-as.txt")
    page.click(".npp-menu-title >> nth=0")
    page.click("[data-menu-item='save-as']")
    page.wait_for_timeout(400)
    check("Save As writes to the destination the picker returned",
          read_back(page, "copy-as.txt") == win1252, repr(read_back(page, "copy-as.txt")[:12]))
    check("Save As retargets the document at the new file",
          info(page)["activeFileName"] == "copy-as.txt", str(info(page)["activeFileName"]))
    check("no page errors so far", len(console_errors) == 0, "; ".join(console_errors[:2]))

    # Visual evidence: a file-backed document with the File menu open.
    page.click(".npp-menu-title >> nth=0")
    page.screenshot(path=str(SHOT))
    page.keyboard.press("Escape")
    page.wait_for_timeout(50)

    # ══ Part 2: an unsupported browser must fail loudly (S4) ════════════════
    # The pickers must be gone *before* the app script runs, so this uses an init
    # script rather than a post-load stub.
    bare = browser.new_page()
    bare.add_init_script(
        "delete window.showOpenFilePicker; delete window.showSaveFilePicker;"
    )
    bare.goto(URL, wait_until="load")
    bare.wait_for_selector(".npp-app", timeout=10000)

    check("unsupported: capability reported false", bare.evaluate("() => window.__workspace.inspect().fileSystemAccess") is False)
    notice = bare.locator("[data-notice='unsupported']")
    check("unsupported: a notice is shown", notice.count() == 1)
    check("unsupported: the notice says nothing can be saved",
          "nothing can be saved" in (notice.text_content() or "").lower(),
          (notice.text_content() or "")[:70])
    check("unsupported: the editor still mounts", bare.locator(".cm-editor").count() == 1)

    bare.click("button[data-tool='open']")
    bare.wait_for_selector("[data-dialog='alert']", timeout=5000)
    check("unsupported: Open explains itself instead of throwing",
          bare.locator("[data-dialog='alert']").count() == 1)
    bare.click("[data-dialog-action='ok']")

    bare_dirty_text = bare.evaluate("() => window.__workspace.inspect().text") or ""
    bare.click(".npp-pane[data-pane='primary'] .cm-content")
    bare.keyboard.type("x")
    bare.locator(".npp-tab.is-active .npp-tab-close").click()
    bare.wait_for_selector("[data-dialog='save-changes']", timeout=3000)
    check("unsupported: the close prompt offers no Save it cannot perform",
          bare.locator("[data-dialog-action='save']").count() == 0)
    check("unsupported: Don't Save and Cancel are still offered",
          bare.locator("[data-dialog-action='discard']").count() == 1
          and bare.locator("[data-dialog-action='cancel']").count() == 1)
    bare.click("[data-dialog-action='cancel']")

    browser.close()

failed = [name for name, ok, _ in results if not ok]
print(f"\n{'=' * 60}")
print(f"VERIFY-TASK4: {'PASS' if not failed else 'FAIL'}  ({len(results) - len(failed)}/{len(results)} checks)")
if failed:
    print("failed: " + "; ".join(failed))
print("=" * 60)
sys.exit(1 if failed else 0)
