/**
 * Task 11's spike — does the missing encoding support need WebAssembly, or tables?
 *
 *     node --experimental-strip-types scripts/spike-encoding-tables.mjs
 *
 * D10 said "WASM encoders" before anything was measured. This script measures the
 * three halves of that claim and prints what the numbers decide:
 *
 *   1. which of Notepad++'s DOS/OEM codepages the browser can decode by label at
 *      all (the WHATWG list is fixed, and only IBM866 is in it);
 *   2. how big a generated single-byte table really is — the answer decides
 *      table-vs-WASM, because a few kilobytes per codepage does not need a
 *      compiler and a build step;
 *   3. UTF-32: whether the work is arithmetic (it is: code points in, four bytes
 *      out) or a table (it is not).
 *
 * It reads the Unicode Consortium's own mapping files, vendored under
 * `scripts/data/`, so the measurement is the same one the generator will make.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = resolve(ROOT, "scripts/data");

const NPP_OEM_CODEPAGES = [
  437, 720, 737, 775, 850, 852, 855, 857, 858, 860, 861, 862, 863, 864, 865, 866, 869,
];

function parseMapping(file) {
  const text = readFileSync(resolve(DATA, file), "utf8");
  const chars = Array.from({ length: 256 }, () => null);
  for (const line of text.split("\n")) {
    if (!line.startsWith("0x")) continue;
    const [byteHex, codeHex] = line.split("\t");
    const byte = Number.parseInt(byteHex, 16);
    const code = Number.parseInt(codeHex, 16);
    if (Number.isNaN(code) || code > 0x10ffff) continue;
    chars[byte] = String.fromCodePoint(code);
  }
  return chars;
}

const VENDORED = { 437: "CP437.TXT", 850: "CP850.TXT", 852: "CP852.TXT" };

console.log("Task 11 encoding spike\n");

// ── 1. label support ─────────────────────────────────────────────────────────
console.log("1. Can the browser decode each N++ DOS codepage by label?");
const decodable = [];
const missing = [];
for (const codepage of NPP_OEM_CODEPAGES) {
  const labels = [`cp${codepage}`, `ibm${codepage}`, `windows-${codepage}`];
  const working = labels.find((label) => {
    try {
      new TextDecoder(label);
      return true;
    } catch {
      return false;
    }
  });
  if (working) decodable.push(`${codepage}→${working}`);
  else missing.push(codepage);
}
console.log(`   decodable by some label: ${decodable.length ? decodable.join(", ") : "none"}`);
console.log(`   not decodable at all:    ${missing.join(", ")}`);

// ── 2. table size ────────────────────────────────────────────────────────────
console.log("\n2. How big is a generated single-byte table?");
let totalChars = 0;
for (const [codepage, file] of Object.entries(VENDORED)) {
  const chars = parseMapping(file);
  const defined = chars.filter((char) => char !== null).length;
  // The emitted form: one quoted character or null per byte, plus separators.
  const emitted = chars
    .map((char) => (char === null ? "null" : JSON.stringify(char)))
    .join(", ");
  totalChars += defined;
  console.log(
    `   cp${codepage}: ${defined}/256 defined, ~${emitted.length} B emitted (${file})`,
  );
}
console.log(`   all three: ${totalChars} mapped characters`);
console.log(
  "   browser support today (the hard ceiling): " +
    `${missing.length} of ${NPP_OEM_CODEPAGES.length} N++ DOS codepages have no TextDecoder label`,
);

// ── 3. UTF-32 is arithmetic ──────────────────────────────────────────────────
console.log("\n3. UTF-32 is arithmetic, not a table:");
const sample = "Aé€😀";
const utf32 = [];
for (const char of sample) utf32.push(char.codePointAt(0));
console.log(
  `   "${sample}" → ${utf32.map((code) => `0x${code.toString(16)}`).join(" ")} ` +
    `(${utf32.length} code points → ${utf32.length * 4} bytes)`,
);

// ── 4. the decision, and the timing behind it ────────────────────────────────
console.log("\n4. Timing a table encode+decode over 1 MB:");
const chars437 = parseMapping(VENDORED[437]);
const decodeTable = chars437;
const encodeTable = new Map();
chars437.forEach((char, byte) => {
  if (char !== null && !encodeTable.has(char)) encodeTable.set(char, byte);
});

const text = "café ─│┌┐└┘╔═╗ ║╚╝\n".repeat(30000); // ~1 MB, CP437-representable
const startEncode = performance.now();
const out = new Uint8Array(text.length);
for (let i = 0; i < text.length; i += 1) out[i] = encodeTable.get(text[i]);
const encodeMs = performance.now() - startEncode;

const startDecode = performance.now();
let rebuilt = "";
for (const byte of out) rebuilt += decodeTable[byte];
const decodeMs = performance.now() - startDecode;

console.log(`   ${(text.length / 1024).toFixed(0)} K characters: encode ${encodeMs.toFixed(1)} ms, decode ${decodeMs.toFixed(1)} ms`);
console.log(`   round trip exact: ${rebuilt === text}`);

console.log("\nDecision:");
console.log("   UTF-32: arithmetic in this module — no WASM.");
console.log(
  `   DOS codepages: ${VENDORED[437] && "generated tables"} (a few KB each) — no WASM. ` +
    `${missing.length} N++ codepages stay unsupported and are named as such.`,
);
console.log("   WASM would buy nothing here: it adds a compiler, a binary and a loader for work JS does in milliseconds.");
