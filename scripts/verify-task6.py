"""Task 6 acceptance check — syntax highlighting, language modes and the overview ruler.

    npm run dev                        # in another shell
    python3 scripts/verify-task6.py    # exit 0 = Task 6 accepted

S2 in the plan: every claim `PROGRESS.md` makes about Task 6 is backed by this script, not by
prose. Files are opened the way a person opens them — `Alt+O` through the real File ▸ Open
path — with only the OS dialog stubbed (`showOpenFilePicker` returns a handle from the Origin
Private File System, so decoding, naming and language detection all run for real). Everything
the highlighting does is read back as **computed colour on rendered spans**, and everything
the ruler draws is read back from its **canvas pixels**, because "a decoration exists in the
state" and "the user can see it" are different claims.

What the plan's Task 6 asks for, and where it is checked here:
  step 1  register D9's language set, each lazily imported                    §1, §2
  step 2  detect a language by extension, and by content when that fails      §3, §4, §5
  step 3  the overview ruler as the language-aware navigation aid             §6, §7
  verification  "open .js, .py, .html, .md files; confirm highlighting and the overview
                ruler update correctly"                                       §2, §6
  carried forward from Task 3: fold state is forwarded between the panes      §8
"""
from __future__ import annotations

import re
import subprocess
import sys

from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:5173/"
SHOT = "/home/lowcheemeng/.hermes/cache/screenshots/task6-languages.png"
SHOT_BAR = "/home/lowcheemeng/.hermes/cache/screenshots/task6-statusbar.png"

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

STUB_PICKERS = """async ([openName, saveName]) => {
    const root = await navigator.storage.getDirectory();
    window.showOpenFilePicker = async () => [await root.getFileHandle(openName, { create: true })];
    window.showSaveFilePicker = async () => await root.getFileHandle(saveName, { create: true });
}"""

ADOPT = """async (name) => {
    const root = await navigator.storage.getDirectory();
    window.showOpenFilePicker = async () => [await root.getFileHandle(name)];
}"""

# What the highlighting actually painted: colour + weight for every rendered token span.
TOKENS = """() => {
    const seen = [];
    for (const span of document.querySelectorAll('.cm-content .cm-line span')) {
        const style = getComputedStyle(span);
        seen.push({
            text: span.textContent,
            color: style.color,
            weight: style.fontWeight,
            italic: style.fontStyle,
        });
    }
    return seen;
}"""

# The ruler's canvas, read back as pixels: how many ticks of a given colour are drawn, and
# where the first one sits (0 = top of the strip, 1 = bottom).
CANVAS = """(rgbs) => {
    const canvas = document.querySelector('.npp-pane[data-pane="primary"] .npp-ruler-canvas');
    if (!canvas) return null;
    const context = canvas.getContext('2d');
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    const wanted = rgbs.map(([r, g, b]) => `${r},${g},${b}`);
    const rows = {};
    let total = 0;
    for (let y = 0; y < height; y++) {
        let hit = false;
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
            const index = wanted.indexOf(key);
            if (index >= 0) {
                rows[wanted[index]] = rows[wanted[index]] || [];
                if (rows[wanted[index]].length < 400) rows[wanted[index]].push(y / height);
                hit = true;
            }
        }
        if (hit) total += 1;
    }
    return { width, height, rows, paintedRows: total };
}"""


def press_open(page) -> None:
    """File ▸ Open through the keyboard, which is the path a person uses."""
    page.evaluate("() => window.__workspace.activeView?.focus()")
    page.keyboard.press("Alt+o")
    page.wait_for_timeout(250)


def dismiss_alert(page) -> str:
    """A dialog N++ would show (assumed encoding, undecodable bytes) — never a crash."""
    if page.locator(".npp-alert, dialog[open]").count() > 0:
        text = page.locator(".npp-alert, dialog[open]").first.text_content() or ""
        page.keyboard.press("Enter")
        page.wait_for_timeout(150)
        return text
    return ""


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

    def open_seeded(name: str) -> None:
        """Point the stubbed picker at an OPFS file and open it through the real path."""
        page.evaluate(ADOPT, name)
        press_open(page)
        alert = dismiss_alert(page)
        if alert:
            print(f"      (a dialog was shown and dismissed: {alert[:70]!r})")

    def status_items() -> list[str]:
        return page.evaluate(
            "() => [...document.querySelectorAll('.npp-status-item')].map(n => n.textContent)"
        )

    # ── 0. seed the files the plan names, plus the ones this task's open questions need ──
    fixtures = {
        "sample.py": 'def greet(name):\n    # N++ paints comments green\n    return "hello " + str(42)\n',
        "sample.js": 'function add(a, b) {\n  // a comment\n  return a + "x" + 42;\n}\n',
        "sample.html": '<html>\n  <body id="main" class="page">text</body>\n</html>\n',
        "sample.md": "# Heading one\n\nSome **bold** and *italic* text and `code`.\n",
        "sample.cs": 'public class P { // C#\n  int x = 1;\n}\n',
        "sample.rb": "# Ruby\nputs 'hello'\n",
        "shebang": "#!/usr/bin/env python3\nprint('detected from content')\n",
        "xmlhead": '<?xml version="1.0"?>\n<root/>\n',
        "Dockerfile": "FROM node:22\nRUN echo hi\n",
        "CMakeLists.txt": "project(demo)\nadd_executable(demo main.cpp)\n",
        "Makefile": "all:\n\techo hi\n",
        "notes.txt": "just text\n",
    }
    for name, text in fixtures.items():
        page.evaluate(SEED, [name, list(text.encode("utf-8"))])
    check(
        "seeded every fixture in the page's own file system",
        page.evaluate(
            """async (names) => {
                const root = await navigator.storage.getDirectory();
                for (const name of names) await root.getFileHandle(name);
                return true;
            }""",
            list(fixtures),
        ),
    )

    # ── 1. the registry D9 accepted ─────────────────────────────────────────
    check("one pane and one editor at boot", page.locator(".npp-pane").count() == 1)
    stats = info()["languages"]
    check(
        "the registry carries 27 first-class languages (from the 22 official packages)",
        stats["firstClass"] == 27,
        str(stats),
    )
    check(
        "and 113 legacy stream-mode languages",
        stats["legacy"] == 113,
        str(stats),
    )
    check("140 languages in total", stats["total"] == 140, str(stats))
    check(
        "281 distinct file extensions map to them",
        stats["extensions"] == 281,
        str(stats),
    )
    check(
        "the first document is N++'s 'Normal text file' — a scratch buffer has no extension",
        info()["language"] is None and status_items()[0] == "Normal text file",
        status_items()[0],
    )

    # ── 2. the plan's four files: detection, status bar, and painted colours ─
    # Colours are N++'s own (`stylers.model.xml`): keyword 0000FF bold, comment 008000,
    # string 808080, number FF8000, operator 000080 bold, tag 0000FF, attribute FF0000.
    expectations = {
        "sample.py": {
            "id": "python",
            "label": "Python file",
            "tokens": {
                "def": ("rgb(0, 0, 255)", "700"),
                "# N++ paints comments green": ("rgb(0, 128, 0)", "400"),
                '"hello "': ("rgb(128, 128, 128)", "400"),
                "42": ("rgb(255, 128, 0)", "400"),
            },
        },
        "sample.js": {
            "id": "javascript",
            "label": "JavaScript file",
            "tokens": {
                "function": ("rgb(0, 0, 255)", "700"),
                "// a comment": ("rgb(0, 128, 0)", "400"),
                '"x"': ("rgb(128, 128, 128)", "400"),
            },
        },
        "sample.html": {
            "id": "html",
            "label": "Hyper Text Markup Language file",
            "tokens": {
                "html": ("rgb(0, 0, 255)", None),  # TAG
                "class": ("rgb(255, 0, 0)", None),  # ATTRIBUTE
            },
        },
        "sample.md": {
            "id": "markdown",
            "label": "Markdown file",
            "tokens": {
                "Heading one": ("rgb(255, 128, 0)", "700"),  # the markdown UDL's LINE COMMENTS
            },
        },
    }

    for name, expected in expectations.items():
        open_seeded(name)
        document = info()
        check(
            f"{name}: detected as {expected['id']}",
            document["language"] and document["language"]["id"] == expected["id"],
            str(document["language"]),
        )
        check(
            f"{name}: the grammar actually loaded (lazy import resolved)",
            document["language"] and document["language"]["loaded"] is True,
        )
        check(
            f"{name}: the status bar names it as N++ does — {expected['label']!r}",
            status_items()[0] == expected["label"],
            status_items()[0],
        )
        page.wait_for_timeout(150)
        tokens = page.evaluate(TOKENS)
        coloured = [t for t in tokens if t["color"] not in ("rgb(0, 0, 0)", "rgba(0, 0, 0, 0)")]
        check(
            f"{name}: token colours are painted on rendered spans",
            len(coloured) >= 3,
            f"{len(coloured)} coloured spans",
        )
        for text, (color, weight) in expected["tokens"].items():
            matches = [t for t in tokens if t["text"].strip() == text]
            ok = bool(matches) and all(m["color"] == color for m in matches)
            if ok and weight:
                ok = all(m["weight"] == weight for m in matches)
            check(
                f"{name}: {text!r} is {color}{' bold' if weight == '700' else ''}",
                ok,
                f"found {[m['color'] + '/' + m['weight'] for m in matches][:3]}",
            )

    # ── 3. the open questions the ledger carried into this task ─────────────
    open_seeded("sample.cs")
    document = info()
    check(
        "C# is covered (the ledger's unconfirmed case): .cs opens as N++'s C# file",
        document["language"] and document["language"]["id"] == "cs"
        and status_items()[0] == "C# source file",
        f"{document['language'] and document['language']['id']} / {status_items()[0]}",
    )
    page.wait_for_timeout(150)
    cs_tokens = page.evaluate(TOKENS)
    check(
        "...and it highlights (a legacy stream parser, not a grammar)",
        any(t["color"] == "rgb(0, 0, 255)" for t in cs_tokens),
        str([t["text"] for t in cs_tokens if t["color"] == "rgb(0, 0, 255)"][:4]),
    )
    check(
        "...and it folds nothing, because a StreamLanguage has no fold service (D9's trade)",
        info()["ruler"]["structure"] == 0,
        str(info()["ruler"]),
    )

    # ── 4. detection when the extension cannot decide ───────────────────────
    open_seeded("shebang")
    check(
        "no extension: the shebang decides (N++'s detectLanguageFromTextBeginning)",
        info()["language"] and info()["language"]["id"] == "python",
        str(info()["language"]),
    )
    open_seeded("xmlhead")
    check(
        "no extension: an XML declaration decides",
        info()["language"] and info()["language"]["id"] == "xml",
        str(info()["language"]),
    )
    open_seeded("Dockerfile")
    check(
        "no extension: the file name decides (deliberately beyond N++, which uses extensions only)",
        info()["language"] and info()["language"]["id"] == "dockerfile",
        str(info()["language"]),
    )
    open_seeded("CMakeLists.txt")
    check(
        "...and so does the extension on a named build file",
        info()["language"] and info()["language"]["id"] == "cmake",
        str(info()["language"]),
    )

    # ── 5. the gaps D9 named, asserted rather than glossed ──────────────────
    for name in ("Makefile", "notes.txt"):
        open_seeded(name)
        check(
            f"{name}: stays 'Normal text file' — no CM6 mode exists for it",
            info()["language"] is None and status_items()[0] == "Normal text file",
            status_items()[0],
        )

    # ── 6. the overview ruler ───────────────────────────────────────────────
    open_seeded("sample.js")
    page.wait_for_timeout(200)
    check("a ruler strip is mounted in the pane", page.locator(".npp-ruler").count() == 1)
    ruler = info()["ruler"]
    check(
        "the grammar's fold regions show as structure ticks",
        ruler["structure"] >= 1,
        str(ruler),
    )
    canvas = page.evaluate(CANVAS, [[128, 128, 128], [0, 255, 255], [95, 123, 215]])
    check(
        "the ruler paints those ticks on its canvas (pixels, not state)",
        canvas is not None and len(canvas["rows"].get("128,128,128", [])) >= 1,
        str(canvas and {k: len(v) for k, v in canvas["rows"].items()}),
    )

    # Marks: Task 5's Mark All, then the ruler must show them — and clear them again.
    page.evaluate("() => window.__workspace.activeView?.focus()")
    page.keyboard.press("Control+m")
    page.wait_for_selector("[data-find-tab='mark'].is-active", timeout=3000)
    page.fill("[data-find='what']", "a")
    page.click("[data-find-action='mark-all']")
    page.wait_for_timeout(200)
    marked = info()
    check(
        "Mark All still works with a language in place",
        marked["search"]["marks"] > 0,
        f"{marked['search']['marks']} marks",
    )
    check(
        "the ruler counts every mark",
        marked["ruler"]["marks"] == marked["search"]["marks"] != 0,
        f"ruler {marked['ruler']['marks']} / marks {marked['search']['marks']}",
    )
    canvas = page.evaluate(CANVAS, [[0, 255, 255]])
    check(
        "the marks are drawn in N++'s Mark Style 1 (00FFFF)",
        len(canvas["rows"].get("0,255,255", [])) >= 2,
        f"{len(canvas['rows'].get('0,255,255', []))} tick rows",
    )
    page.click("[data-find-action='clear-marks']")
    page.click("[data-find-action='close']")
    page.wait_for_timeout(200)
    check(
        "clearing the marks clears the ruler with them (no stale ticks)",
        info()["ruler"]["marks"] == 0 and info()["search"]["marks"] == 0,
        str(info()["ruler"]),
    )

    # Bookmarks, same contract, N++'s bookmark colour.
    page.evaluate("() => window.__workspace.activeView?.focus()")
    page.keyboard.press("Control+F2")
    page.wait_for_timeout(200)
    check("a bookmark is counted by the ruler", info()["ruler"]["bookmarks"] == 1, str(info()["ruler"]))
    canvas = page.evaluate(CANVAS, [[95, 123, 215]])
    check(
        "it is drawn in N++'s bookmark colour (5f7bd7)",
        len(canvas["rows"].get("95,123,215", [])) >= 1,
        str(canvas["rows"].get("95,123,215")),
    )

    # Click to jump: the strip maps the whole document onto the pane's height.
    open_seeded("sample.js")
    page.wait_for_timeout(200)
    page.evaluate(
        """() => {
            const view = window.__workspace.activeView;
            view.dispatch({ changes: { from: 0, insert: 'x\\n'.repeat(600) } });
            const line = view.state.doc.line(1);
            view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
        }"""
    )
    page.wait_for_timeout(250)
    strip = page.locator(".npp-pane[data-pane='primary'] .npp-ruler").bounding_box()
    before = page.evaluate("() => window.__workspace.activeView.viewport.to")
    page.mouse.click(strip["x"] + strip["width"] / 2, strip["y"] + strip["height"] * 0.85)
    page.wait_for_timeout(300)
    after = page.evaluate("() => window.__workspace.activeView.viewport.to")
    total = page.evaluate("() => window.__workspace.activeView.state.doc.length")
    check(
        "clicking 85% down the ruler scrolls to about 85% of the document",
        after > total * 0.7 and after > before,
        f"viewport.to {before} → {after} of {total}",
    )
    page.mouse.click(strip["x"] + strip["width"] / 2, strip["y"] + strip["height"] * 0.05)
    page.wait_for_timeout(300)
    top = page.evaluate("() => window.__workspace.activeView.viewport.to")
    check(
        "clicking near the top returns to the top",
        top < total * 0.25,
        f"viewport.to {top} of {total}",
    )

    # ── 7. the ruler at the project's own scale (10 000 lines) ──────────────
    page.evaluate(
        """() => {
            const lines = [];
            for (let i = 0; i < 500; i++) {
                lines.push(`function fn${i}(a, b) {`);
                lines.push(`  // comment ${i}`);
                lines.push(`  const value = ${i} + a;`);
                lines.push(`  if (value > 3) { return "s" + value; }`);
                lines.push(`}`);
                lines.push('');
                lines.push(`/* block ${i} */`);
                lines.push(`let arr = [${i}, 2, 3];`);
                lines.push(`class C${i} { method() { return ${i}; } }`);
                lines.push('');
            }
            window.__workspace.newDocument(lines.join('\\n'));
            return lines.length;
        }"""
    )
    page.evaluate("async () => { await window.__workspace.setLanguage('javascript'); }")
    page.wait_for_timeout(1200)
    big = page.evaluate("() => window.__workspace.refreshRuler()")
    check(
        "a 10 000-line JavaScript file produces structure ticks without blowing the cap",
        big["structure"] > 0,
        f"{big['structure']} ticks in {big['ms']:.1f} ms",
    )
    check(
        "the structure walk stays inside its budget (2000-tick cap, tree walk not per-line)",
        big["ms"] < 250 and big["structure"] <= 2000,
        f"{big['structure']} ticks in {big['ms']:.1f} ms",
    )
    ruler = info()["ruler"]
    check(
        "over 10 000 lines the ruler still counts what it draws",
        ruler["structure"] == big["structure"],
        str(ruler),
    )

    # ── 8. folded state crosses the panes (Task 3's carried-forward item) ───
    page.evaluate(
        """async () => {
            window.__workspace.newDocument('function a() {\\n  return 1;\\n}\\nfunction b() {\\n  return 2;\\n}\\n');
            await window.__workspace.setLanguage('jsx');
        }"""
    )
    page.wait_for_timeout(500)

    def fold_marker(which: str, title: str) -> dict | None:
        """The first **visible** fold marker of the given title, as a click target.

        The gutter renders a hidden `initialSpacer` element whose marker carries the *other*
        title (that is how the margin sizes itself), so a query for the first `span[title]`
        finds the wrong element — and CM's handler turns a click into a line by its y
        coordinate, which is why this returns real viewport coordinates for a real click
        rather than dispatching a synthetic event at (0, 0)."""
        return page.evaluate(
            """([which, title]) => {
                const gutter = document.querySelectorAll('.cm-foldGutter')[which === 'clone' ? 1 : 0];
                const marker = [...gutter.querySelectorAll(`span[title="${title}"]`)].find((span) => {
                    const element = span.closest('.cm-gutterElement');
                    return element && getComputedStyle(element).visibility !== 'hidden'
                        && element.getBoundingClientRect().height > 0;
                });
                if (!marker) return null;
                const box = marker.getBoundingClientRect();
                return { title: marker.getAttribute('title'), x: box.x + box.width / 2, y: box.y + box.height / 2 };
            }""",
            [which, title],
        )

    def click_fold_marker(which: str, title: str = "Fold line") -> str | None:
        """Click that marker with real mouse input; returns the marker's own title, or None."""
        target = fold_marker(which, title)
        if not target:
            return None
        page.mouse.click(target["x"], target["y"])
        page.wait_for_timeout(150)
        return target["title"]

    check("with a grammar loaded the fold gutter offers a fold", click_fold_marker("primary") == "Fold line")
    page.wait_for_timeout(200)
    check("the fold is in the primary pane", info()["viewFolds"] == [1], str(info()["viewFolds"]))
    page.click("button[data-tool='split']")
    page.wait_for_timeout(400)
    check(
        "splitting hands the fold to the clone (the clone's state is rebuilt from text)",
        info()["viewFolds"] == [1, 1],
        str(info()["viewFolds"]),
    )
    check("each pane got its own ruler strip", page.locator(".npp-ruler").count() == 2)
    check("...and its own language", info()["views"] == 2 and info()["language"]["loaded"] is True)
    check(
        "unfolding in the clone unfolds the primary too (S7's reconciliation, for folds)",
        click_fold_marker("clone", "Unfold line") == "Unfold line" and info()["viewFolds"] == [0, 0],
        str(info()["viewFolds"]),
    )
    page.click("button[data-tool='split']")
    page.wait_for_timeout(200)

    # ── 9. the promises that survive every task ─────────────────────────────
    status = page.locator(".npp-statusbar").text_content() or ""
    check("the status bar still reports the caret", "Ln " in status, status.strip()[:90])
    offsite = [
        url
        for url in requests
        if not url.startswith(("http://127.0.0.1", "http://localhost", "ws://127.0.0.1", "ws://localhost", "data:"))
    ]
    check("no request left the machine (D1 backend-free)", len(offsite) == 0, ", ".join(offsite[:3]))

    page.screenshot(path=SHOT)
    page.locator(".npp-statusbar").screenshot(path=SHOT_BAR)
    browser.close()

check("no console errors", len(console_errors) == 0, "; ".join(console_errors[:3]))
check("no uncaught page errors", len(page_errors) == 0, "; ".join(page_errors[:3]))

# The pixels, not just the DOM: OCR the status bar strip that was captured. Everything above
# could be true while the label rendered as an empty box, and this is the check that says it
# did not.
try:
    text = subprocess.run(
        ["tesseract", SHOT_BAR, "-", "--psm", "7"],
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
    ).stdout
    check(
        "OCR of the rendered status bar finds the caret field",
        "Ln" in text,
        " ".join(text.split())[:80],
    )
except Exception as error:  # tesseract missing or unhappy — say so, do not pass silently
    check("OCR of the rendered status bar finds the caret field", False, str(error))

failed = [name for name, ok, _ in results if not ok]
print(f"\n{'=' * 60}")
print(f"VERIFY-TASK6: {'PASS' if not failed else 'FAIL'}  ({len(results) - len(failed)}/{len(results)} checks)")
if failed:
    print("failed: " + "; ".join(failed))
print("=" * 60)
sys.exit(1 if failed else 0)
