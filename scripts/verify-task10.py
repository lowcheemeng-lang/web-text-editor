#!/usr/bin/env python3
"""Task 10 acceptance check — Notepad++ Dark Mode, and the light theme it must not disturb.

    npm run dev                        # in another shell
    python3 scripts/verify-task10.py   # exit 0 = Task 10 accepted

S2: every claim `PROGRESS.md` makes about Task 10 is backed by this script. It drives the real
Preferences dialog and the real menus, reads **computed colours** off the rendered app, and takes
screenshots of both themes.

What is checked:
  - the light theme is unchanged: editor, gutter, status bar and N++'s token colours;
  - Preferences offers both themes under N++'s names, and Cancel applies nothing (N++'s rule);
  - choosing Dark Mode applies on OK — `data-theme="dark"` on the root, the editor palette from
    `DarkModeDefault.xml` (#3f3f3f background, #dcdccc text, #101010 current line, #0c0c0c
    margin), the chrome from `NppDarkMode.cpp` (#202020, #2b2b2b popups, #e0e0e0 text), and the
    token palette (keyword #dfc47d, comment #7f9f7f, number #8cd0d3);
  - the status bar, tab strip, menus, Preferences dialog, Find dialog and the S4 notice all
    switch, because one attribute drives every variable in `style.css`;
  - a reload restores Dark Mode **before the first paint** (an init script records the theme at
    DOMContentLoaded; the mirror in localStorage is what makes that possible);
  - switching back to light is live and leaves the document alone;
  - rendered token contrast clears 3:1 on the dark background. The full contrast tables — N++'s
    own, including the colours that fall short of WCAG AA — are asserted in
    `scripts/test-themes.mjs`, which needs no browser.
"""
from __future__ import annotations

import sys

from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:5173/"
SHOT_DARK = "/home/lowcheemeng/.hermes/cache/screenshots/task10-dark.png"
SHOT_PREFS = "/home/lowcheemeng/.hermes/cache/screenshots/task10-dark-preferences.png"
SHOT_LIGHT = "/home/lowcheemeng/.hermes/cache/screenshots/task10-light.png"

# N++'s values (installer/themes/DarkModeDefault.xml and NppDarkMode.cpp), as the checks expect to
# see them in computed styles.
DARK = {
    "editor": (63, 63, 63),  # Default Style bgColor 3f3f3f
    "text": (220, 220, 204),  # Default Style fgColor dcdccc
    "chromeText": (224, 224, 224),  # NppDarkMode textColor e0e0e0
    "gutter": (12, 12, 12),  # Line number margin bgColor 0c0c0c
    "active": (16, 16, 16),  # Current line background colour 101010
    "chrome": (32, 32, 32),  # NppDarkMode background 202020
    "panel": (43, 43, 43),  # menu/dialog #2b2b2b
    "notice": (58, 47, 26),  # #3a2f1a
    "keyword": (223, 196, 125),  # c: INSTRUCTION WORD dfc47d
    "comment": (127, 159, 127),  # c: COMMENT 7f9f7f
    "number": (140, 208, 211),  # c: NUMBER 8cd0d3
}
LIGHT = {
    "editor": (255, 255, 255),
    "gutter": (228, 228, 228),
    "chrome": (240, 240, 240),
    "keyword": (0, 0, 255),
}

results: list[tuple[str, bool, str]] = []
console_errors: list[str] = []
page_errors: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))


def rgb(text: str) -> tuple[int, int, int]:
    """'rgb(63, 63, 63)' → (63, 63, 63); alpha is ignored (every colour here is opaque)."""
    numbers = [int(part) for part in text.replace("rgba(", "").replace("rgb(", "").rstrip(")").split(",")[:3]]
    return numbers[0], numbers[1], numbers[2]


def luminance(colour: tuple[int, int, int]) -> float:
    channels = [value / 255 for value in colour]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def contrast(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    light, dark = sorted((luminance(a), luminance(b)), reverse=True)
    return (light + 0.05) / (dark + 0.05)


TOKENS = """() => [...document.querySelectorAll('.cm-content .cm-line span')].map((s) => ({
    text: s.textContent, color: getComputedStyle(s).color, weight: getComputedStyle(s).fontWeight,
}))"""

CHROME = """() => {
    const style = (selector, pseudo) => {
        const node = document.querySelector(selector);
        return node ? getComputedStyle(node, pseudo ?? null) : null;
    };
    const value = (selector, property, pseudo) => style(selector, pseudo)?.[property] ?? null;
    return {
        theme: document.documentElement.dataset.theme ?? null,
        mirror: (() => { try { return localStorage.getItem('npp-web.theme'); } catch { return null; } })(),
        editorBg: value('.cm-editor', 'backgroundColor'),
        editorText: value('.cm-editor', 'color'),
        gutter: value('.cm-gutters', 'backgroundColor'),
        activeLine: value('.cm-activeLine', 'backgroundColor', '::before'),
        status: value('.npp-statusbar', 'backgroundColor'),
        tabs: value('.npp-tabstrip', 'backgroundColor'),
        activeTab: value('.npp-tab.is-active', 'backgroundColor'),
        pane: value('.npp-pane', 'backgroundColor'),
    };
}"""

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True)
    page = browser.new_page(viewport={"width": 1100, "height": 760})

    requests: list[str] = []
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: page_errors.append(str(e)))
    page.on("request", lambda r: requests.append(r.url))

    # Records the theme the document had when parsing finished: if this is "dark" after a reload,
    # the attribute was set before first paint (the inline script in index.html), not by the app
    # after its asynchronous preference read.
    page.add_init_script(
        """window.addEventListener('DOMContentLoaded', () => {
            window.__themeAtDomReady = document.documentElement.dataset.theme ?? null;
        });"""
    )

    page.goto(URL, wait_until="load")
    page.wait_for_selector(".npp-app", timeout=10000)

    info = lambda: page.evaluate("() => window.__workspace.inspect()")
    chrome = lambda: page.evaluate(CHROME)
    tokens = lambda: page.evaluate(TOKENS)

    def token_of(word: str) -> dict | None:
        return next((token for token in tokens() if token["text"] == word), None)

    def dismiss_restore_alert() -> str:
        """Task 7's restore can ask a question before it finishes; a page test must answer it."""
        if page.locator("dialog[open]").count() > 0:
            text = page.locator("dialog[open]").first.text_content() or ""
            page.click("[data-dialog-action='ok']")
            page.wait_for_timeout(250)
            return text.strip()
        return ""

    def open_preferences() -> None:
        page.mouse.move(600, 420)
        page.hover(".npp-menu-title:has-text('Settings')")
        page.wait_for_timeout(300)
        page.click("[data-menu-item='preferences']")
        page.wait_for_selector("dialog[open]", timeout=5000)

    def choose_theme(value: str, confirm: bool = True) -> None:
        open_preferences()
        page.select_option("[data-pref='theme']", value)
        page.click(f"[data-dialog-action='{'confirm' if confirm else 'cancel'}']")
        page.wait_for_timeout(450)

    # ── 1. the light theme is unchanged ───────────────────────────────────────
    page.click(".cm-content")
    page.keyboard.press("Control+a")
    page.keyboard.type("def greet():\n    # a comment\n    return 42\n")
    page.keyboard.press("Control+Home")

    # Python through the real Language menu, so the token checks have tokens.
    page.mouse.move(600, 420)
    page.hover(".npp-menu-title:has-text('Language')")
    page.wait_for_timeout(300)
    page.hover("[data-menu-item='lang-group-p']")
    page.wait_for_timeout(200)
    page.click("[data-menu-item='lang-python']")
    page.wait_for_timeout(600)

    light = chrome()
    check(
        "the app starts in N++'s light theme",
        light["theme"] == "light" and rgb(light["editorBg"]) == LIGHT["editor"],
        f"{light['theme']}, editor {light['editorBg']}",
    )
    check(
        "…with the light gutter and chrome",
        rgb(light["gutter"]) == LIGHT["gutter"] and rgb(light["status"]) == LIGHT["chrome"],
        f"gutter {light['gutter']}, status {light['status']}",
    )
    light_keyword = token_of("def") or {}
    check(
        "…and N++'s light token colours (`def` #0000ff, bold)",
        light_keyword.get("color") == "rgb(0, 0, 255)" and light_keyword.get("weight") == "700",
        str(light_keyword),
    )
    page.screenshot(path=SHOT_LIGHT)

    # ── 2. the Preferences dialog offers both themes ─────────────────────────
    open_preferences()
    options = page.evaluate(
        "() => [...document.querySelectorAll(\"[data-pref='theme'] option\")].map((o) => ({ value: o.value, text: o.textContent }))"
    )
    check(
        "Preferences ▸ Theme offers N++'s light styles and Dark Mode",
        [option["value"] for option in options] == ["notepadpp", "dark"]
        and [option["text"] for option in options] == ["Notepad++ (light)", "Notepad++ Dark Mode"],
        str(options),
    )
    page.select_option("[data-pref='theme']", "dark")
    page.click("[data-dialog-action='cancel']")
    page.wait_for_timeout(250)
    check(
        "Cancel applies nothing, as N++'s dialog does",
        chrome()["theme"] == "light" and info()["preferences"]["theme"] == "notepadpp",
        f"{chrome()['theme']}, preference {info()['preferences']['theme']}",
    )

    # ── 3. OK applies Dark Mode everywhere ───────────────────────────────────
    choose_theme("dark")
    dark = chrome()
    check(
        "choosing Dark Mode applies it and stores it",
        dark["theme"] == "dark"
        and dark["mirror"] == "dark"
        and info()["preferences"]["theme"] == "dark",
        f"{dark['theme']}, mirror {dark['mirror']}",
    )
    check(
        "the editor takes DarkModeDefault.xml's palette (#3f3f3f on #dcdccc)",
        rgb(dark["editorBg"]) == DARK["editor"] and rgb(dark["editorText"]) == DARK["text"],
        f"bg {dark['editorBg']}, text {dark['editorText']}",
    )
    check(
        "the line-number margin and current-line band are N++'s dark values",
        rgb(dark["gutter"]) == DARK["gutter"] and rgb(dark["activeLine"]) == DARK["active"],
        f"gutter {dark['gutter']}, current line {dark['activeLine']}",
    )
    check(
        "the chrome switches too (status bar #202020, tab strip and pane)",
        rgb(dark["status"]) == DARK["chrome"]
        and rgb(dark["pane"]) == DARK["editor"]
        and rgb(dark["tabs"]) != LIGHT["chrome"],
        f"status {dark['status']}, pane {dark['pane']}, tabs {dark['tabs']}",
    )

    page.mouse.move(600, 420)
    page.hover(".npp-menu-title:has-text('File')")
    page.wait_for_timeout(300)
    menu = page.evaluate(
        """() => { const p = document.querySelector('.npp-menu-popup:not([hidden])');
            return p ? { bg: getComputedStyle(p).backgroundColor, text: getComputedStyle(p).color } : null; }"""
    )
    check(
        "the menu popup is dark, with light text",
        menu is not None and rgb(menu["bg"]) == DARK["panel"] and rgb(menu["text"]) == DARK["chromeText"],
        str(menu),
    )
    page.keyboard.press("Escape")
    page.wait_for_timeout(150)
    # The screenshot is taken with the menu closed: a popup over the top-left corner would cover
    # the document's first lines, which is exactly what the picture is meant to show.
    page.evaluate("() => window.__workspace.activeView?.focus()")
    page.screenshot(path=SHOT_DARK)

    # Preferences dialog itself, in dark.
    open_preferences()
    page.screenshot(path=SHOT_PREFS)
    dialog = page.evaluate(
        """() => { const d = document.querySelector('dialog[open]');
            return { bg: getComputedStyle(d).backgroundColor, text: getComputedStyle(d).color }; }"""
    )
    check(
        "the Preferences dialog is dark, with light text",
        rgb(dialog["bg"]) == DARK["panel"] and rgb(dialog["text"]) == DARK["chromeText"],
        str(dialog),
    )
    page.click("[data-dialog-action='cancel']")
    page.wait_for_timeout(200)

    # Find dialog (Task 5's floating window), in dark.
    page.evaluate("() => window.__workspace.activeView?.focus()")
    page.keyboard.press("Alt+f")
    page.wait_for_selector(".npp-find", timeout=5000)
    page.wait_for_timeout(150)
    find_bg = page.evaluate("() => getComputedStyle(document.querySelector('.npp-find')).backgroundColor")
    check("the Find dialog is dark", rgb(find_bg) == DARK["panel"], find_bg)
    page.keyboard.press("Escape")
    page.wait_for_timeout(150)

    # ── 4. the token palette switches, and is readable ───────────────────────
    keyword = token_of("def") or {}
    comment = token_of("# a comment") or {}
    number = token_of("42") or {}
    check(
        "the grammar paints in DarkModeDefault.xml's colours",
        keyword.get("color") == "rgb(223, 196, 125)"
        and comment.get("color") == "rgb(127, 159, 127)"
        and number.get("color") == "rgb(140, 208, 211)",
        f"keyword {keyword.get('color')}, comment {comment.get('color')}, number {number.get('color')}",
    )
    check(
        "…and the light blue is gone from the dark theme",
        keyword.get("color") != "rgb(0, 0, 255)",
        str(keyword.get("color")),
    )
    if keyword:
        ratio = contrast(rgb(keyword["color"]), rgb(dark["editorBg"]))
        check(
            "the rendered keyword colour clears 3:1 on the dark background",
            ratio >= 3.0,
            f"{ratio:.2f}:1",
        )

    # ── 5. a reload restores Dark Mode before the first paint ────────────────
    # N++ snapshots a dirty buffer every 7 s; let the snapshot land so the restore brings the
    # document back instead of asking the "no backup" question (Task 7's alert), which would
    # hold `session.complete` false until answered.
    page.wait_for_timeout(7600)
    page.reload(wait_until="load")
    page.wait_for_selector(".npp-app", timeout=10000)
    alert = dismiss_restore_alert()
    if alert:
        print(f"      (a restore alert was answered: {alert[:80]!r})")
    page.wait_for_function(
        "() => window.__workspace.inspect().session.complete === true", timeout=10000
    )
    page.wait_for_timeout(300)
    reloaded = chrome()
    first_paint = page.evaluate("() => window.__themeAtDomReady")
    check(
        "the theme attribute exists at DOMContentLoaded after a reload (no light flash)",
        first_paint == "dark",
        f"theme at DOMContentLoaded: {first_paint}",
    )
    check(
        "…and the editor, chrome and tokens come back dark",
        reloaded["theme"] == "dark"
        and rgb(reloaded["editorBg"]) == DARK["editor"]
        and (token_of("def") or {}).get("color") == "rgb(223, 196, 125)",
        f"{reloaded['theme']}, {reloaded['editorBg']}, {(token_of('def') or {}).get('color')}",
    )

    # ── 6. the S4 notice is themed as well ───────────────────────────────────
    page.add_init_script(
        """delete window.showOpenFilePicker; delete window.showSaveFilePicker;
           delete window.showDirectoryPicker;"""
    )
    page.reload(wait_until="load")
    page.wait_for_selector(".npp-app", timeout=10000)
    dismiss_restore_alert()
    page.wait_for_selector(".npp-notice", timeout=10000)
    notice = page.evaluate(
        """() => { const n = document.querySelector('.npp-notice');
            return { bg: getComputedStyle(n).backgroundColor, color: getComputedStyle(n).color }; }"""
    )
    check(
        "the capability notice is dark too",
        rgb(notice["bg"]) == DARK["notice"] and rgb(notice["color"]) != (0, 0, 0),
        str(notice),
    )

    # ── 7. switching back to light is live and leaves the document alone ─────
    before = info()["text"]
    choose_theme("notepadpp")
    after = chrome()
    check(
        "switching back to light is immediate and complete",
        after["theme"] == "light"
        and rgb(after["editorBg"]) == LIGHT["editor"]
        and rgb(after["status"]) == LIGHT["chrome"]
        and after["mirror"] == "notepadpp",
        f"{after['theme']}, {after['editorBg']}, mirror {after['mirror']}",
    )
    check(
        "…and the light token palette is back",
        (token_of("def") or {}).get("color") == "rgb(0, 0, 255)",
        str(token_of("def")),
    )
    check("…and the document's text was never touched", info()["text"] == before, str(len(before or "")))

    # ── 8. no errors, and nothing left the machine (D1) ─────────────────────
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
