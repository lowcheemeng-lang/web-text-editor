/**
 * Direct tests for the file-encoding layer — no browser, no framework.
 *
 * Run:  node --experimental-strip-types scripts/test-file-io.mjs
 * (or plain `node` on Node 22.18+, where type stripping is on by default)
 *
 * Why this exists: `src/file/file-io.ts` is pure logic, and encoding is where
 * silent data loss lives. A byte-order mark, a UTF-16 surrogate and a
 * windows-1252 round-trip are all things a browser acceptance test can only see
 * through the UI, so they are checked here at the byte level instead — exit 0
 * means every case below produced the exact bytes expected.
 */
import {
  bomBytes,
  canEncode,
  decodeFile,
  detectBom,
  encodeFile,
  normaliseEncodingLabel,
  toEditorLineEndings,
  toFileLineEndings,
} from "../src/file/file-io.ts";

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`FAIL  ${name}${detail ? `  [${detail}]` : ""}`);
  }
}

const bytesEqual = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const show = (u8) => Array.from(u8).map((b) => b.toString(16).padStart(2, "0")).join(" ");
const text = (s) => new TextEncoder().encode(s);

/* ---------------------------------------------------------------- BOM detect */

check("detects no BOM", detectBom(text("hello")) === "none");
check("detects UTF-8 BOM", detectBom(new Uint8Array([0xef, 0xbb, 0xbf, 0x41])) === "utf-8");
check("detects UTF-16LE BOM", detectBom(new Uint8Array([0xff, 0xfe, 0x41, 0x00])) === "utf-16le");
check("detects UTF-16BE BOM", detectBom(new Uint8Array([0xfe, 0xff, 0x00, 0x41])) === "utf-16be");
// Order matters: UTF-32LE's BOM begins with UTF-16LE's.
check("UTF-32LE BOM wins over UTF-16LE", detectBom(new Uint8Array([0xff, 0xfe, 0x00, 0x00])) === "utf-32le");
check("detects UTF-32BE BOM", detectBom(new Uint8Array([0x00, 0x00, 0xfe, 0xff])) === "utf-32be");

/* ------------------------------------------------------ UTF-8 round-trips */

const utf8Plain = "line one\nline two\n";
{
  const decoded = decodeFile(text(utf8Plain));
  check("UTF-8: decodes", decoded.text === utf8Plain, JSON.stringify(decoded.text));
  check("UTF-8: no BOM recorded", decoded.bom === "none");
  check("UTF-8: not assumed", decoded.assumed === false);
  const encoded = encodeFile(decoded.text, decoded);
  check("UTF-8: byte-identical round-trip", "bytes" in encoded && bytesEqual(encoded.bytes, text(utf8Plain)),
        "bytes" in encoded ? show(encoded.bytes) : encoded.problem);
}

{
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...text(utf8Plain)]);
  const decoded = decodeFile(withBom);
  check("UTF-8+BOM: strips the BOM from the text", decoded.text === utf8Plain, JSON.stringify(decoded.text.slice(0, 6)));
  check("UTF-8+BOM: records the BOM", decoded.bom === "utf-8");
  const encoded = encodeFile(decoded.text, decoded);
  check("UTF-8+BOM: byte-identical round-trip (BOM restored)",
        "bytes" in encoded && bytesEqual(encoded.bytes, withBom),
        "bytes" in encoded ? show(encoded.bytes.slice(0, 8)) : encoded.problem);
}

/* ---------------------------------------------------- UTF-16 round-trips */

{
  const utf16 = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0xe9, 0x00]); // "Aé" LE
  const decoded = decodeFile(utf16);
  check("UTF-16LE: decodes", decoded.text === "Aé", JSON.stringify(decoded.text));
  const encoded = encodeFile(decoded.text, decoded);
  check("UTF-16LE: byte-identical round-trip", "bytes" in encoded && bytesEqual(encoded.bytes, utf16),
        "bytes" in encoded ? show(encoded.bytes) : encoded.problem);
}

{
  const utf16be = new Uint8Array([0xfe, 0xff, 0x00, 0x41, 0xd8, 0x3d, 0xde, 0x00]); // "A😀" BE, surrogate pair
  const decoded = decodeFile(utf16be);
  check("UTF-16BE: decodes a surrogate pair", decoded.text === "A😀", JSON.stringify(decoded.text));
  const encoded = encodeFile(decoded.text, decoded);
  check("UTF-16BE: byte-identical round-trip of a surrogate pair",
        "bytes" in encoded && bytesEqual(encoded.bytes, utf16be),
        "bytes" in encoded ? show(encoded.bytes) : encoded.problem);
}

/* ------------------------------------------------- single-byte encodings */

{
  // windows-1252: é = 0xE9, — = 0x97, € = 0x80
  const win = new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x20, 0x97, 0x20, 0x80]);
  const decoded = decodeFile(win, "windows-1252");
  check("windows-1252: decodes", decoded.text === "café — €", JSON.stringify(decoded.text));
  const encoded = encodeFile(decoded.text, decoded);
  check("windows-1252: byte-identical round-trip", "bytes" in encoded && bytesEqual(encoded.bytes, win),
        "bytes" in encoded ? show(encoded.bytes) : encoded.problem);
}

{
  // ISO-8859-2 (Central European): ł = 0xB3, ó = 0xF3
  const iso = new Uint8Array([0xb3, 0xf3, 0x64, 0xba]); // "łódź"-ish
  const decoded = decodeFile(iso, "iso-8859-2");
  const encoded = encodeFile(decoded.text, decoded);
  check("iso-8859-2: byte-identical round-trip", "bytes" in encoded && bytesEqual(encoded.bytes, iso),
        "bytes" in encoded ? show(encoded.bytes) : encoded.problem);
}

{
  const koi = new Uint8Array([0xd0, 0xd2, 0xc1]); // KOI8-R "два"-ish
  const decoded = decodeFile(koi, "koi8-r");
  const encoded = encodeFile(decoded.text, decoded);
  check("koi8-r: byte-identical round-trip", "bytes" in encoded && bytesEqual(encoded.bytes, koi),
        "bytes" in encoded ? show(encoded.bytes) : encoded.problem);
}

/* ------------------------------------------------- the §6 alias trap */

check("iso-8859-1 folds to windows-1252", normaliseEncodingLabel("iso-8859-1") === "windows-1252");
check("latin1 folds to windows-1252", normaliseEncodingLabel("Latin1") === "windows-1252");
check("us-ascii folds to windows-1252", normaliseEncodingLabel("us-ascii") === "windows-1252");
{
  // 0x80 is undefined in real ISO-8859-1 but is € in windows-1252 — the trap,
  // made visible: the byte must decode as € because that is what browsers do.
  const decoded = decodeFile(new Uint8Array([0x80]), "iso-8859-1");
  check("0x80 decodes as € (windows-1252), not a C1 control", decoded.text === "€", JSON.stringify(decoded.text));
}

/* --------------------------------------------- refusals and honest edges */

{
  const utf32 = new Uint8Array([0xff, 0xfe, 0x00, 0x00, 0x41, 0x00, 0x00, 0x00]);
  const decoded = decodeFile(utf32);
  check("UTF-32: refused, not mojibake", decoded.unsupported !== null && decoded.text === "");
  check("UTF-32: refusal names the encoding", (decoded.unsupported ?? "").includes("UTF-32"));
}

{
  // 0xE9 alone is not valid UTF-8 — nothing identifies the encoding (D4: no autodetect).
  const decoded = decodeFile(new Uint8Array([0x63, 0x61, 0x66, 0xe9]));
  check("invalid UTF-8 with no BOM: opened as windows-1252", decoded.encoding === "windows-1252");
  check("invalid UTF-8 with no BOM: flagged as assumed", decoded.assumed === true);
  check("invalid UTF-8 with no BOM: still readable text", decoded.text === "café", JSON.stringify(decoded.text));
}

{
  const decoded = decodeFile(text("plain ascii"));
  check("valid UTF-8 with no BOM: not flagged as assumed", decoded.assumed === false);
}

{
  // A character windows-1252 cannot represent must be refused, not mangled.
  const decoded = decodeFile(new Uint8Array([0x41]), "windows-1252");
  const encoded = encodeFile("A你", decoded);
  check("unrepresentable char: refused", "problem" in encoded);
  check("unrepresentable char: names the character",
        "problem" in encoded && encoded.problem.includes("你"));
}

check("multi-byte legacy: cannot be encoded here", canEncode("shift_jis") === false);
check("single-byte legacy: can be encoded", canEncode("windows-1252") === true);
check("UTF-16 can be encoded", canEncode("utf-16le") === true);
{
  const decoded = decodeFile(new Uint8Array([0x41]), "shift_jis");
  const encoded = encodeFile("A", decoded);
  check("multi-byte legacy: save refused with an explanation", "problem" in encoded);
}

/* ------------------------------------------------------------ line endings */

check("EOL: LF", decodeFile(text("a\nb\n")).eol === "LF");
check("EOL: CRLF", decodeFile(text("a\r\nb\r\n")).eol === "CRLF");
check("EOL: CR", decodeFile(text("a\rb\r")).eol === "CR");
check("EOL: mixed is detected", decodeFile(text("a\r\nb\n")).eol === "mixed");

{
  const crlf = toFileLineEndings("a\nb\n", "CRLF");
  check("EOL: LF → CRLF on save", crlf === "a\r\nb\r\n", JSON.stringify(crlf));
  check("EOL: editor text is normalised to LF", toEditorLineEndings("a\r\nb\rc") === "a\nb\nc");
}

/* ------------------------------------------------- byte-identical CRLF+BOM */

{
  const crlfBom = new Uint8Array([0xef, 0xbb, 0xbf, ...text("line one\r\nline two\r\n")]);
  const decoded = decodeFile(crlfBom);
  const editorText = toEditorLineEndings(decoded.text);
  const back = encodeFile(toFileLineEndings(editorText, decoded.eol), decoded);
  check("CRLF+BOM: byte-identical through the editor's LF normalisation",
        "bytes" in back && bytesEqual(back.bytes, crlfBom),
        "bytes" in back ? show(back.bytes) : back.problem);
  check("CRLF+BOM: bomBytes helper agrees", bytesEqual(bomBytes("utf-8"), new Uint8Array([0xef, 0xbb, 0xbf])));
}

/* ------------------------------------------------------------------ summary */

console.log(`\n${"=".repeat(58)}`);
console.log(`TEST-FILE-IO: ${failures.length === 0 ? "PASS" : "FAIL"}  (${passed}/${passed + failures.length} checks)`);
if (failures.length > 0) console.log(`failed: ${failures.join("; ")}`);
console.log("=".repeat(58));
process.exit(failures.length === 0 ? 0 : 1);
