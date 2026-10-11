/**
 * Language registry checks — Task 6, no browser needed.
 *
 *     node --experimental-strip-types scripts/test-languages.mjs
 *
 * Three things this proves that a browser check cannot prove cheaply:
 *
 *   1. **Every loader works.** All 140 languages are imported for real, in Node, and each has
 *      to yield a usable CodeMirror extension. A typo in the generated table — or a parser the
 *      package stopped exporting — fails here rather than the first time a user opens a `.go`
 *      file.
 *   2. **Detection is what N++ does.** The extension table, the file-name rule and the ported
 *      `detectLanguageFromTextBeginning` are all exercised against a table of cases, including
 *      the ordering quirks (a shebang containing "sh" wins; `<?` only after `<?php`/`<?xml`).
 *   3. **The gaps are the ones we claim.** makefile / batch / INI have no CM6 mode, so those
 *      files stay "Normal text file" — asserted, not assumed.
 */
import assert from "node:assert/strict";

const registry = await import("../src/languages/registry.ts");
const { LANGUAGES, PLAIN_TEXT, detectLanguage, languageStats, languagesByName, byId, FILENAMES } =
  registry;
const { StreamLanguage, Language, LanguageSupport } = await import("@codemirror/language");

let failures = 0;
let checks = 0;

function check(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  [${detail}]` : ""}`);
}

function equal(name, actual, expected) {
  check(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

/* ── §1 the registry ──────────────────────────────────────────────────────────────── */

const stats = languageStats();
equal("first-class languages (27 rows from the 22 official packages)", stats.firstClass, 27);
equal("legacy stream languages", stats.legacy, 113);
equal("registry total", stats.total, 140);
check("every id is unique", new Set(LANGUAGES.map((l) => l.id)).size === LANGUAGES.length);
check(
  "every first-class language comes from a @codemirror/lang-* package",
  LANGUAGES.filter((l) => l.firstClass).every((l) => l.origin.startsWith("@codemirror/lang-")),
);
check(
  "every legacy language names its mode file and exported parser",
  LANGUAGES.filter((l) => !l.firstClass).every((l) => /mode\/.+\.js → \w+$/.test(l.origin)),
);
check("N++'s fallback name is the registry's", PLAIN_TEXT.label === "Normal text file");
check(
  "every FILENAMES target resolves to a real language",
  Object.entries(FILENAMES).every(([name, id]) => byId(id) !== undefined),
  Object.entries(FILENAMES)
    .filter(([, id]) => byId(id) === undefined)
    .map(([name]) => name)
    .join(" ") || "all resolve",
);
check("no two languages claim the same id", new Set(LANGUAGES.map((l) => l.id)).size === 140);
check("the menu order sorts by N++'s short name", (() => {
  const names = languagesByName().map((l) => l.name.toLowerCase());
  return names.every((name, index) => index === 0 || names[index - 1] <= name);
})());

/* ── §2 every loader resolves ────────────────────────────────────────────────────── */

const loaded = [];
for (const language of LANGUAGES) {
  try {
    const extension = await language.load();
    // Two shapes are correct here: a first-class package hands back a `LanguageSupport`
    // (which wraps a grammar), a legacy port a `StreamLanguage` (which *is* a Language).
    const usable = extension instanceof LanguageSupport || extension instanceof Language;
    check(
      `load ${language.id} (${language.origin})`,
      usable,
      extension instanceof LanguageSupport ? extension.language.name : extension.name,
    );
    loaded.push({ id: language.id, name: extension?.language?.name ?? extension?.name ?? "" });
  } catch (error) {
    check(`load ${language.id} (${language.origin})`, false, String(error));
  }
}
equal("all languages loaded", loaded.length, LANGUAGES.length);

// Five legacy parsers ship without a `name`, which `StreamLanguage.define` copies through as
// "". Harmless — the UI names languages from this registry (N++'s own names), never from
// CodeMirror — but it is a fact about the long tail worth pinning rather than discovering.
const unnamed = loaded.filter((language) => language.name === "").map((language) => language.id);
equal("legacy parsers with no CodeMirror language name", unnamed.join(","), "dockerfile,ocaml,fsharp,sml,pug");

check(
  "the C# port is a StreamLanguage, not a grammar",
  (await byId("cs").load()) instanceof StreamLanguage,
);
check(
  "Python is a real grammar, not a StreamLanguage",
  !((await byId("python").load()) instanceof StreamLanguage),
);

/* ── §3 detection by extension ───────────────────────────────────────────────────── */

const extensionCases = [
  ["main.js", "javascript"],
  ["m.mjs", "javascript"],
  ["app.jsx", "jsx"],
  ["types.ts", "typescript"],
  ["view.tsx", "tsx"],
  ["script.py", "python"],
  ["page.html", "html"],
  ["README.md", "markdown"],
  ["notes.markdown", "markdown"],
  ["style.css", "css"],
  ["data.json", "json"],
  ["conf.yml", "yaml"],
  ["conf.yaml", "yaml"],
  ["run.sh", "shell"],
  ["Program.cs", "cs"],
  ["App.vue", "vue"],
  ["lib.rs", "rust"],
  ["main.go", "go"],
  ["Main.java", "java"],
  ["main.cpp", "cpp"],
  ["main.c", "c"],
  ["header.h", "cpp"],
  ["index.php", "php"],
  ["query.sql", "sql"],
  ["query.tsql", "mssql"],
  ["CMakeLists.cmake", "cmake"],
  ["Cargo.toml", "toml"],
  ["Dockerfile.dockerfile", "dockerfile"],
  ["gradle.groovy", "groovy"],
  ["app.rb", "ruby"],
  ["init.lua", "lua"],
  ["Main.hs", "haskell"],
  ["x.scala", "scala"],
  ["x.kt", "kotlin"],
  ["x.dart", "dart"],
  ["style.scss", "sass"],
  ["vars.less", "less"],
  ["x.pl", "perl"],
  ["x.ex?no", null],
  ["UPPER.JS", "javascript"],
  ["archive.tar.gz", null],
];

for (const [fileName, expected] of extensionCases) {
  const actual = detectLanguage(fileName, "")?.id ?? null;
  equal(`extension: ${fileName} → ${expected ?? "Normal text file"}`, actual, expected);
}

/* ── §4 the collisions, named ────────────────────────────────────────────────────── */

// These extensions are claimed twice in N++'s table (or by a language N++ does not have), so
// what wins is a decision. N++ resolves them by its own language-table order (walked
// backwards, Parameters.cpp:4464); this registry resolves them by the order of LANGUAGES.
const collisions = [
  [".m", "matlab"], // N++: matlab ext="m", objc ext="mm" — MATLAB takes .m
  [".mm", "objc"], // N++'s Objective-C extension; Objective-C++ has none
  [".pp", "pascal"], // N++ gives Pascal both .pas and .pp
  [".s", "r"], // N++ really does list "s" in R's exts (r s splus)
  [".cs", "cs"],
  [".ts", "typescript"],
  [".vue", "vue"], // N++ would say JavaScript; the Vue grammar is better (DEVIATIONS_FROM_NPP)
  [".pyx", "python"], // N++ puts pyx in Python's list; legacy Cython also claims it
];
for (const [extension, expected, note] of collisions) {
  equal(`collision: ${extension} → ${expected}${note ? ` (${note})` : ""}`, detectLanguage(`f${extension}`, "")?.id ?? null, expected);
}

/* ── §5 detection by file name (beyond N++) ──────────────────────────────────────── */

equal("Dockerfile → dockerfile", detectLanguage("Dockerfile", "")?.id ?? null, "dockerfile");
equal("CMakeLists.txt → cmake", detectLanguage("CMakeLists.txt", "")?.id ?? null, "cmake");
equal("Rakefile → ruby", detectLanguage("Rakefile", "")?.id ?? null, "ruby");
check("an extension beats a file name", detectLanguage("Dockerfile.js", "")?.id === "javascript");

/* ── §6 detection by content — N++'s own rules ───────────────────────────────────── */

const contentCases = [
  ["#!/bin/sh\nls\n", "shell"],
  ["#!/usr/bin/env python3\nprint(1)\n", "python"],
  ["#!/usr/bin/perl\n", "perl"],
  ["#!/usr/bin/php\n", "php"],
  ["#!/usr/bin/ruby\n", "ruby"],
  ["#!/usr/bin/env node\n", "javascript"],
  ["#!/usr/bin/fish\n", "shell"], // substring "sh" — N++'s order, faithfully reproduced
  ["\n\n\t  #!/bin/bash\n", "shell"], // leading whitespace is skipped
  ["  <?xml version=\"1.0\"?>\n", "xml"],
  ["<?php echo 1;\n", "php"],
  ["<html><body>\n", "html"],
  ["<!DOCTYPE html>\n", "html"],
  ["<? echo 1;\n", "php"], // `<?` last, as N++ insists
  [`#!${"x".repeat(45)}python\n`, null], // beyond the 40-character window: not a shebang match
  ["#!/usr/bin/env mysh\n", "shell"],
  ["plain text with no marker\n", null],
  ["#!/usr/bin/env\tsh\n", "shell"],
  ["", null],
  ["\n\n\n", null],
];
for (const [text, expected] of contentCases) {
  const actual = detectLanguage("no-extension", text)?.id ?? null;
  equal(`content: ${JSON.stringify(text.slice(0, 30))} → ${expected ?? "Normal text file"}`, actual, expected);
}

// The 40-character window and the first-line cut, straight from Buffer.cpp:1835-1843.
check(
  "only the first line matters",
  detectLanguage("x", "# not a shebang\n#!/bin/sh\n") === null,
);
check(
  "a pattern beyond the 40-character window is not seen",
  detectLanguage("x", `${"a".repeat(39)}<?xml\n`) === null,
);
check(
  "an extension decides before the content does",
  detectLanguage("file.py", "#!/bin/sh\n")?.id === "python",
);
check(
  "an extension nothing claims falls through to the content, as N++ does",
  detectLanguage("file.txt", "#!/bin/sh\n")?.id === "shell",
);

/* ── §7 the gaps, asserted ───────────────────────────────────────────────────────── */

for (const fileName of ["Makefile", "makefile", "GNUmakefile", "build.bat", "setup.bat", "desktop.ini", "app.jsonc", "schema.graphql"]) {
  equal(`no mode exists, so ${fileName} is "Normal text file"`, detectLanguage(fileName, "")?.id ?? null, null);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILED`);
  process.exit(1);
}
console.log("LANGUAGES: PASS");
