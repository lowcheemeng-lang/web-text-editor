#!/usr/bin/env python3
"""Task 9 acceptance check — N++'s Language menu (grouped A–Z, opened on hover), and the
selection that N++ paints over its current-line band.

    npm run dev                        # in another shell
    python3 scripts/verify-task9.py    # exit 0 = Task 9 accepted

S2: every claim `PROGRESS.md` makes about Task 9 is backed by this script. It drives the app
the way a person does — hovering the menu bar, hovering the menu's own items, keystrokes —
and fails loudly on console errors, page errors, or a request that leaves the machine.

Three things are under test:

1. **The Language menu** (the one N++ feature Task 6 knowingly left unbuilt). Its place in the
   menu bar (`Notepad_plus.rc:998`), "None (Normal Text)" first (`rc:1000`), the 140 languages
   grouped under their first letter — N++'s compact form (`_isLangMenuCompact`,
   `Notepad_plus.cpp:583-635`) — with N++'s radio check on the current one
   (`CheckMenuRadioItem`, :2965), a choice applying live and painting in N++'s colours, `None`
   clearing it, a legacy mode loading, the checked state following the active document, a
   choice surviving a real reload (Task 7's session), and a choice *overriding* a detected
   language on a real file opened through the stubbed picker.

2. **Hover opens menus** (S17). The menu bar used to only highlight a title; the check moves
   the pointer (no clicks) and asserts the popup drops down, and that moving to another title
   switches which menu is open.

3. **The reported bug: a selected word on the current row was invisible.** Two causes, both
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

import re
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

# Direct children only: the submenus live in the menu wrapper, but a nested one must never
# be mistaken for a top-level entry if that ever changes.
MENU = """() => {
    const popup = document.querySelector('.npp-menu-popup:not([hidden]):not(.npp-submenu)');
    if (!popup) return null;
    return {
        items: [...popup.querySelectorAll(':scope > [data-menu-item]')].map((node) => ({
            id: node.getAttribute('data-menu-item'),
            label: node.querySelector('.npp-menu-label')?.textContent ?? '',
            role: node.getAttribute('role'),
            checked: node.getAttribute('aria-checked'),
            submenu: node.getAttribute('aria-haspopup') === 'menu',
        })),
        rules: popup.querySelectorAll(':scope > .npp-menu-rule').length,
        scrollHeight: popup.scrollHeight,
        clientHeight: popup.clientHeight,
        bottom: Math.round(popup.getBoundingClientRect().bottom),
        viewport: window.innerHeight,
    };
}"""

SUBMENU = """() => {
    const popup = document.querySelector('.npp-submenu:not([hidden])');
    if (!popup) return null;
    const box = popup.getBoundingClientRect();
    return {
        items: [...popup.querySelectorAll('[data-menu-item]')].map((node) => ({
            id: node.getAttribute('data-menu-item'),
            label: node.querySelector('.npp-menu-label')?.textContent ?? '',
            role: node.getAttribute('role'),
            checked: node.getAttribute('aria-checked'),
        })),
        box: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) },
        viewport: { w: window.innerWidth, h: window.innerHeight },
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

    # Where each language lives, filled in by the structural pass below.
    group_of: dict[str, str] = {}

    def away_from_menus() -> None:
        page.mouse.move(4, 420)
        page.wait_for_timeout(90)

    def open_menu(label: str = "Language") -> dict:
        away_from_menus()
        page.hover(f".npp-menu-title:has-text('{label}')")
        # Wait for the popup rather than for a fixed delay: under load the 140 ms
        # hover delay plus a render can exceed any sleep short enough to keep the
        # script quick, and this check was observed to miss it when run directly
        # after another browser suite on the same dev server.
        for _ in range(30):
            menu = page.evaluate(MENU)
            if menu is not None:
                return menu
            page.wait_for_timeout(50)
        raise AssertionError(f"the {label} menu did not open on hover")

    def hover_group(letter: str) -> dict:
        page.hover(f"[data-menu-item='lang-group-{letter.lower()}']")
        for _ in range(30):
            submenu = page.evaluate(SUBMENU)
            if submenu is not None:
                return submenu
            page.wait_for_timeout(50)
        raise AssertionError(f"the {letter} submenu did not open on hover")

    def choose(item_id: str) -> None:
        open_menu()
        if item_id != "lang-none":
            hover_group(group_of[item_id])
        page.click(f"[data-menu-item='{item_id}']")
        page.wait_for_function(
            "() => !document.querySelector('.npp-menu-popup:not([hidden]):not(.npp-submenu)')",
            timeout=5000,
        )
        page.wait_for_timeout(500)  # the lazy grammar import resolves here

    def token_of(word: str) -> dict | None:
        return next((token for token in tokens() if token["text"] == word), None)

    # ── 1. the menu exists, where N++ puts it ─────────────────────────────────
    page.click(".cm-content")
    page.keyboard.press("Control+a")
    page.keyboard.type("def greet():\n    const = 1\n")
    page.keyboard.press("Control+Home")

    menu_titles = info()["menuTitles"]
    # D5/P4 added a sixth menu, Plugins, in N++'s own late position — its bar is
    # File … Language, Settings, Tools, Macro, Run, Plugins, Window — so the five
    # original titles keep their order and Plugins follows Settings.
    check(
        "the menu bar keeps N++'s order, with Plugins after Settings (D5/P4)",
        menu_titles == ["File", "Search", "View", "Language", "Settings", "Plugins"],
        str(menu_titles),
    )

    # ── 2. hover opens a menu — no click involved ─────────────────────────────
    away_from_menus()
    page.hover(".npp-menu-title:has-text('View')")
    page.wait_for_timeout(300)
    hovered = page.evaluate(
        """() => ({
            title: document.querySelector('.npp-menu-title[aria-expanded="true"]')?.textContent ?? null,
            visible: document.querySelector('.npp-menu-popup:not([hidden]):not(.npp-submenu)') !== null,
        })"""
    )
    check(
        "hovering a menu title drops its menu down without a click",
        hovered["visible"] and hovered["title"] == "View",
        str(hovered),
    )
    page.hover(".npp-menu-title:has-text('Language')")
    page.wait_for_timeout(300)
    switched = page.evaluate(
        """() => ({
            title: document.querySelector('.npp-menu-title[aria-expanded="true"]')?.textContent ?? null,
            open: document.querySelectorAll('.npp-menu-popup:not([hidden]):not(.npp-submenu)').length,
        })"""
    )
    check(
        "…and moving to another title switches the open menu, still without a click",
        switched["title"] == "Language" and switched["open"] == 1,
        str(switched),
    )

    # ── 3. the A–Z grouping is N++'s compact form ─────────────────────────────
    menu = open_menu()
    page.screenshot(path=SHOT_MENU)
    labels = [item["label"] for item in menu["items"]]
    check(
        "the first entry is N++'s 'None (Normal Text)' (Notepad_plus.rc:1000)",
        labels[0] == "None (Normal Text)",
        repr(labels[0]),
    )
    check(
        "…and it is the one checked on a scratch buffer",
        menu["items"][0]["checked"] == "true"
        and [item["label"] for item in menu["items"] if item["checked"] == "true"] == ["None (Normal Text)"],
        str([item["label"] for item in menu["items"] if item["checked"] == "true"]),
    )
    check(
        "a rule separates 'None' from the groups",
        menu["rules"] == 1,
        f"{menu['rules']} rules",
    )
    groups = labels[1:]
    check(
        "the languages are grouped into single-letter submenus, A–Z",
        groups == sorted(groups) and len(set(groups)) == len(groups) and all(re.fullmatch(r"[A-Z]", g) for g in groups),
        f"{len(groups)} groups: {''.join(groups)}",
    )
    check(
        "every group is a disclosure (a submenu parent, not a command)",
        all(item["submenu"] and item["role"] == "menuitem" for item in menu["items"][1:]),
        str([item["role"] for item in menu["items"][1:3]]),
    )
    check(
        "the grouped list is capped and scrolls inside the window",
        menu["scrollHeight"] > menu["clientHeight"]
        and menu["bottom"] <= menu["viewport"]
        and menu["clientHeight"] <= int(menu["viewport"] * 0.7) + 4,
        f"{menu['scrollHeight']}px of groups in a {menu['clientHeight']}px box, bottom {menu['bottom']} of {menu['viewport']}",
    )

    # Open every group and collect what is inside; this is also where `group_of` comes from.
    flattened: list[dict] = []
    first_geometry: dict | None = None
    for letter in groups:
        submenu = hover_group(letter)
        flattened.extend(submenu["items"])
        for child in submenu["items"]:
            group_of[child["id"]] = letter
        if first_geometry is None:
            row = page.locator(f"[data-menu-item='lang-group-{letter.lower()}']").bounding_box()
            first_geometry = {"submenu": submenu, "row": row}

    check(
        "all 140 languages appear exactly once under their letter",
        len(flattened) == 140 and len({item["id"] for item in flattened}) == 140,
        f"{len(flattened)} entries, {len({item['id'] for item in flattened})} unique",
    )
    check(
        "…in N++'s short-name order, case-insensitively",
        [item["label"] for item in flattened] == sorted((item["label"] for item in flattened), key=str.casefold),
        str([item["label"] for item in flattened][:4]),
    )
    check(
        "…and every language sits under its own initial",
        all(item["label"][0].upper() == group_of[item["id"]] for item in flattened),
        str(next((item for item in flattened if item["label"][0].upper() != group_of[item["id"]]), None)),
    )
    check(
        "the languages inside the groups are radio items",
        all(item["role"] == "menuitemradio" for item in flattened),
        f"roles={sorted({item['role'] for item in flattened})}",
    )

    if first_geometry and first_geometry["row"] is not None:
        submenu, row = first_geometry["submenu"], first_geometry["row"]
        check(
            "a submenu opens beside its row and stays inside the window",
            abs(submenu["box"]["x"] - (row["x"] + row["width"] - 3)) <= 6
            and submenu["box"]["x"] + submenu["box"]["w"] <= submenu["viewport"]["w"]
            and submenu["box"]["y"] + submenu["box"]["h"] <= submenu["viewport"]["h"],
            f"row right {round(row['x'] + row['width'])}, submenu {submenu['box']}",
        )

    # Clicking a group is a disclosure: it must not choose a language or close the menu.
    open_menu()
    page.hover("[data-menu-item='lang-group-b']")
    page.wait_for_timeout(180)
    page.click("[data-menu-item='lang-group-b']")
    page.wait_for_timeout(120)
    disclosure = page.evaluate(
        "() => document.querySelector('.npp-menu-popup:not([hidden]):not(.npp-submenu)') !== null"
    )
    check(
        "clicking a group only opens/closes its submenu, never picks a language",
        disclosure and info()["language"] is None,
        f"menu still open={disclosure}, language={info()['language']}",
    )

    page.keyboard.press("Escape")
    page.wait_for_timeout(120)
    closed = page.evaluate("() => document.querySelector('.npp-menu-popup:not([hidden])') === null")
    check(
        "Escape closes the menu and leaves the language alone",
        closed and info()["language"] is None,
        f"closed={closed}, language={info()['language']}",
    )

    # ── 4. choosing a language applies it, live, in N++'s colours ─────────────
    choose("lang-python")
    language = info()["language"] or {}
    check(
        "Language ▸ P ▸ Python sets the open document's language",
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

    open_menu()
    hover_group("P")
    checked = page.evaluate(
        """() => [...document.querySelectorAll('.npp-submenu [role=menuitemradio]')]
            .filter((node) => node.getAttribute('aria-checked') === 'true')
            .map((node) => node.querySelector('.npp-menu-label')?.textContent ?? '')"""
    )
    check(
        "reopening the menu marks Python inside its P group, and only Python",
        checked == ["Python"],
        str(checked),
    )

    # ── 5. switching replaces the old grammar rather than stacking a second ───
    choose("lang-javascript")
    const_token = token_of("const")
    check(
        "Language ▸ J ▸ JavaScript replaces Python's grammar: `const` is now the keyword",
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

    # ── 6. "None (Normal Text)" is a real language choice, not a no-op ────────
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

    # ── 7. the long tail: a legacy stream mode loads through the same menu ────
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

    # ── 8. the check follows the active document ──────────────────────────────
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

    # ── 9. a chosen language survives a real reload (Task 7's session) ────────
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

    # ── 10. a menu choice overrides a detected language on a real file ───────
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
        "…and Language ▸ P ▸ Python overrides the extension's decision",
        (info()["language"] or {}).get("id") == "python"
        and (token_of("def") or {}).get("color") == KEYWORD,
        str(info()["language"]),
    )

    # ── 11. the reported bug: a selected word on the current row is visible ──
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

    # ── 12. no errors, and nothing left the machine (D1) ─────────────────────
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
