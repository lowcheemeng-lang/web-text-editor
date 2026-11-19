"""Task 11 acceptance check — UTF-32 and the DOS codepages, in real Chrome.

    npm run dev                       # in another shell
    python3 scripts/verify-task11.py  # exit 0 = Task 11 accepted

The pickers are stubbed to OPFS handles exactly as `verify-task4.py` does: the OS
dialog cannot be driven by Playwright, but every byte of decoding, BOM handling,
encoding and `createWritable()` after the handle is real. The byte-level matrix
lives in `scripts/test-file-io.mjs`; this script is the through-the-app half —
status bar, save refusal, and a file that survives a round trip unedited.
"""
from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:5173/"
SHOT_DIR = Path(__file__).resolve().parent.parent / ".hermes" / "cache" / "screenshots"
SHOT = SHOT_DIR / "task11-encodings.png"

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))


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


def seed(page, name: str, data: bytes) -> None:
    page.evaluate(SEED, [name, list(data)])


def read_back(page, name: str) -> bytes:
    return bytes(page.evaluate(READ, name))


def stub_pickers(page, open_name: str, save_name: str) -> None:
    page.evaluate(STUB_PICKERS, [open_name, save_name])


def info(page) -> dict:
    return page.evaluate("() => window.__workspace.inspect()")


def choose_encoding(page, item_id: str) -> None:
    page.mouse.move(6, 6)
    page.wait_for_timeout(60)
    page.hover(".npp-menu-title:has-text('Encoding')")
    page.wait_for_selector(".npp-menu-popup:not([hidden])", timeout=5000)
    page.click(f'[data-menu-item="{item_id}"]')
    page.wait_for_timeout(400)


def open_file(page, name: str, data: bytes) -> None:
    seed(page, name, data)
    stub_pickers(page, name, name)
    page.click("button[data-tool='open']")
    page.wait_for_timeout(500)


SHOT_DIR.mkdir(parents=True, exist_ok=True)


with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True)
    page = browser.new_page(viewport={"width": 1200, "height": 800})
    errors: list[str] = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="load")
    page.wait_for_selector(".npp-app", timeout=10000)

    check("boots", info(page)["fileSystemAccess"] is True)

    # ── 0. the menu that names an encoding ───────────────────────────────────
    page.hover(".npp-menu-title:has-text('Encoding')")
    page.wait_for_selector(".npp-menu-popup:not([hidden])", timeout=5000)
    scratch_items = page.eval_on_selector_all(
        ".npp-menu-popup:not([hidden]) [data-menu-item]",
        "els => els.map((el) => el.textContent)",
    )
    check("an Encoding menu exists", page.locator(".npp-menu-title:has-text('Encoding')").count() == 1)
    check("on a scratch buffer it says no file is open",
          any("no file open" in (label or "") for label in scratch_items), ", ".join(scratch_items))
    page.keyboard.press("Escape")

    # ── 1. UTF-32LE: open, name it, save it back ─────────────────────────────
    utf32le = b"\xff\xfe\x00\x00" + "Aé😀\nsecond line\n".encode("utf-32-le")
    open_file(page, "utf32le.txt", utf32le)
    opened = info(page)
    check("UTF-32LE: opens", opened["activeFileName"] == "utf32le.txt", str(opened["activeFileName"]))
    check("UTF-32LE: text is the code points, astral character included",
          opened["text"] == "Aé😀\nsecond line\n", repr(opened["text"]))
    check("UTF-32LE: encoding recorded", opened["encoding"] == "utf-32le", str(opened["encoding"]))
    check("UTF-32LE: reported as encodable", opened["canEncode"] is True)
    status = page.locator(".npp-statusbar").text_content() or ""
    check("UTF-32LE: the status bar names the encoding", "utf-32le" in status, status.strip())
    check("UTF-32LE: line endings detected", opened["eol"] == "LF", str(opened["eol"]))
    page.click("button[data-tool='save']")
    page.wait_for_timeout(300)
    check("UTF-32LE: byte-identical round trip", read_back(page, "utf32le.txt") == utf32le,
          repr(read_back(page, "utf32le.txt")[:16]))

    # ── 2. UTF-32BE ──────────────────────────────────────────────────────────
    utf32be = b"\x00\x00\xfe\xff" + "Ω😀\r\n".encode("utf-32-be")
    open_file(page, "utf32be.txt", utf32be)
    be = info(page)
    check("UTF-32BE: opens", be["activeFileName"] == "utf32be.txt", str(be["activeFileName"]))
    check("UTF-32BE: text decoded", be["text"] == "Ω😀\n", repr(be["text"]))
    check("UTF-32BE: encoding recorded", be["encoding"] == "utf-32be", str(be["encoding"]))
    check("UTF-32BE: CRLF detected", be["eol"] == "CRLF", str(be["eol"]))
    page.click("button[data-tool='save']")
    page.wait_for_timeout(300)
    check("UTF-32BE: byte-identical round trip", read_back(page, "utf32be.txt") == utf32be,
          repr(read_back(page, "utf32be.txt")[:16]))

    # ── 3. CP437: box drawing and accents, painted and saved back ────────────
    cp437 = bytes([0xc4, 0xc4, 0xda, 0xbf, 0x0d, 0x0a, 0x82, 0x91, 0x81, 0x0d, 0x0a])
    open_file(page, "cp437.txt", cp437)
    # No BOM and not UTF-8: D4 opens it as windows-1252, assumed, and says so. That is
    # exactly why the Encoding menu has to exist — nothing in the bytes names CP437.
    page.click("[data-dialog-action='ok']")
    page.wait_for_timeout(150)
    assumed = info(page)
    check("cp437: without a hint it opens as windows-1252, assumed",
          assumed["encoding"] == "windows-1252" and assumed["assumedEncoding"] is True,
          f"{assumed['encoding']} assumed={assumed['assumedEncoding']}")

    choose_encoding(page, "enc-cp437")
    dos = info(page)
    check("cp437: opens", dos["activeFileName"] == "cp437.txt", str(dos["activeFileName"]))
    check("cp437: decode is the table's, not mojibake", dos["text"] == "──┌┐\néæü\n", repr(dos["text"]))
    check("cp437: encoding recorded", dos["encoding"] == "cp437", str(dos["encoding"]))
    check("cp437: reported as encodable", dos["canEncode"] is True)
    status = page.locator(".npp-statusbar").text_content() or ""
    check("cp437: the status bar names the encoding", "cp437" in status, status.strip())
    check("cp437: the box-drawing characters are in the rendered document",
          "──┌┐" in (page.locator(".cm-content").inner_text() or ""),
          repr((page.locator(".cm-content").inner_text() or "")[:12]))
    check("cp437: CRLF detected", dos["eol"] == "CRLF", str(dos["eol"]))
    page.click("button[data-tool='save']")
    page.wait_for_timeout(300)
    check("cp437: byte-identical round trip", read_back(page, "cp437.txt") == cp437,
          repr(read_back(page, "cp437.txt")[:12]))

    # ── 4. a character CP437 cannot hold is refused, not mangled ─────────────
    page.click(".npp-pane[data-pane='primary'] .cm-content", position={"x": 2, "y": 8})
    page.keyboard.press("Control+End")
    page.keyboard.type("你")
    page.wait_for_timeout(150)
    before = read_back(page, "cp437.txt")
    page.click("button[data-tool='save']")
    page.wait_for_selector("[data-dialog='alert']", timeout=5000)
    title = page.locator(".npp-dialog-title").text_content() or ""
    body = page.locator(".npp-dialog-body").text_content() or ""
    check("cp437: saving a character the page cannot hold is refused",
          "cp437" in title.lower() or "cannot" in title.lower(), title.strip())
    check("cp437: the refusal names the character", "你" in body, body[:80])
    page.click("[data-dialog-action='ok']")
    page.wait_for_timeout(200)
    check("cp437: nothing was written by the refused save", read_back(page, "cp437.txt") == before)
    page.keyboard.press("Control+z")
    page.wait_for_timeout(200)

    # ── 5. the UTF-8 fallback still round-trips (no regression) ──────────────
    utf8 = b"\xef\xbb\xbfcaf\xc3\xa9\r\n"
    open_file(page, "utf8.txt", utf8)
    plain = info(page)
    check("UTF-8+BOM: still opens", plain["text"] == "café\n", repr(plain["text"]))
    page.click("button[data-tool='save']")
    page.wait_for_timeout(300)
    check("UTF-8+BOM: still byte-identical", read_back(page, "utf8.txt") == utf8)

    page.screenshot(path=str(SHOT))
    check("no console or page errors", not errors, "; ".join(errors[:3]))
    browser.close()

failed = [name for name, ok, _ in results if not ok]
print(f"\n{'=' * 60}")
print(f"VERIFY-TASK11: {'PASS' if not failed else 'FAIL'}  ({len(results) - len(failed)}/{len(results)} checks)")
if failed:
    print("failed: " + "; ".join(failed))
print(f"screenshot: {SHOT}")
sys.exit(1 if failed else 0)
