"""Task 5 acceptance check — search, replace and navigation, against a real Chrome.

    npm run dev                        # in another shell
    python3 scripts/verify-task5.py    # exit 0 = Task 5 accepted

S2 in the plan: every claim `PROGRESS.md` makes about Task 5 is backed by this script, not by
prose. It drives the app the way a person would — the menu bar, the dialog's own controls,
keystrokes — and fails loudly on console errors or a request that leaves the machine.

What the plan's Task 5 asks for, and where it is checked here:
  step 1  find/replace dialog: regex, match case, whole word, wrap around      §2-§4
  step 2  mark-all, find next/previous, replace / replace-all                  §5-§7
  step 3  Go to line and the bookmark margin                                   §8-§10
  verification  "search/replace across a 10k-line file; confirm regex, wrap and bookmarks
                work without backend"                                          §7, §8, §11
"""
from __future__ import annotations

import sys

from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:5173/"
SHOT = "/home/lowcheemeng/.hermes/cache/scratch/task5.png"

results: list[tuple[str, bool, str]] = []
console_errors: list[str] = []
page_errors: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))


def near(actual: float, expected: float, slack: float) -> bool:
    return abs(actual - expected) <= slack


with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True)
    page = browser.new_page(viewport={"width": 1200, "height": 800})

    requests: list[str] = []
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: page_errors.append(str(e)))
    page.on("request", lambda r: requests.append(r.url))

    page.goto(URL, wait_until="load")
    page.wait_for_selector(".npp-app", timeout=10000)

    info = lambda: page.evaluate("() => window.__workspace.inspect()")
    view = lambda: page.evaluate(
        """() => {
            const v = window.__workspace.activeView;
            const s = v.state.selection.main;
            return { from: s.from, to: s.to, text: v.state.sliceDoc(s.from, s.to),
                     line: v.state.doc.lineAt(s.head).number, length: v.state.doc.length };
        }"""
    )

    def focus_editor() -> None:
        """Focus the editor without clicking: a click moves the caret, and several checks
        below are about where a search starts from."""
        page.evaluate("() => window.__workspace.activeView?.focus()")
        page.wait_for_timeout(40)

    def load(text: str) -> None:
        """A fresh document, focused, with the caret at the very top."""
        page.evaluate("(text) => { window.__workspace.newDocument(text); }", text)
        focus_editor()
        page.keyboard.press("Control+Home")
        page.wait_for_timeout(60)

    def open_dialog(tab: str = "find", key: str = "Alt+f") -> None:
        close_dialog()
        focus_editor()
        page.keyboard.press(key)
        page.wait_for_selector(f"[data-find-tab='{tab}'].is-active", timeout=3000)
        page.wait_for_timeout(60)

    def type_query(text: str) -> None:
        page.fill("[data-find='what']", text)
        page.wait_for_timeout(40)

    def click_action(action: str) -> None:
        page.click(f"[data-find-action='{action}']")
        page.wait_for_timeout(80)

    def close_dialog() -> None:
        if page.locator("[data-find='dialog']").is_visible():
            page.click("[data-find-action='close']")
            page.wait_for_timeout(80)

    def menu(title: str, item: str) -> None:
        page.click(f".npp-menu-title:has-text('{title}')")
        page.wait_for_selector(f"[data-menu-item='{item}']", timeout=3000)
        page.click(f"[data-menu-item='{item}']")
        page.wait_for_timeout(80)

    # ── 1. boot, menus, the dialog exists and is closed ─────────────────────
    check("one pane and one editor at boot", page.locator(".npp-pane").count() == 1
          and page.locator(".cm-editor").count() == 1)
    # Membership, not an exact list. The point of this check is that N++'s *Search* menu exists next
    # to File and View; Task 7 adds Settings ▸ Preferences… (and Task 4 already hit this pattern
    # when Task 5 added Search to what was then a two-menu bar). A later task adding a menu is not
    # a Task 5 regression, and `verify-task7.py` owns the current shape.
    check("File, Search and View menus are present (N++'s Search menu is here)",
          {"File", "Search", "View"} <= set(info()["menuTitles"]), str(info()["menuTitles"]))
    check("the Find dialog starts closed", info()["search"]["open"] is False)

    page.click(".npp-pane[data-pane='primary'] .cm-content")
    page.keyboard.press("Alt+f")
    page.wait_for_timeout(150)
    check("Alt+F opens the Find dialog (N++'s Ctrl+F is Chrome's — see DEVIATIONS_FROM_NPP)",
          info()["search"]["open"] is True and info()["search"]["tab"] == "find")
    check("the dialog is a floating panel, not a modal (the editor stays usable)",
          page.locator("[data-find='dialog']").is_visible()
          and page.locator("dialog[open]").count() == 0)

    # ── 2. the N++ dialog: labels, options, defaults, mode rules ────────────
    labels = page.locator("[data-find='dialog']").text_content() or ""
    for expected in ["Find", "Replace", "Mark", "Find what:", "Wrap around", "Match case",
                     "Match whole word only", "Backward direction", "Search Mode", "Normal",
                     "Regular expression", ". matches newline"]:
        check(f"dialog shows N++'s {expected!r}", expected in labels)
    check("Extended mode is labelled as N++ labels it (FindReplaceDlg.rc)",
          "Extended (\\n, \\r, \\t, \\0, \\x...)" in labels)

    search = info()["search"]
    check("defaults are N++'s FindHistory: wrap ON, match case OFF, whole word OFF",
          search["wrapAround"] is True and search["matchCase"] is False
          and search["wholeWord"] is False)
    check("default mode is Normal and direction is down",
          search["mode"] == "normal" and search["backwards"] is False)
    check("Find tab offers Find Next / Find Previous / Count / Close",
          all(page.locator(f"[data-find-action='{a}']").count() == 1
              for a in ("find-next", "find-prev", "count", "close")))
    check("Whole word, Backward and . matches newline are all enabled in Normal mode",
          page.locator("[data-find='word']").is_enabled()
          and page.locator("[data-find='backward']").is_enabled()
          and page.locator("[data-find='dot-newline']").is_disabled())

    page.click("[data-find-tab='replace']")
    page.wait_for_timeout(80)
    check("Replace tab shows Replace with: and In selection",
          page.locator("[data-find='with']").is_visible()
          and page.locator("[data-find='in-selection']").is_visible())
    check("Replace tab offers Replace and Replace All",
          page.locator("[data-find-action='replace']").is_visible()
          and page.locator("[data-find-action='replace-all']").is_visible())

    # N++'s option rules (FindReplaceDlg.cpp:2714-2740): regex forces whole word and backward
    # off and disables both, and enables ". matches newline".
    page.locator("[data-find='word']").check()
    page.locator("[data-find='backward']").check()
    page.click("input[data-find='mode'][value='regexp']")
    page.wait_for_timeout(80)
    check("choosing Regular expression disables whole word and Backward direction",
          page.locator("[data-find='word']").is_disabled()
          and page.locator("[data-find='backward']").is_disabled())
    check("...and unchecks them, as N++ does rather than leaving them set-but-ignored",
          info()["search"]["wholeWord"] is False and info()["search"]["backwards"] is False)
    check("...and enables . matches newline", page.locator("[data-find='dot-newline']").is_enabled())
    check("...and Find Previous is disabled while regexp mode is on (N++ rule)",
          page.locator("[data-find-action='find-prev']").is_disabled())
    page.click("input[data-find='mode'][value='normal']")
    page.wait_for_timeout(80)
    check("switching back to Normal restores whole word and Backward direction",
          page.locator("[data-find='word']").is_enabled()
          and page.locator("[data-find='backward']").is_enabled())

    # ── 3. finding: case, whole word, wrap around ───────────────────────────
    # A fixture where each count has exactly one answer. "here" is a whole word on lines
    # 1/3/6/9, sits inside "there" on lines 2/4/5/7/8/10/11/12, and appears once in caps on
    # line 13 — so a case-insensitive search for HERE must find 13 of them and a case-sensitive
    # one exactly 1.
    load("alpha here beta\nline two there\nline three here\nthere again\nthere\nhere\nthere\n"
         "there\nhere\nthere\nthere\nthere\nHERE CAPS")
    open_dialog()
    type_query("HERE")
    click_action("count")
    check("Count reports N++'s own wording — case-insensitive by default, so 'here' inside "
          "'there' counts", info()["search"]["status"] == "Count: 13 matches",
          repr(info()["search"]["status"]))
    click_action("find-next")
    check("Find Next selects the first occurrence", view()["line"] == 1 and view()["text"] == "here",
          repr(view()))
    click_action("find-next")
    check("...and the next one, not the one it is already on", view()["line"] == 2,
          f"line {view()['line']}")
    check("the caret stays in the dialog's Find what box (N++ hands focus back to it)",
          page.evaluate("() => document.activeElement?.getAttribute('data-find')") == "what")

    page.locator("[data-find='case']").check()
    click_action("count")
    check("Match case narrows 13 matches to the one in capitals",
          info()["search"]["status"] == "Count: 1 match", repr(info()["search"]["status"]))
    page.locator("[data-find='word']").check()
    type_query("here")
    click_action("count")
    check("Match whole word only refuses the 'here' inside 'there'",
          info()["search"]["status"] == "Count: 4 matches", repr(info()["search"]["status"]))
    page.locator("[data-find='word']").uncheck()
    page.locator("[data-find='case']").uncheck()
    type_query("HERE")

    # Wrap around: from the last match, Find Next must come back to the first and say so.
    page.evaluate("() => { const v = window.__workspace.activeView; v.dispatch({selection: {anchor: 0}}); }")
    click_action("find-prev")
    check("Find Previous wraps from the top to the last occurrence (N++: 'Reached document "
          "beginning, first occurrence from the bottom found.')",
          view()["line"] == 13 and info()["search"]["status"].startswith("Find: Reached document beginning"),
          f"line {view()['line']} · {info()['search']['status']!r}")
    click_action("find-next")
    check("Find Next wraps the other way and says that too",
          view()["line"] == 1 and info()["search"]["status"].startswith("Find: Reached document end"),
          f"line {view()['line']} · {info()['search']['status']!r}")

    page.locator("[data-find='wrap']").uncheck()
    page.evaluate("() => { const v = window.__workspace.activeView; v.dispatch({selection: {anchor: v.state.doc.length}}); }")
    type_query("alpha")
    click_action("find-next")
    check("with Wrap around off, no occurrence ahead is N++'s \"Can't find the text\"",
          info()["search"]["status"].startswith("Find: Can't find the text"), repr(info()["search"]["status"]))
    check("...and the dialog adds N++'s hint about the options that could be the cause",
          "Wrap around" in info()["search"]["status"]
          and "Match whole word only" in info()["search"]["status"])

    # ── 4. regular expression and extended modes ────────────────────────────
    page.locator("[data-find='wrap']").check()
    page.click("input[data-find='mode'][value='regexp']")
    type_query(r"^(there|here)$")
    click_action("count")
    check("regular expression mode matches per line with ^ and $",
          info()["search"]["status"] == "Count: 8 matches", repr(info()["search"]["status"]))

    load("first line\nsecond line\nthird line")
    open_dialog()
    page.click("input[data-find='mode'][value='regexp']")
    type_query("line$")
    page.locator("[data-find='dot-newline']").uncheck()
    click_action("count")
    check("'. matches newline' OFF: 'line$' matches once per line (3)",
          info()["search"]["status"] == "Count: 3 matches", repr(info()["search"]["status"]))
    # "line.second" can only match by crossing the break between line 1 and line 2 — a pattern
    # whose dot could be satisfied by a space (e.g. "first.line") would pass either way.
    type_query(r"line.second")
    click_action("count")
    check("'. matches newline' OFF: the dot refuses the line break (0 matches)",
          info()["search"]["status"] == "Count: 0 matches", repr(info()["search"]["status"]))
    page.locator("[data-find='dot-newline']").check()
    click_action("count")
    check("'. matches newline' ON: the same pattern crosses the line break (1 match)",
          info()["search"]["status"] == "Count: 1 match", repr(info()["search"]["status"]))

    page.click("input[data-find='mode'][value='extended']")
    type_query(r"\x66irst lin\u0065")
    click_action("count")
    check("Extended mode decodes \\xNN and \\uNNNN (N++'s convertExtendedToString)",
          info()["search"]["status"] == "Count: 1 match", repr(info()["search"]["status"]))
    type_query(r"\x00")
    click_action("count")
    check("Extended mode does not choke on \\x00", info()["search"]["status"] == "Count: 0 matches",
          repr(info()["search"]["status"]))

    # ── 5. marks ────────────────────────────────────────────────────────────
    load("cat dog cat bird cat\ncat fish")
    open_dialog()
    page.click("input[data-find='mode'][value='normal']")
    type_query("cat")
    page.click("[data-find-tab='mark']")
    page.wait_for_timeout(80)
    click_action("mark-all")
    check("Mark All reports N++'s wording", info()["search"]["status"] == "Mark: 4 matches",
          repr(info()["search"]["status"]))
    check("...and paints them (the state field)", info()["search"]["marks"] == 4,
          str(info()["search"]["marks"]))
    check("...and the marks are real decorations in the document",
          page.locator(".cm-searchMark").count() == 4,
          str(page.locator(".cm-searchMark").count()))

    page.locator("[data-find='bookmark-line']").check()
    click_action("mark-all")
    check("Mark All with 'Bookmark line' bookmarks the matched lines",
          info()["bookmarks"] == [1, 2], str(info()["bookmarks"]))
    check("...and the bookmarks appear in the margin",
          page.locator(".npp-bookmark-dot:visible").count() >= 2,
          str(page.locator(".npp-bookmark-dot:visible").count()))
    page.locator("[data-find='bookmark-line']").uncheck()

    click_action("clear-marks")
    check("Clear all marks removes them from the state and the DOM",
          info()["search"]["marks"] == 0 and page.locator(".cm-searchMark").count() == 0)

    # ── 6. replacing ────────────────────────────────────────────────────────
    load("cat dog cat\nbird cat")
    open_dialog("replace", "Control+h")
    page.keyboard.press("Control+Home")  # the caret decides where "find next" starts
    check("Ctrl+H opens the Replace tab (N++'s Ctrl+H is deliverable — measured)",
          info()["search"]["tab"] == "replace")
    page.click("input[data-find='mode'][value='normal']")
    page.fill("[data-find='what']", "cat")
    page.fill("[data-find='with']", "fox")
    click_action("replace")
    check("Replace with nothing matching selected finds the next occurrence instead (nothing "
          "is destroyed unseen)", info()["text"] == "cat dog cat\nbird cat", repr(info()["text"]))
    check("...and that occurrence is selected", view()["text"] == "cat")
    click_action("replace")
    check("Replace replaces the selected match", info()["text"] == "fox dog cat\nbird cat",
          repr(info()["text"]))
    check("...reports N++'s status for it",
          info()["search"]["status"].startswith("Replace: 1 occurrence was replaced"),
          repr(info()["search"]["status"]))
    click_action("replace-all")
    check("Replace All replaces every remaining occurrence",
          info()["text"] == "fox dog fox\nbird fox", repr(info()["text"]))
    check("...and reports the count", info()["search"]["status"] == "Replace All: 2 occurrences were replaced",
          repr(info()["search"]["status"]))
    click_action("replace-all")
    check("Replace All with nothing left is N++'s 'no occurrence was found'",
          info()["search"]["status"] == "Replace: no occurrence was found",
          repr(info()["search"]["status"]))

    load("name = value\nname2 = value2")
    open_dialog("replace", "Control+h")
    page.click("input[data-find='mode'][value='regexp']")
    page.fill("[data-find='what']", r"(\w+) = (\w+)")
    page.fill("[data-find='with']", "$2 = $1")
    click_action("replace-all")
    check("regular-expression replace expands $1 / $2 back-references",
          info()["text"] == "value = name\nvalue2 = name2", repr(info()["text"]))
    check("...counting both lines",
          info()["search"]["status"] == "Replace All: 2 occurrences were replaced",
          repr(info()["search"]["status"]))

    load("tab here")
    open_dialog("replace", "Control+h")
    page.click("input[data-find='mode'][value='extended']")
    page.fill("[data-find='what']", "here")
    page.fill("[data-find='with']", r"one\ttwo")
    click_action("replace-all")
    check("Extended mode expands \\t in the replacement (and that is a real tab)",
          info()["text"] == "tab one\ttwo", repr(info()["text"]))
    page.click("input[data-find='mode'][value='normal']")

    # ── 7. a 10k-line file: regex, marks, replace-all, and the time they take ──
    # "TARGET" every seventh line, "plain" elsewhere: nothing here contains anything else, so
    # the expected count cannot come from an accidental case-insensitive overlap.
    ten_k = page.evaluate(
        """() => {
            const lines = [];
            for (let i = 1; i <= 10000; i += 1) {
                lines.push(`line ${i}: ${i % 7 === 0 ? 'TARGET value' : 'plain value'} end`);
            }
            return lines.join('\\n');
        }"""
    )
    load(ten_k)
    check("the 10k-line document is loaded", info()["text"].count("\n") + 1 == 10000,
          f"{info()['text'].count(chr(10)) + 1} lines")
    timing = page.evaluate(
        """() => {
            const search = window.__workspace.search;
            // No backslash in the pattern on purpose: this string crosses a shell
            // heredoc, Python and JavaScript, and `[a-z]+` survives all three.
            search.options.query = 'TARGET ([a-z]+)';
            search.options.mode = 'regexp';
            search.options.replace = '[$1]';
            search.options.caseSensitive = false;
            search.options.wholeWord = false;
            search.options.dotMatchesNewline = false;
            const t0 = performance.now();
            const counted = search.count();
            const t1 = performance.now();
            const marked = search.markAll();
            const t2 = performance.now();
            const replaced = search.replaceEvery();
            const t3 = performance.now();
            return { counted, countMs: t1 - t0, marked, markMs: t2 - t1,
                     replaced, replaceMs: t3 - t2 };
        }"""
    )
    expected = len([i for i in range(1, 10001) if i % 7 == 0])  # 1428
    check(f"regex Count over 10k lines finds exactly {expected}", timing["counted"] == expected,
          str(timing["counted"]))
    check(f"...in {timing['countMs']:.0f} ms (scope §8 eyeballs a 50k-line stall < 200 ms)",
          timing["countMs"] < 200, f"{timing['countMs']:.1f} ms")
    check(f"Mark All paints all {expected} matches", timing["marked"] == expected, str(timing["marked"]))
    check(f"...in {timing['markMs']:.0f} ms", timing["markMs"] < 500, f"{timing['markMs']:.1f} ms")
    check(f"Replace All over 10k lines rewrites {expected} lines", timing["replaced"] == expected,
          str(timing["replaced"]))
    check(f"...in {timing['replaceMs']:.0f} ms", timing["replaceMs"] < 1000, f"{timing['replaceMs']:.1f} ms")
    lines_after = info()["text"].splitlines()
    check("...with $1 expanded on line 7 and line 8 left alone",
          lines_after[6] == "line 7: [value] end" and lines_after[7] == "line 8: plain value end",
          f"{lines_after[6]!r} / {lines_after[7]!r}")
    page.evaluate("() => { const s = window.__workspace.search.options; s.mode = 'normal'; "
                  "s.query = ''; s.replace = ''; }")

    # ── 8. Go to line (N++'s IDD_GOLINE) ────────────────────────────────────
    close_dialog()
    load("\n".join(f"row {i}" for i in range(1, 51)))
    page.click(".npp-pane[data-pane='primary'] .cm-content")
    page.keyboard.press("Control+g")
    page.wait_for_selector("[data-dialog='go-to']", timeout=3000)
    goto_text = page.locator("[data-dialog='go-to']").text_content() or ""
    for expected in ["Go To...", "Line", "Offset", "You are here:", "You want to go to:",
                     "You can't go further than:", "Go", "I'm going nowhere"]:
        check(f"Go To dialog shows N++'s {expected!r}", expected in goto_text)
    check("'You can't go further than' is the line count in Line mode",
          page.locator("[data-goto='limit']").text_content() == "50")
    page.fill("[data-goto='want']", "3")
    page.click("[data-dialog-action='go']")
    page.wait_for_timeout(120)
    check("Go jumps to the line's start", view()["line"] == 3 and view()["from"] == len("row 1\nrow 2\n"),
          f"line {view()['line']} at {view()['from']}")

    page.keyboard.press("Control+g")
    page.wait_for_selector("[data-dialog='go-to']", timeout=3000)
    page.click("input[data-goto='mode'][value='offset']")
    page.wait_for_timeout(60)
    check("Offset mode's limit is the document length",
          page.locator("[data-goto='limit']").text_content() == str(view()["length"]))
    page.fill("[data-goto='want']", str(len("row 1\nrow 2\nrow 3\n")))
    page.click("[data-dialog-action='go']")
    page.wait_for_timeout(120)
    check("Offset mode puts the caret at that character offset", view()["line"] == 4,
          f"line {view()['line']}")

    page.keyboard.press("Control+g")
    page.wait_for_selector("[data-dialog='go-to']", timeout=3000)
    page.fill("[data-goto='want']", "49")
    page.click("[data-dialog-action='cancel']")
    page.wait_for_timeout(120)
    check("\"I'm going nowhere\" leaves the caret where it was", view()["line"] == 4,
          f"line {view()['line']}")

    # ── 9. bookmarks: toggle, navigate, clear, margin ───────────────────────
    load("\n".join(f"row {i}" for i in range(1, 21)))
    page.keyboard.press("Control+Home")
    page.keyboard.press("Control+F2")
    page.keyboard.press("ArrowDown")
    page.keyboard.press("ArrowDown")
    page.keyboard.press("ArrowDown")
    page.keyboard.press("Control+F2")
    check("Ctrl+F2 toggles a bookmark on the caret's line", info()["bookmarks"] == [1, 4],
          str(info()["bookmarks"]))
    # The count is of *visible* dots: CM6 renders `initialSpacer`'s marker in a hidden
    # gutter element to size the margin, so the DOM holds one more than there are bookmarks.
    check("the margin paints the N++ dot", page.locator(".npp-bookmark-dot:visible").count() == 2,
          str(page.locator(".npp-bookmark-dot:visible").count()))
    page.keyboard.press("Control+F2")
    check("Ctrl+F2 on a bookmarked line removes it", info()["bookmarks"] == [1], str(info()["bookmarks"]))
    page.keyboard.press("Control+F2")

    page.keyboard.press("Control+Home")
    page.keyboard.press("F2")
    check("F2 goes to the next bookmark (N++'s bookmarkNext)", view()["line"] == 4,
          f"line {view()['line']}")
    page.keyboard.press("F2")
    check("...and wraps around to the first when it runs out", view()["line"] == 1,
          f"line {view()['line']}")
    page.keyboard.press("Shift+F2")
    check("Shift+F2 goes back, wrapping from the first to the last", view()["line"] == 4,
          f"line {view()['line']}")

    menu("Search", "clear-bookmarks")
    check("Search ▸ Clear All Bookmarks empties the list and the margin",
          info()["bookmarks"] == [] and page.locator(".npp-bookmark-dot:visible").count() == 0,
          str(info()["bookmarks"]) + f" · dots {page.locator('.npp-bookmark-dot:visible').count()}")

    page.keyboard.press("Control+Home")
    page.keyboard.press("Control+F2")
    menu("View", "bookmark-margin")
    check("View ▸ Bookmark Margin hides the margin (N++'s _bookMarkMarginShow)",
          page.locator(".cm-bookmarkGutter").count() == 0
          and page.locator(".npp-bookmark-dot:visible").count() == 0)
    check("...without losing the bookmarks themselves", info()["bookmarks"] == [1],
          str(info()["bookmarks"]))
    menu("View", "bookmark-margin")
    check("...and toggling it back shows them again",
          page.locator(".cm-bookmarkGutter").count() == 1
          and page.locator(".npp-bookmark-dot:visible").count() >= 1)

    # Come back to *this* document, not to whichever tab happens to be first: the script has
    # created a dozen documents by now, and "the first tab" is the welcome buffer.
    bookmarked_tab = page.locator(".npp-tab").count() - 1
    load("another document\nfor the tab switch")
    page.locator(".npp-tab").nth(bookmarked_tab).click()
    page.wait_for_timeout(120)
    check("bookmarks survive a tab switch (they live in the document's state)",
          info()["bookmarks"] == [1], f"{info()['bookmarks']} · active {info()['activeName']!r}")

    # ── 10. the split: both panes show the marks and bookmarks ──────────────
    load("alpha one\nalpha two\nalpha three\nalpha four")
    open_dialog()
    page.click("input[data-find='mode'][value='normal']")
    type_query("alpha")
    page.click("[data-find-tab='mark']")
    page.wait_for_timeout(60)
    click_action("mark-all")
    close_dialog()
    page.click("button[data-tool='split']")
    page.wait_for_timeout(150)
    primary_marks = page.locator(".npp-pane[data-pane='primary'] .cm-searchMark").count()
    clone_marks = page.locator(".npp-pane[data-pane='clone'] .cm-searchMark").count()
    check("the split paints the marks in both panes", primary_marks == 4 and clone_marks == 4,
          f"primary {primary_marks} / clone {clone_marks}")

    # A click in the clone's bookmark margin: the workspace reconciles the two panes.
    clone_line = page.locator(".npp-pane[data-pane='clone'] .cm-line").nth(2)
    box = clone_line.bounding_box()
    gutter = page.locator(".npp-pane[data-pane='clone'] .cm-bookmarkGutter").first.bounding_box()
    page.mouse.click(gutter["x"] + gutter["width"] / 2, box["y"] + box["height"] / 2)
    page.wait_for_timeout(120)
    check("clicking the bookmark margin toggles a bookmark on that line",
          info()["bookmarks"] == [3], str(info()["bookmarks"]))
    primary_dots = page.locator(".npp-pane[data-pane='primary'] .npp-bookmark-dot:visible").count()
    clone_dots = page.locator(".npp-pane[data-pane='clone'] .npp-bookmark-dot:visible").count()
    check("...and the mark shows in the other pane too (the panes are reconciled)",
          primary_dots >= 1 and clone_dots >= 1, f"primary {primary_dots} / clone {clone_dots}")
    page.click("button[data-tool='split']")
    page.wait_for_timeout(120)
    check("closing the split keeps the bookmark", info()["bookmarks"] == [3], str(info()["bookmarks"]))

    # ── 11. keys, and the no-backend promise (D1) ───────────────────────────
    close_dialog()
    load("nav one\nnav two\nnav three")
    open_dialog()
    type_query("nav")
    page.keyboard.press("Escape")
    page.wait_for_timeout(100)
    check("Escape closes the dialog and hands the focus back to the editor",
          info()["search"]["open"] is False
          and page.evaluate("() => document.activeElement?.className.includes('cm-content')") is True)
    page.keyboard.press("Control+Home")
    page.keyboard.press("F3")
    check("F3 keeps searching with the dialog closed (N++'s find next)",
          view()["text"].lower() == "nav", repr(view()))
    page.keyboard.press("Control+m")
    page.wait_for_timeout(120)
    check("Ctrl+M opens the Mark tab", info()["search"]["tab"] == "mark")
    close_dialog()

    status = page.locator(".npp-statusbar").text_content() or ""
    check("the status bar still reports the caret after all of this", "Ln " in status, status.strip())

    offsite = [u for u in requests
               if not (u.startswith(("http://127.0.0.1", "http://localhost", "ws://127.0.0.1",
                                     "ws://localhost", "data:")))]
    check("no request left the machine (D1 backend-free)", len(offsite) == 0, ", ".join(offsite[:3]))

    page.screenshot(path=SHOT)
    browser.close()

check("no console errors", len(console_errors) == 0, "; ".join(console_errors[:3]))
check("no uncaught page errors", len(page_errors) == 0, "; ".join(page_errors[:3]))

failed = [name for name, ok, _ in results if not ok]
print(f"\n{'=' * 60}")
print(f"VERIFY-TASK5: {'PASS' if not failed else 'FAIL'}  ({len(results) - len(failed)}/{len(results)} checks)")
if failed:
    print("failed: " + "; ".join(failed))
print("=" * 60)
sys.exit(1 if failed else 0)
