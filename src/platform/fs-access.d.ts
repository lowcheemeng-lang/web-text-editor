/**
 * Ambient declarations for the File System Access pickers.
 *
 * Why this file exists: TypeScript 7's `lib.dom.d.ts` ships `FileSystemHandle`,
 * `FileSystemFileHandle`, `FileSystemWritableFileStream` and `createWritable()`,
 * but — checked directly in
 * `@typescript/typescript-linux-x64/lib/lib.dom.d.ts` — it does **not** declare
 * `showOpenFilePicker`, `showSaveFilePicker` or `showDirectoryPicker`.
 * (`showOpenFilePicker` appears there only inside a doc comment.) The pickers are
 * the entire file path for the MVP (D3 tier A), so they must be declared here.
 *
 * Deliberately minimal and accurate rather than `any`: only the options the app
 * actually passes are typed, so a misspelled option stays a compile error.
 * Reference: MDN `Window.showOpenFilePicker()`, WICG file-system-access.
 */

interface FilePickerAcceptType {
  description?: string;
  /** MIME type → extensions, e.g. `{ "text/plain": [".txt", ".log"] }`. */
  accept: Record<string, string | string[]>;
}

interface FilePickerOptions {
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
  /** Lets the browser remember a directory per id across picker calls. */
  id?: string;
  startIn?:
    | FileSystemHandle
    | "desktop"
    | "documents"
    | "downloads"
    | "music"
    | "pictures"
    | "videos";
}

interface OpenFilePickerOptions extends FilePickerOptions {
  multiple?: boolean;
}

interface SaveFilePickerOptions extends FilePickerOptions {
  suggestedName?: string;
}

interface Window {
  /** Requires transient user activation; rejects with `AbortError` on dismiss. */
  showOpenFilePicker(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
}
