/**
 * The single file-I/O boundary — decision D3 (tier A), risk R8 ("keep file I/O
 * behind one module boundary so the non-Chromium path is a plug-in, not a rewrite").
 *
 * ── Reading ──────────────────────────────────────────────────────────────────
 * A byte-order mark is the only *definite* statement a file makes about its own
 * encoding, so it wins. With no BOM the data is tested as strict UTF-8; if that
 * fails the encoding is genuinely unknowable from the bytes, and D4 forbids magic
 * autodetection — so the document is opened provisionally as windows-1252 and
 * flagged (`assumed: true`) so the UI can say so out loud.
 *
 * ── Writing, and where the WHATWG set runs out ───────────────────────────────
 * `TextDecoder` decodes the whole mandated label list, but **`TextEncoder` only
 * encodes UTF-8** — there is no browser API for encoding windows-1252 or UTF-16.
 * So this module builds the missing encoders itself:
 *
 *   - UTF-16LE/BE are written by hand (two bytes per code unit, endianness by name);
 *   - each **single-byte** encoding gets a table *derived from its own decoder*:
 *     decoding the 256 individual bytes 0x00–0xFF with that label yields each byte's
 *     code point, and inverting it gives the byte for each character. Exact,
 *     dependency-free, and it cannot drift from the browser's own tables.
 *
 * Multi-byte legacy encodings (GBK, Big5, Shift_JIS, EUC-*, ISO-2022-JP) are
 * **decode-only**: no encoder exists for them here, so `canEncode()` returns false
 * and saving must convert to UTF-8 with the user's knowledge rather than pretend.
 * That is the honest edge of D4's "be honest about the rest".
 *
 * ── Round-trip fidelity ──────────────────────────────────────────────────────
 * Standing rule from `docs/scope.md` §6: a file opened as windows-1252 saves back
 * as windows-1252 unless the user explicitly converts. The same holds for the BOM
 * and the line ending, which is why `decodeFile` reports all three and
 * `encodeFile` takes them back.
 */
import type { BomKind, Bytes, DecodedFile, DocumentFormat, EncodeResult } from "./types";

/**
 * The single-byte encodings in the WHATWG mandate. Every one of these can be
 * encoded locally (see the header); anything not listed is decode-only.
 *
 * Note the §6 trap, which is why this list holds canonical labels only:
 * `iso-8859-1`, `latin1`, `cp819`, `us-ascii` and `ascii` are **not** ISO-8859-1
 * as far as the standard is concerned — all five decode as windows-1252. A file
 * does not record which name its author meant, so the UI must never offer
 * "Latin-1" as if it were distinct; it is windows-1252 and must be labelled so.
 */
export const SINGLE_BYTE_ENCODINGS: readonly string[] = [
  "ibm866",
  "iso-8859-2",
  "iso-8859-3",
  "iso-8859-4",
  "iso-8859-5",
  "iso-8859-6",
  "iso-8859-7",
  "iso-8859-8",
  "iso-8859-8-i",
  "iso-8859-10",
  "iso-8859-13",
  "iso-8859-14",
  "iso-8859-15",
  "iso-8859-16",
  "koi8-r",
  "koi8-u",
  "macintosh",
  "windows-874",
  "windows-1250",
  "windows-1251",
  "windows-1252",
  "windows-1253",
  "windows-1254",
  "windows-1255",
  "windows-1256",
  "windows-1257",
  "windows-1258",
  "x-mac-cyrillic",
];

/** Labels that all mean windows-1252 — the §6 trap, made executable. */
export const LATIN1_ALIASES: readonly string[] = ["iso-8859-1", "latin1", "cp819", "us-ascii", "ascii"];

/** Encodings the MVP can decode but not re-encode (no browser or local encoder). */
export const DECODE_ONLY_ENCODINGS: readonly string[] = [
  "gbk",
  "gb18030",
  "big5",
  "euc-jp",
  "iso-2022-jp",
  "shift_jis",
  "euc-kr",
];

const TEXT_ENCODINGS = ["utf-8", "utf-16le", "utf-16be"] as const;

/** Resolve what the browser will actually do with a label (case-insensitively). */
export function normaliseEncodingLabel(label: string): string {
  const lowered = label.trim().toLowerCase();
  if (LATIN1_ALIASES.includes(lowered)) return "windows-1252";
  return lowered;
}

export function canEncode(label: string): boolean {
  const canonical = normaliseEncodingLabel(label);
  return (
    (TEXT_ENCODINGS as readonly string[]).includes(canonical) ||
    SINGLE_BYTE_ENCODINGS.includes(canonical)
  );
}

/* --------------------------------------------------------------------- BOMs */

export function detectBom(bytes: Uint8Array): BomKind {
  // Order matters: UTF-32LE's BOM starts with UTF-16LE's.
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0x00 && bytes[3] === 0x00) {
    return "utf-32le";
  }
  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0xfe && bytes[3] === 0xff) {
    return "utf-32be";
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  return "none";
}

export function bomBytes(bom: BomKind): Uint8Array {
  switch (bom) {
    case "utf-8":
      return new Uint8Array([0xef, 0xbb, 0xbf]);
    case "utf-16le":
      return new Uint8Array([0xff, 0xfe]);
    case "utf-16be":
      return new Uint8Array([0xfe, 0xff]);
    default:
      return new Uint8Array();
  }
}

/* ------------------------------------------------------------------- reading */

/** Count line endings so the dominant one can be restored on save (risk R3). */
function detectEol(text: string): DecodedFile["eol"] {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const loneCr = (text.match(/(?<!\r)\r(?!\n)/g) ?? []).length;
  const loneLf = (text.match(/(?<!\r)\n/g) ?? []).length;

  const kinds = [crlf > 0, loneCr > 0, loneLf > 0].filter(Boolean).length;
  if (kinds > 1) return "mixed";
  if (crlf > 0) return "CRLF";
  if (loneCr > 0) return "CR";
  return "LF";
}

/**
 * Decode a file's bytes. `encoding` is only consulted when the file carries no
 * BOM — i.e. when the user has said what they think it is.
 */
export function decodeFile(bytes: Uint8Array, encoding?: string): DecodedFile {
  const bom = detectBom(bytes);

  if (bom === "utf-32le" || bom === "utf-32be") {
    // D4: not in the WHATWG set; refused with a warning until the phase-3 WASM work.
    return {
      text: "",
      encoding: bom,
      bom,
      eol: "LF",
      hadErrors: true,
      assumed: false,
      unsupported:
        `This file starts with a ${bom === "utf-32le" ? "UTF-32 LE" : "UTF-32 BE"} byte-order mark. ` +
        "UTF-32 is not one of the encodings a browser can decode, and the MVP does not ship the " +
        "WebAssembly decoder for it yet (decision D4/D10), so the file has been left unopened " +
        "rather than shown as mojibake.",
    };
  }

  let label: string;
  if (bom === "utf-8") label = "utf-8";
  else if (bom === "utf-16le") label = "utf-16le";
  else if (bom === "utf-16be") label = "utf-16be";
  else label = encoding ? normaliseEncodingLabel(encoding) : "utf-8";

  let assumed = false;
  let hadErrors = false;

  const decode = (useLabel: string, fatal: boolean): string | null => {
    try {
      return new TextDecoder(useLabel, { fatal }).decode(bytes);
    } catch {
      return null;
    }
  };

  let text: string | null = null;

  if (bom === "none") {
    // No BOM and no user instruction: strict UTF-8 is the only test that can
    // positively identify anything. If it fails, we do not guess — D4.
    if (!encoding) {
      text = decode("utf-8", true);
      if (text === null) {
        label = "windows-1252";
        assumed = true;
      }
    }
  }

  if (text === null) {
    text = decode(label, false);
    if (text === null) {
      // Unknown label entirely: fall back rather than fail the open.
      label = "windows-1252";
      assumed = true;
      text = decode(label, false) ?? "";
    }
    // Non-fatal decoding substitutes U+FFFD for bad bytes; surface that.
    hadErrors = text.includes("\uFFFD");
  }

  return { text, encoding: label, bom, eol: detectEol(text), hadErrors, assumed, unsupported: null };
}

/* ------------------------------------------------------------------- writing */

/** Reverse map for one single-byte encoding, derived from its own decoder. */
const encoderCache = new Map<string, Map<string, number>>();

function singleByteEncoder(label: string): Map<string, number> | null {
  const cached = encoderCache.get(label);
  if (cached) return cached;

  const decoder = (() => {
    try {
      return new TextDecoder(label, { fatal: false });
    } catch {
      return null;
    }
  })();
  if (!decoder) return null;

  const table = new Map<string, number>();
  for (let byte = 0; byte < 256; byte += 1) {
    const char = decoder.decode(Uint8Array.of(byte));
    // Undefined positions decode to U+FFFD; skip them so they cannot be written.
    if (char !== "\uFFFD" && !table.has(char)) table.set(char, byte);
  }

  // No size heuristic here on purpose. An earlier version rejected a table
  // smaller than 128 entries as "probably multi-byte", which is wrong: Shift_JIS
  // decodes its ASCII and half-width-katakana ranges perfectly well one byte at a
  // time, so it passed. Which encodings are single-byte is defined by the WHATWG
  // mandate, not inferred — `encodeFile` gates on SINGLE_BYTE_ENCODINGS and this
  // function only ever sees labels that list allows.
  if (table.size === 0) return null;

  encoderCache.set(label, table);
  return table;
}

/**
 * The File System Access write API accepts only ArrayBuffer-backed views, while
 * `TextEncoder.encode` is typed as possibly `SharedArrayBuffer`-backed (lib.dom is
 * conservative; in practice it always allocates a fresh ArrayBuffer). This narrows
 * the type behind a real runtime check rather than a bare assertion, so a
 * SharedArrayBuffer-backed view would fail loudly here instead of at the API.
 */
function asBytes(view: Uint8Array): Bytes {
  if (!(view.buffer instanceof ArrayBuffer)) {
    throw new TypeError("file-io: expected ArrayBuffer-backed bytes");
  }
  return view as Bytes;
}

function encodeUtf16(text: string, littleEndian: boolean): Bytes {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const at = i * 2;
    out[at] = littleEndian ? code & 0xff : code >> 8;
    out[at + 1] = littleEndian ? code >> 8 : code & 0xff;
  }
  return out;
}

/**
 * Encode text for saving. Returns bytes, or a `problem` describing exactly why it
 * cannot be done — never silently lossy (scope §8 criterion 6).
 */
export function encodeFile(text: string, format: DocumentFormat): EncodeResult {
  const label = normaliseEncodingLabel(format.encoding);
  const bom = bomBytes(format.bom);

  let body: Bytes;

  if (label === "utf-8") {
    body = asBytes(new TextEncoder().encode(text));
    // TextEncoder never emits a BOM; a file that had one gets it back.
    if (format.bom === "utf-8") {
      const out = new Uint8Array(bom.length + body.length);
      out.set(bom, 0);
      out.set(body, bom.length);
      return { bytes: out };
    }
    return { bytes: body };
  }

  if (label === "utf-16le" || label === "utf-16be") {
    body = encodeUtf16(text, label === "utf-16le");
  } else {
    // The WHATWG mandate defines exactly which encodings are single-byte, and only
    // those can be rebuilt from their own decoder. The allowlist is the honest
    // gate — see the note in `singleByteEncoder` about why inference fails.
    if (!SINGLE_BYTE_ENCODINGS.includes(label)) {
      return {
        problem:
          `“${label}” is a multi-byte legacy encoding. A browser can decode it but cannot encode ` +
          "it, and the MVP ships no encoder for it, so saving back as the original encoding is " +
          "not possible. Save as UTF-8 instead to keep the text intact (D4).",
      };
    }
    const table = singleByteEncoder(label);
    if (!table) {
      return {
        problem: `The browser supplied no usable ${label} character table, so this file cannot be ` +
          "re-encoded. Save as UTF-8 instead.",
      };
    }
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i] as string;
      const byte = table.get(char);
      if (byte === undefined) {
        const where = i > 40 ? `…${text.slice(i - 40, i + 1)}` : text.slice(0, i + 1);
        return {
          problem:
            `The character “${char}” (U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}, ` +
            `near “${where}”) does not exist in ${label}. Saving now would corrupt it. Save as ` +
            "UTF-8 instead, or remove the character.",
        };
      }
      out[i] = byte;
    }
    body = out;
  }

  if (bom.length > 0) {
    const out = new Uint8Array(bom.length + body.length);
    out.set(bom, 0);
    out.set(body, bom.length);
    return { bytes: out };
  }
  return { bytes: body };
}

/* ------------------------------------------------------------- CM6 integration */

/** CM6 normalises a document to one separator; re-apply the file's own on save (R3). */
export function toFileLineEndings(text: string, eol: DocumentFormat["eol"]): string {
  const unified = text.replace(/\r\n?/g, "\n");
  if (eol === "CRLF") return unified.replace(/\n/g, "\r\n");
  if (eol === "CR") return unified.replace(/\n/g, "\r");
  return unified;
}

/** The inverse: what CM6 will hold in memory for a given file. */
export function toEditorLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/* -------------------------------------------------------------------- pickers */

/**
 * Filter offered by both pickers. `excludeAcceptAllOption` is deliberately left
 * off: Notepad++ opens any file, so "All files" must stay available — a text
 * editor that refuses an unknown extension is not one.
 */
const TEXT_TYPES: FilePickerAcceptType[] = [
  {
    description: "Text files",
    accept: {
      "text/plain": [
        ".txt", ".log", ".md", ".json", ".xml", ".csv", ".ini", ".cfg", ".yaml", ".yml",
        ".js", ".ts", ".css", ".html", ".py", ".c", ".cpp", ".h", ".java", ".go", ".rs",
        ".sh", ".bat", ".sql",
      ],
    },
  },
];

/** A dismissed picker rejects with `AbortError`; that is a cancel, not a fault. */
function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Ask the user for a file to open. Returns `null` if they cancel.
 *
 * Both pickers require **transient user activation** (MDN, verified 2026-10-06),
 * so they must be called synchronously from a click — never on load, never from a
 * timer or a promise chain that has already awaited something else.
 */
export async function pickFileToOpen(): Promise<FileSystemFileHandle | null> {
  try {
    const handles = await window.showOpenFilePicker({
      types: TEXT_TYPES,
      multiple: false,
      id: "npp-open",
    });
    return handles[0] ?? null;
  } catch (error) {
    if (isAbort(error)) return null;
    throw error;
  }
}

/** Ask where to put a file. Returns `null` if the user cancels. */
export async function pickFileToSave(suggestedName: string): Promise<FileSystemFileHandle | null> {
  try {
    return await window.showSaveFilePicker({
      suggestedName,
      types: TEXT_TYPES,
      id: "npp-save",
    });
  } catch (error) {
    if (isAbort(error)) return null;
    throw error;
  }
}

/** Read and decode a file the user has already granted a handle to. */
export async function readHandle(
  handle: FileSystemFileHandle,
  encoding?: string,
): Promise<DecodedFile> {
  const file = await handle.getFile();
  const bytes = new Uint8Array(await file.arrayBuffer());
  return decodeFile(bytes, encoding);
}

/**
 * Write bytes to a handle. `createWritable()` writes to a temporary file and only
 * `close()` publishes it, so an interrupted save leaves the original untouched —
 * on any failure the write is aborted rather than half-committed.
 */
export async function writeHandle(handle: FileSystemFileHandle, bytes: Bytes): Promise<void> {
  const stream = await handle.createWritable();
  try {
    await stream.write(bytes);
    await stream.close();
  } catch (error) {
    await stream.abort().catch(() => undefined);
    throw error;
  }
}
