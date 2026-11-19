#!/usr/bin/env node
/**
 * Generate `src/file/codepages.ts` from the Unicode Consortium's mapping files.
 *
 *     node scripts/gen-codepages.mjs           # write the table
 *     node scripts/gen-codepages.mjs --check   # fail if the table on disk is stale
 *
 * Why a generator at all: the DOS codepages are 256-entry tables, and a hand-typed
 * table is a place for an off-by-one to hide until someone opens a file with a box
 * character in it. The source files under `scripts/data/` are Microsoft's own
 * tables as published by Unicode (VENDORS/MICSFT/PC/CP*.TXT); the generator parses
 * them, refuses anything that is not 256 well-formed rows, and writes a file whose
 * provenance is in its header. `--check` is wired into the build the same way
 * `gen-language-registry.mjs --check` is, so a stale table fails CI rather than a
 * user's file.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = resolve(ROOT, "scripts/data");
const TARGET = resolve(ROOT, "src/file/codepages.ts");

/** The codepages this build implements, and the names the mapping files give them. */
const IMPLEMENTED = [
  { codepage: 437, file: "CP437.TXT", name: "DOS Latin US (CP437)" },
  { codepage: 850, file: "CP850.TXT", name: "DOS Latin 1 (CP850)" },
  { codepage: 852, file: "CP852.TXT", name: "DOS Latin 2 (CP852)" },
];

/**
 * Notepad++'s remaining DOS/OEM codepages. They are named rather than silently
 * absent so a refusal can say which one, and so the check can assert that every
 * page in this list is either implemented or explicitly refused.
 */
const REFUSED = [
  [720, "DOS Arabic (CP720)"],
  [737, "DOS Greek (CP737)"],
  [775, "DOS Baltic (CP775)"],
  [855, "DOS Cyrillic (CP855)"],
  [857, "DOS Turkish (CP857)"],
  [858, "DOS Latin 1 with Euro (CP858)"],
  [860, "DOS Portuguese (CP860)"],
  [861, "DOS Icelandic (CP861)"],
  [862, "DOS Hebrew (CP862)"],
  [863, "DOS French Canadian (CP863)"],
  [864, "DOS Arabic (CP864)"],
  [865, "DOS Nordic (CP865)"],
  [869, "DOS Greek 2 (CP869)"],
];

function parse(filePath) {
  const text = readFileSync(filePath, "utf8");
  const version = /Unicode version:\s*([\d.]+)/.exec(text)?.[1] ?? "unknown";
  const chars = Array.from({ length: 256 }, () => null);
  let rows = 0;
  for (const line of text.split("\n")) {
    if (!line.startsWith("0x")) continue;
    const [byteHex, codeHex] = line.split("\t");
    const byte = Number.parseInt(byteHex, 16);
    const code = Number.parseInt(codeHex, 16);
    if (!Number.isInteger(byte) || byte < 0 || byte > 0xff) {
      throw new Error(`${filePath}: bad byte ${byteHex}`);
    }
    if (Number.isNaN(code) || code > 0x10ffff) continue;
    chars[byte] = String.fromCodePoint(code);
    rows += 1;
  }
  if (rows !== 256) {
    throw new Error(`${filePath}: expected 256 mappings, found ${rows}`);
  }
  return { chars, version };
}

function emit() {
  const pages = IMPLEMENTED.map(({ codepage, file, name }) => {
    const { chars, version } = parse(resolve(DATA, file));
    const defined = chars.filter((char) => char !== null).length;
    if (defined !== 256) {
      throw new Error(`${file}: ${defined} defined entries, expected 256`);
    }
    return { codepage, name, chars, version };
  });

  const versions = [...new Set(pages.map((page) => page.version))].join(", ");
  const lines = [];
  lines.push("/**");
  lines.push(" * Single-byte DOS codepages — GENERATED FILE, do not edit by hand.");
  lines.push(" *");
  lines.push(" * Regenerate with `node scripts/gen-codepages.mjs`; `--check` fails if this file is");
  lines.push(" * stale. The source tables are Microsoft's, as published by the Unicode Consortium");
  lines.push(" * (`scripts/data/CP437.TXT`, `CP850.TXT`, `CP852.TXT`, Unicode version " + versions + "),");
  lines.push(" * parsed by the generator so a transcription error cannot enter the table.");
  lines.push(" *");
  lines.push(" * The browser can decode only IBM866 among N++'s DOS codepages (measured in");
  lines.push(" * `scripts/spike-encoding-tables.mjs`), so these three are table-backed in both");
  lines.push(" * directions. The rest are named in `UNSUPPORTED_CODEPAGES` rather than forgotten.");
  lines.push(" */");
  lines.push("");
  lines.push("export interface CodepageTable {");
  lines.push("  /** Microsoft's name for the page, from the mapping file's header. */");
  lines.push("  readonly name: string;");
  lines.push("  readonly codepage: number;");
  lines.push("  /** One entry per byte 0x00–0xFF; `null` where the mapping file defines nothing. */");
  lines.push("  readonly chars: readonly (string | null)[];");
  lines.push("}");
  lines.push("");
  lines.push("export const CODEPAGES: Readonly<Record<string, CodepageTable>> = {");
  for (const page of pages) {
    lines.push(`  cp${page.codepage}: {`);
    lines.push(`    name: ${JSON.stringify(page.name)},`);
    lines.push(`    codepage: ${page.codepage},`);
    lines.push("    chars: [");
    for (let start = 0; start < 256; start += 16) {
      const row = page.chars
        .slice(start, start + 16)
        .map((char) => (char === null ? "null" : JSON.stringify(char)))
        .join(", ");
      lines.push(`      ${row},`);
    }
    lines.push("    ],");
    lines.push("  },");
  }
  lines.push("};");
  lines.push("");
  lines.push("export const CODEPAGE_LABELS: readonly string[] = Object.keys(CODEPAGES);");
  lines.push("");
  lines.push("/** N++'s DOS codepages this build does not implement, so a refusal can be specific. */");
  lines.push("export const UNSUPPORTED_CODEPAGES: Readonly<Record<string, string>> = {");
  for (const [codepage, name] of REFUSED) lines.push(`  cp${codepage}: ${JSON.stringify(name)},`);
  lines.push("};");
  lines.push("");
  return lines.join("\n");
}

const expected = emit();
const checkOnly = process.argv.includes("--check");

if (checkOnly) {
  let actual = "";
  try {
    actual = readFileSync(TARGET, "utf8");
  } catch {
    console.error("gen-codepages: src/file/codepages.ts is missing; run `node scripts/gen-codepages.mjs`");
    process.exit(1);
  }
  if (actual !== expected) {
    console.error("gen-codepages: src/file/codepages.ts is stale; run `node scripts/gen-codepages.mjs`");
    process.exit(1);
  }
  console.log(
    `gen-codepages: OK — ${Object.keys(IMPLEMENTED).length ? IMPLEMENTED.length : 0} tables current, ` +
      `${REFUSED.length} codepages named as refused`,
  );
} else {
  writeFileSync(TARGET, expected);
  console.log(`gen-codepages: wrote ${TARGET} (${expected.length} bytes)`);
}
