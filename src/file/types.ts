/** Shared types for the file layer. Kept separate so `file-io.ts` stays about behaviour. */

/** A byte-order mark we recognise. The UTF-32 pair is detected only to refuse it (D4). */
export type BomKind = "none" | "utf-8" | "utf-16le" | "utf-16be" | "utf-32le" | "utf-32be";

/**
 * Line endings. `"mixed"` is reachable because CM6 normalises a document to one
 * separator and cannot preserve per-line endings — risk R3, a known downgrade.
 */
export type EolKind = "LF" | "CRLF" | "CR" | "mixed";

/** Everything needed to write a file back the way it was found (§6 round-trip rule). */
export interface DocumentFormat {
  /** Canonical WHATWG label, after alias folding (see `normaliseEncodingLabel`). */
  encoding: string;
  bom: BomKind;
  eol: EolKind;
}

export interface DecodedFile extends DocumentFormat {
  text: string;
  /** Bytes did not decode cleanly — U+FFFD was substituted somewhere. */
  hadErrors: boolean;
  /**
   * Nothing identified the encoding (no BOM, not valid UTF-8), so it was opened
   * provisionally as windows-1252. D4 forbids guessing, so the UI must say so.
   */
  assumed: boolean;
  /** Non-null when the file uses something the MVP cannot handle at all. */
  unsupported: string | null;
}

/**
 * Bytes we produced ourselves are always backed by a plain `ArrayBuffer`, never a
 * `SharedArrayBuffer`. Saying so in the type matters: TypeScript's `Uint8Array` is
 * generic over its buffer, and the File System Access write API only accepts the
 * `ArrayBuffer`-backed form (`FileSystemWriteChunkType`), so a loose `Uint8Array`
 * fails to type-check at the call site.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

export type EncodeResult = { bytes: Bytes } | { problem: string };
