#!/usr/bin/env python3
"""Task 9 acceptance check — N++'s Language menu, and the selection that N++ paints over its
current-line band.

    npm run dev                        # in another shell
    python3 scripts/verify-task9.py    # exit 0 = Task 9 accepted

S2: every claim `PROGRESS.md` makes about Task 9 is backed by this script. It drives the app
the way a person does — the menu bar, the menu's own items, keystrokes — and fails loudly on
console errors, page errors, or a request that leaves the machine.

Two things are under test here, and the second is the user's own report:

1. **The Language menu** (the one N++ feature Task 6 knowingly left unbuilt). The registry has
   ordered the 140 languages since Task 6, `Workspace.setLanguage()` has swapped a grammar
   live since then too, and Task 7 stores the language per document; what was missing was the
   menu. Checked here: its place in the menu bar (Notepad_plus.rc:998), "None (Normal Text)"
   first (rc:1000), the 140 entries in name order, N++'s radio check on the current one
   (`CheckMenuRadioItem`, Notepad_plus.cpp:2965), a choice applying live and painting in N++'s
   colours, `None` clearing it, a legacy mode loading, the checked state following the active
   document, a choice surviving a real reload (Task 7's session), and a choice *overriding* a
   detected language on a real file opened through the stubbed picker.

2. **The reported bug: a selected word on the current row was invisible.** Two causes, both
   measured here:
     - the theme's selection rule had three class selectors against CodeMirror's own
       `&light.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground`
       (five), so its colour lost silently and the selection stayed CM6's #d7d4f0 — visually
       the same pale lavender as N++'s #e8e8ff current-line band;
     - even with the right colour, CM6's selection layer sits at z-index -2, *behind* the
       content, so the opaque band on `.cm-line` painted over the selection completely. The
       pixels said so: on the current row every sample was #e8e8ff.
   The theme now puts the band on `.cm-activeLine::before` at z-index -3, which restores
   Scintilla's own order (band, then selection, then text). The checks sample real pixels.
"""
from __future__ import annotations

import sys

from PIL import Image
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:5173/"
SHOT_MENU = "/home/lowcheemeng/.hermes/cache/screenshots/task9-language-menu.png"
SHOT_SELECTION = "/home/lowcheemeng/.hermes/cache/screenshots/task9-selection.png"

# N++'s colours, from `NPP_COLORS` — the values the checks expect to see, not the values the
# theme happens to hold.
BAND = (232, 232, 255)  # activeLine #e8e8ff
SELECTION = (192, 192, 192)  # selection #c0c0c0
KEYWORD = "rgb(0, 0, 255)"  # C lexer KEYWORD style, bold

results: list[tuple[str, bool, str]] = []
console_errors: list[str] = []
page_errors: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))


# ── page-side helpers ────────────────────────────────────────────────────────

SEED = """async ([name, data]) => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(name, { create: true });
    const stream = await handle.createWritable();
    await stream.write(new Uint8Array(data));
    await stream.close();
}"""

ADOPT = """async (name) => {
    const root = await navigator.storage.getDirectory();
    window.showOpenFilePicker = async () => [await root.getFileHandle(name)];
}"""

MENU = """() => {
    const popup = document.querySelector('.npp-menu-popup:not([hidden])');
    if (!popup) return null;
    return {
        items: [...popup.querySelectorAll('[data-menu-item]')].map((node) => ({
            id: node.getAttribute('data-menu-item'),
            label: node.querySelector('.npp-menu-label')?.textContent ?? '',
            role: node.getAttribute('role'),
            checked: node.getAttribute('aria-checked'),
        })),
        rules: popup.querySelectorAll('.npp-menu-rule').length,
        firstChildIsRule: popup.firstElementChild?.classList.contains('npp-menu-rule') ?? false,
        scrollHeight: popup.scrollHeight,
        clientHeight: popup.clientHeight,
        bottom: Math.round(popup.getBoundingClientRect().bottom),
        viewport: window.innerHeight,
    };
}"""

TOKENS = """() => [...document.querySelectorAll('.cm-content .cm-line span')].map((span) => ({
    text: span.textContent,
    color: getComputedStyle(span).color,
    weight: getComputedStyle(span).fontWeight,
}))"""

RECTS = """() => {
    const line = document.querySelector('.cm-activeLine');
    const selection = document.querySelector('.cm-selectionBackground');
    const box = (el) => { const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    return { line: box(line), selection: selection ? box(selection) : null };
}"""


def press_open(page) -> None:
    page.evaluate("() => window.__workspace.activeView?.focus()")
    page.keyboard.press("Alt+o")
    page.wait_for_timeout(300)


def dismiss_alert(page) -> str:
    if page.locator(".npp-alert, dialog[open]").count() > 0:
        text = page.locator(".npp-alert, dialog[open]").first.text_content() or ""
        page.keyboard.press("Enter")
        page.wait_for_timeout(150)
        return text
    return ""


with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True)
    page = browser.new_page(viewport={"width": 1100, "height": 760})

    requests: list[str] = []
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: page_errors.append(str(e)))
    page.on("request", lambda r: requests.append(r.url))

    page.goto(URL, wait_until="load")
    page.wait_for_selector(".npp-app", timeout=10000)

    info = lambda: page.evaluate("() => window.__workspace.inspect()")
    tokens = lambda: page.evaluate(TOKENS)
    status = lambda: page.evaluate(
        "() => [...document.querySelectorAll('.npp-status-item')].map((n) => n.textContent)"
    )

    def open_menu() -> dict:
        page.click(".npp-menu-title:has-text('Language')")
        page.wait_for_timeout(120)
        menu = page.evaluate(MENU)
        if menu is None:
            raise AssertionError("the Language menu did not open")
        return menu

    def choose(item_id: str) -> None:
        open_menu()
        page.click(f"[data-menu-item='{item_id}']")
        page.wait_for_function(
            "() => !document.querySelector('.npp-menu-popup:not([hidden])')", timeout=5000
        )
        page.wait_for_timeout(500)  # the lazy grammar import resolves here

    def token_of(word: str) -> dict | None:
        return next((token for token in tokens() if token["text"] == word), None)

    # ── 1. the menu exists, where N++ puts it, with N++'s shape ───────────────
    page.click(".cm-content")
    page.keyboard.press("Control+a")
    page.keyboard.type("def greet():\n    const = 1\n")
    page.keyboard.press("Control+Home")

    menu_titles = info()["menuTitles"]
    check(
        "the menu bar carries Language between View and Settings (Notepad_plus.rc:998)",
        menu_titles == ["File", "Search", "View", "Language", "Settings"],
        str(menu_titles),
    )

    menu = open_menu()
    page.screenshot(path=SHOT_MENU)
    check(
        "Language opens with 141 entries — 'None (Normal Text)' plus all 140 languages",
        len(menu["items"]) == 141,
        f"{len(menu['items'])} entries",
    )
    check(
        "the first entry is N++'s 'None (Normal Text)' (Notepad_plus.rc:1000)",
        menu["items"][0]["label"] == "None (Normal Text)",
        repr(menu["items"][0]["label"]),
    )
    check(
        "…and it is the one checked on a scratch buffer",
        menu["items"][0]["checked"] == "true"
        and [item["label"] for item in menu["items"] if item["checked"] == "true"] == ["None (Normal Text)"],
        str([item["label"] for item in menu["items"] if item["checked"] == "true"]),
    )
    check(
        "a rule separates 'None' from the languages (one rule, after the first entry)",
        menu["rules"] == 1,
        f"{menu['rules']} rules",
    )
    labels = [item["label"] for item in menu["items"]]
    check(
        "the 140 languages are ordered by N++'s short name, case-insensitively",
        labels[1:] == sorted(labels[1:], key=str.casefold),
        "first mismatch: "
        + str(next((pair for pair in zip(labels[1:], sorted(labels[1:], key=str.casefold)) if pair[0] != pair[1]), None)),
    )
    check(
        "every entry is a radio item (N++ draws a check, not a tick), with exactly one checked",
        all(item["role"] == "menuitemradio" for item in menu["items"])
        and len([item for item in menu["items"] if item["checked"] == "true"]) == 1,
        f"roles={sorted({item['role'] for item in menu['items']})}",
    )
    check(
        "the long menu is capped and scrolls inside the window instead of running off it",
        menu["scrollHeight"] > menu["clientHeight"] and menu["bottom"] <= menu["viewport"] and menu["clientHeight"] <= int(menu["viewport"] * 0.7) + 4,
        f"{menu['scrollHeight']}px of items in a {menu['clientHeight']}px box, bottom {menu['bottom']} of {menu['viewport']}",
    )

    # Escape closes with nothing changed.
    page.keyboard.press("Escape")
    page.wait_for_timeout(120)
    closed = page.evaluate("() => document.querySelector('.npp-menu-popup:not([hidden])') === null")
    check(
        "Escape closes the menu and leaves the language alone",
        closed and info()["language"] is None,
        f"closed={closed}, language={info()['language']}",
    )

    # ── 2. choosing a language applies it, live, in N++'s colours ─────────────
    choose("lang-python")
    language = info()["language"] or {}
    check(
        "Language ▸ Python sets the open document's language",
        language.get("id") == "python" and language.get("name") == "Python" and language.get("loaded") is True,
        str(language),
    )
    check(
        "…and the status bar names N++'s long name in its leftmost field (STATUSBAR_DOC_TYPE)",
        status()[0] == "Python file",
        repr(status()[:3]),
    )
    keyword = token_of("def")
    check(
        "…and the grammar paints: `def` is N++'s keyword blue, bold",
        keyword is not None and keyword["color"] == KEYWORD and keyword["weight"] == "700",
        str(keyword),
    )
    check(
        "…and a Python non-keyword stays black (`const`)",
        (token_of("const") or {"color": "rgb(0, 0, 0)"})["color"] == "rgb(0, 0, 0)",
        str(token_of("const")),
    )

    menu = open_menu()
    checked = [item["label"] for item in menu["items"] if item["checked"] == "true"]
    check(
        "reopening the menu shows the radio check on Python, and only on Python",
        checked == ["Python"],
        str(checked),
    )
    page.keyboard.press("Escape")
    page.wait_for_timeout(80)

    # ── 3. switching replaces the old grammar rather than stacking a second ───
    choose("lang-javascript")
    const_token = token_of("const")
    check(
        "Language ▸ JavaScript replaces Python's grammar: `const` is now the keyword",
        info()["language"]["id"] == "javascript"
        and const_token is not None
        and const_token["color"] == KEYWORD
        and const_token["weight"] == "700",
        str(const_token),
    )
    check(
        "…and `def` is no longer a keyword, so the old grammar was dropped",
        (token_of("def") or {"color": "rgb(0, 0, 0)"})["color"] == "rgb(0, 0, 0)",
        str(token_of("def")),
    )

    # ── 4. "None (Normal Text)" is a real language choice, not a no-op ────────
    choose("lang-none")
    check(
        "Language ▸ None (Normal Text) clears the language and the status bar",
        info()["language"] is None and status()[0] == "Normal text file",
        f"language={info()['language']}, status={status()[:1]}",
    )
    check(
        "…and the highlighting is gone (`def` is no longer a token at all)",
        token_of("def") is None,
        str(tokens()),
    )

    # ── 5. the long tail: a legacy stream mode loads through the same menu ────
    choose("lang-brainfuck")
    language = info()["language"] or {}
    check(
        "a legacy language (Brainfuck) loads through the menu too",
        language.get("id") == "brainfuck" and language.get("firstClass") is False and language.get("loaded") is True,
        str(language),
    )
    check(
        "…and it reports no fold structure, as D9's legacy contract says",
        (info()["ruler"] or {}).get("structure") == 0,
        str(info()["ruler"]),
    )

    # ── 6. the check follows the active document ──────────────────────────────
    page.keyboard.press("Control+Home")
    choose("lang-python")
    page.keyboard.press("Alt+n")  # a second document, which has no language
    page.wait_for_timeout(250)
    menu = open_menu()
    checked = [item["label"] for item in menu["items"] if item["checked"] == "true"]
    check(
        "the radio check follows the active document (a new buffer checks 'None')",
        checked == ["None (Normal Text)"],
        str(checked),
    )
    page.keyboard.press("Escape")
    page.wait_for_timeout(80)

    # ── 7. a chosen language survives a real reload (Task 7's session) ────────
    page.click(".npp-tab:not(.is-active)")
    page.wait_for_timeout(200)
    check(
        "…while the first document keeps its choice",
        (info()["language"] or {}).get("id") == "python",
        str(info()["language"]),
    )
    page.wait_for_timeout(1100)  # the 500 ms session debounce, plus the write itself
    page.reload(wait_until="load")
    page.wait_for_selector(".npp-app", timeout=10000)
    page.wait_for_function(
        "() => window.__workspace.inspect().session.complete === true", timeout=10000
    )
    page.wait_for_timeout(400)
    restored = info()["language"] or {}
    check(
        "a language chosen from the menu survives a real reload",
        restored.get("id") == "python" and restored.get("loaded") is True,
        str(restored),
    )
    check(
        "…and the restored document is painted again",
        (token_of("def") or {}).get("color") == KEYWORD,
        str(token_of("def")),
    )

    # ── 8. a menu choice overrides a detected language on a real file ────────
    page.evaluate(SEED, ["notes.txt", list(b"def greet(name):\n    return name\n")])
    page.evaluate(ADOPT, "notes.txt")
    press_open(page)
    dismiss_alert(page)
    check(
        "a .txt file opens as Normal text through the real File ▸ Open path",
        info()["activeFileName"] == "notes.txt" and info()["language"] is None,
        f"{info()['activeFileName']}, language={info()['language']}",
    )
    choose("lang-python")
    check(
        "…and Language ▸ Python overrides the extension's decision",
        (info()["language"] or {}).get("id") == "python"
        and (token_of("def") or {}).get("color") == KEYWORD,
        str(info()["language"]),
    )

    # ── 9. the reported bug: a selected word on the current row is visible ───
    page.evaluate("() => window.__workspace.activeView?.focus()")
    page.keyboard.press("Control+Home")
    page.keyboard.press("Shift+End")
    page.wait_for_timeout(200)
    rects = page.evaluate(RECTS)
    page.screenshot(path=SHOT_SELECTION)
    image = Image.open(SHOT_SELECTION).convert("RGB")

    selection_rect = rects["selection"]
    line_rect = rects["line"]

    def pixel(image: Image.Image, x: int, y: int) -> tuple[int, int, int]:
        value = image.getpixel((max(0, min(x, 1099)), max(0, min(y, 759))))
        return tuple(int(channel) for channel in value[:3])  # type: ignore[arg-type]

    def distance(a: tuple[int, int, int], b: tuple[int, int, int]) -> int:
        return sum(abs(left - right) for left, right in zip(a, b))

    check(
        "the selection is drawn on the current row at all (a DOM rectangle exists)",
        selection_rect is not None and selection_rect["w"] > 0,
        str(selection_rect),
    )
    if selection_rect:
        inside = pixel(image, selection_rect["x"] + 2, selection_rect["y"] + selection_rect["h"] - 2)
        outside = pixel(image, line_rect["x"] + line_rect["w"] - 30, line_rect["y"] + line_rect["h"] // 2)
        check(
            "…in N++'s selection colour, not the current-line band's",
            distance(inside, SELECTION) <= 6,
            f"pixel inside the selection {inside}, expected {SELECTION}",
        )
        check(
            "…while the current-line band is still painted on the rest of the row",
            distance(outside, BAND) <= 6,
            f"pixel outside the selection {outside}, expected {BAND}",
        )
        check(
            "…and the two colours are far enough apart to see (the reported bug)",
            distance(inside, BAND) >= 60,
            f"selection {inside} vs band {BAND}",
        )

    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(150)
    page.screenshot(path=SHOT_SELECTION)
    image = Image.open(SHOT_SELECTION).convert("RGB")
    row = pixel(image, line_rect["x"] + line_rect["w"] - 30, line_rect["y"] + line_rect["h"] // 2)
    check(
        "with nothing selected the band is still there (the fix hides nothing)",
        distance(row, BAND) <= 6,
        f"pixel {row}, expected {BAND}",
    )

    # ── 10. no errors, and nothing left the machine (D1) ─────────────────────
    check("no console errors", console_errors == [], str(console_errors[:3]))
    check("no uncaught page errors", page_errors == [], str(page_errors[:3]))
    off_machine = [url for url in requests if not url.startswith(URL.rstrip("/")) and not url.startswith("data:")]
    check("no request left the machine (D1)", off_machine == [], str(off_machine[:3]))

    browser.close()

failed = [name for name, ok, _ in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
for name in failed:
    print(f"  FAILED: {name}")
sys.exit(0 if not failed else 1)
