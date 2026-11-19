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

/* ------------------------------------------------------ UTF-32 round-trips */

{
  // "Aé" in UTF-32LE with its BOM: four bytes per code point.
  const utf32 = new Uint8Array([0xff, 0xfe, 0x00, 0x00, 0x41, 0x00, 0x00, 0x00, 0xe9, 0x00, 0x00, 0x00]);
  const decoded = decodeFile(utf32);
  check("UTF-32LE: decodes", decoded.text === "Aé", JSON.stringify(decoded.text));
  check("UTF-32LE: records the encoding", decoded.encoding === "utf-32le");
  check("UTF-32LE: not flagged as an error", decoded.hadErrors === false);
  const encoded = encodeFile(decoded.text, decoded);
  check("UTF-32LE: byte-identical round-trip", "bytes" in encoded && bytesEqual(encoded.bytes, utf32),
        "bytes" in encoded ? show(encoded.bytes) : encoded.problem);
}

{
  // "A😀" in UTF-32BE — the astral character is one four-byte unit, not a surrogate pair.
  const utf32be = new Uint8Array([0x00, 0x00, 0xfe, 0xff, 0x00, 0x00, 0x00, 0x41, 0x00, 0x01, 0xf6, 0x00]);
  const decoded = decodeFile(utf32be);
  check("UTF-32BE: decodes an astral character", decoded.text === "A😀", JSON.stringify(decoded.text));
  const encoded = encodeFile(decoded.text, decoded);
  check("UTF-32BE: byte-identical round-trip", "bytes" in encoded && bytesEqual(encoded.bytes, utf32be),
        "bytes" in encoded ? show(encoded.bytes) : encoded.problem);
}

{
  // No BOM, but the user said it is UTF-32LE: honour it rather than sniffing UTF-8.
  const body = new Uint8Array([0x41, 0x00, 0x00, 0x00, 0x42, 0x00, 0x00, 0x00]);
  const decoded = decodeFile(body, "utf-32le");
  check("UTF-32LE without a BOM: decodes when named", decoded.text === "AB", JSON.stringify(decoded.text));
  check("UTF-32LE without a BOM: not assumed", decoded.assumed === false);
}

{
  // 0x00110000 is above Unicode's ceiling; 0x0000D800 is a surrogate. Both are
  // replaced and reported, not silently rendered.
  const bad = new Uint8Array([0xff, 0xfe, 0x00, 0x00, 0x00, 0x00, 0x11, 0x00, 0x00, 0xd8, 0x00, 0x00]);
  const decoded = decodeFile(bad);
  check("UTF-32: invalid code points become U+FFFD", decoded.text === "\uFFFD\uFFFD", JSON.stringify(decoded.text));
  check("UTF-32: and the document is marked as having errors", decoded.hadErrors === true);
}

{
  const decoded = decodeFile(new Uint8Array([0x41]), "utf-32le");
  const encoded = encodeFile(`${decoded.text}\uD800`, decoded);
  check("UTF-32: an unpaired surrogate is refused, not written", "problem" in encoded);
  check("UTF-32: the refusal names the surrogate",
        "problem" in encoded && encoded.problem.includes("D800"),
        "problem" in encoded ? encoded.problem.slice(0, 60) : "");
}

/* ---------------------------------------------------------- DOS codepages */

const CP437_BOX = new Uint8Array([0xc4, 0xc4, 0xda, 0xbf, 0x20, 0x82, 0x91]);
{
  // ──┌┐ é æ in CP437 (0x82 = é, 0x91 = æ)
  const decoded = decodeFile(CP437_BOX, "cp437");
  check("cp437: decodes box-drawing and accents", decoded.text === "──┌┐ éæ", JSON.stringify(decoded.text));
  check("cp437: records the encoding", decoded.encoding === "cp437");
  check("cp437: not assumed", decoded.assumed === false);
  const encoded = encodeFile(decoded.text, decoded);
  check("cp437: byte-identical round-trip", "bytes" in encoded && bytesEqual(encoded.bytes, CP437_BOX),
        "bytes" in encoded ? show(encoded.bytes) : encoded.problem);
}

{
  // Every byte is defined in CP437 and the mapping is a bijection, so all 256 must
  // survive decode→encode. This is the check a hand-typed table fails.
  let failuresInPage = 0;
  for (let byte = 0; byte < 256; byte += 1) {
    const decoded = decodeFile(Uint8Array.of(byte), "cp437");
    const encoded = encodeFile(decoded.text, decoded);
    if (!("bytes" in encoded) || encoded.bytes[0] !== byte || encoded.bytes.length !== 1) {
      failuresInPage += 1;
    }
  }
  check("cp437: all 256 bytes round-trip", failuresInPage === 0, `${failuresInPage} failed`);
}

{
  // CP850: é = 0x82, ü = 0x81; CP852: ł = 0x88, ą = 0xA5, ę = 0xA9
  const cp850 = new Uint8Array([0x82, 0x81, 0x9b]); // éüø
  const d850 = decodeFile(cp850, "cp850");
  check("cp850: decodes", d850.text === "éüø", JSON.stringify(d850.text));
  const e850 = encodeFile(d850.text, d850);
  check("cp850: byte-identical round-trip", "bytes" in e850 && bytesEqual(e850.bytes, cp850),
        "bytes" in e850 ? show(e850.bytes) : e850.problem);

  const cp852 = new Uint8Array([0x88, 0xa5, 0xa9]);
  const d852 = decodeFile(cp852, "cp852");
  check("cp852: decodes", d852.text === "łąę", JSON.stringify(d852.text));
  const e852 = encodeFile(d852.text, d852);
  check("cp852: byte-identical round-trip", "bytes" in e852 && bytesEqual(e852.bytes, cp852),
        "bytes" in e852 ? show(e852.bytes) : e852.problem);
}

{
  const decoded = decodeFile(new Uint8Array([0x41]), "cp437");
  const encoded = encodeFile("A你", decoded);
  check("cp437: an unrepresentable character is refused", "problem" in encoded);
  check("cp437: the refusal names the character and the page",
        "problem" in encoded && encoded.problem.includes("你") && encoded.problem.includes("cp437"));
}

check("cp437 can be encoded", canEncode("cp437") === true);
check("cp850 can be encoded", canEncode("cp850") === true);
check("an unimplemented N++ codepage cannot be encoded", canEncode("cp720") === false);
{
  const encoded = encodeFile("A", { encoding: "cp720", bom: "none", eol: "LF" });
  check("an unimplemented codepage is refused by name",
        "problem" in encoded && encoded.problem.includes("CP720"),
        "problem" in encoded ? encoded.problem.slice(0, 60) : "");
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
