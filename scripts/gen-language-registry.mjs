#!/usr/bin/env node
/**
 * Generates `src/languages/legacy-modes.generated.ts` from the installed
 * `@codemirror/legacy-modes` package, and checks that the hand-written catalogue in
 * `src/languages/registry.ts` still accounts for **every** parser that package exports.
 *
 *   node --experimental-strip-types scripts/gen-language-registry.mjs            # write
 *   node --experimental-strip-types scripts/gen-language-registry.mjs --check    # verify only
 *
 * Why generate at all: 103 files export ~150 parsers, and a lazy loader is one line per
 * parser. Typing 150 `import()` thunks by hand is 150 chances to typo a symbol name that
 * only fails when a user opens that language. Generating them from the package itself, and
 * failing the check when the catalogue and the package disagree, is the same instrument as
 * `scripts/probe-reserved-keys.py`: measure the thing instead of asserting it.
 *
 * `--check` exits non-zero if
 *   - a parser the package exports is neither catalogued, superseded, nor a known non-language;
 *   - the catalogue references a parser the package does not export;
 *   - the generated file on disk is out of date.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODE_DIR = join(root, "node_modules/@codemirror/legacy-modes/mode");
const OUT = join(root, "src/languages/legacy-modes.generated.ts");
const checkOnly = process.argv.includes("--check");

/** Every parser a mode file exports, in a stable order. */
function exportsOf(file) {
  const source = readFileSync(join(MODE_DIR, file), "utf8");
  const found = [];
  for (const match of source.matchAll(
    /^export\s+(?:const|function|let|var)\s+([A-Za-z0-9_$]+)/gm,
  )) {
    found.push(match[1]);
  }
  for (const match of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of match[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) found.push(name);
    }
  }
  return found;
}

const files = readdirSync(MODE_DIR)
  .filter((name) => name.endsWith(".js"))
  .sort();
const parsers = [];
for (const file of files) {
  const base = file.replace(/\.js$/, "");
  for (const symbol of exportsOf(file)) parsers.push({ base, symbol, key: `${base}:${symbol}` });
}

const version = JSON.parse(
  readFileSync(join(root, "node_modules/@codemirror/legacy-modes/package.json"), "utf8"),
).version;

/** The generated source. `skip` holds the keys the catalogue calls "not a language". */
function render(skip) {
  const rows = parsers.filter((parser) => !skip.has(parser.key));
  const banner = `/**
 * GENERATED FILE — do not edit by hand.
 *
 *   node --experimental-strip-types scripts/gen-language-registry.mjs
 *
 * One lazy loader per parser exported by @codemirror/legacy-modes@${version} — ${parsers.length} of
 * them across ${files.length} mode files, read out of the package itself; the ${skip.size} the catalogue
 * classifies as something other than a language (factories, a keyword list) are left out. Nothing
 * here is imported until a document actually uses the language, so the whole long tail costs the
 * bundle nothing (decision D9).
 *
 * The thunks are typed \`unknown\` on purpose: these parsers are declared against
 * \`@codemirror/streamparser\`'s \`StreamParser\`, a package with its own \`StringStream\` class that
 * \`@codemirror/language\`'s copy is not structurally identical to. The one cast that bridges them
 * lives at the boundary in \`registry.ts\`, where \`StreamLanguage.define\` takes the parser — not
 * ${rows.length} times in this file.
 */
export const LEGACY_PARSERS: Readonly<Record<string, () => Promise<unknown>>> = {
`;
  const body = rows
    .map(
      ({ base, symbol, key }) =>
        `  ${JSON.stringify(key)}: () => import("@codemirror/legacy-modes/mode/${base}").then((m) => m.${symbol}),`,
    )
    .join("\n");
  const fileList = `\n/** Mode files the table was generated from, for the record. */\nexport const LEGACY_MODE_FILES: readonly string[] = [\n${files
    .map((file) => `  ${JSON.stringify(file.replace(/\.js$/, ""))},`)
    .join("\n")}\n];\n`;
  return `${banner}${body}\n};\n${fileList}`;
}

/* ── the check: catalogue vs package ─────────────────────────────────────────── */

// Two passes, because the catalogue is what decides which keys are languages and the catalogue
// imports this very file. Pass 1 lays down every parser — enough for the import below to
// resolve — and pass 2 writes the real table.
if (!checkOnly) writeFileSync(OUT, render(new Set()));

const { LANGUAGES, SUPERSEDED_BY_FIRST_CLASS, NOT_A_LANGUAGE } = await import(
  join(root, "src/languages/registry.ts")
);

const generated = render(new Set(Object.keys(NOT_A_LANGUAGE)));

const readOut = () => {
  try {
    return readFileSync(OUT, "utf8");
  } catch {
    return null;
  }
};

const catalogued = new Set(
  LANGUAGES.filter((language) => !language.firstClass).map((language) => {
    // "…/mode/shell.js → shell" → "shell:shell"
    const [, file, symbol] = /mode\/(.+)\.js → (.+)$/.exec(language.origin) ?? [];
    return `${file}:${symbol}`;
  }),
);

const byKey = new Set(parsers.map((parser) => parser.key));
const problems = [];

for (const { key } of parsers) {
  if (catalogued.has(key)) continue;
  if (SUPERSEDED_BY_FIRST_CLASS[key]) continue;
  if (NOT_A_LANGUAGE[key]) continue;
  problems.push(`not accounted for: ${key} (add it to registry.ts, or say why it is not a language)`);
}
for (const key of catalogued) {
  if (!byKey.has(key)) problems.push(`catalogued but not exported by the package: ${key}`);
}
for (const [key, reason] of [
  ...Object.entries(SUPERSEDED_BY_FIRST_CLASS),
  ...Object.entries(NOT_A_LANGUAGE),
]) {
  if (!byKey.has(key) && !reason.startsWith("n/a")) {
    problems.push(`listed as superseded/not-a-language but not exported: ${key}`);
  }
}

const onDisk = readOut();
if (!checkOnly && onDisk !== generated) writeFileSync(OUT, generated);
if (checkOnly && onDisk !== generated) problems.push("src/languages/legacy-modes.generated.ts is out of date");

const stats = {
  modeFiles: files.length,
  parsers: parsers.length,
  firstClass: LANGUAGES.filter((language) => language.firstClass).length,
  legacy: catalogued.size,
  superseded: Object.keys(SUPERSEDED_BY_FIRST_CLASS).length,
  notLanguages: Object.keys(NOT_A_LANGUAGE).length,
};

console.log("legacy-modes coverage");
for (const [label, value] of Object.entries(stats)) {
  console.log(`  ${label.padEnd(14)} ${value}`);
}
console.log(`  accounted      ${catalogued.size + stats.superseded + stats.notLanguages} of ${parsers.length}`);
console.log(`  registry total ${LANGUAGES.length} languages (${stats.firstClass} first-class + ${stats.legacy} legacy parsers)`);

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(checkOnly ? "\nGENERATOR: OK (no changes)" : "\nGENERATOR: OK (file written)");

// Keep the compiler honest about the file we just wrote.
if (!checkOnly) {
  try {
    execFileSync("npx", ["tsc", "--noEmit"], { cwd: root, stdio: "inherit" });
  } catch {
    console.error("typecheck failed after generation");
    process.exit(1);
  }
}
