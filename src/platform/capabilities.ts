/**
 * Thin capability check — decision D3 (tier A only), risk R8, standing decision S4.
 *
 * The MVP has exactly one file path: the File System Access API. It is **not** a
 * "modern browser" test — verified against caniuse on 2026-10-06:
 *
 *   Chrome 105+ / Edge 105+ / Opera 91+ (desktop)  → supported
 *   Firefox, any version                           → not supported (position: "harmful")
 *   Safari, any version                            → not supported
 *   **Chrome for Android**                         → not supported
 *
 * That last one is why this cannot be a user-agent sniff or a "is it Chromium?"
 * check: mobile Chrome is Chromium and still has no pickers. The only honest test
 * is for the API itself.
 *
 * D12 (accepted 2026-10-12) turns that fact into the *device* ruling as well: mobile
 * and tablet are out of the MVP, so this notice is what a phone or tablet gets — the
 * same notice Firefox and Safari get, for the same reason, found by the same API
 * test. Nothing in this file branches on the device, which is what makes the decision
 * free to reverse.
 *
 * The app deliberately still mounts without them — typing, tabs and split view all
 * work, and refusing to load would be a worse experience than saying what is
 * missing. What it must never do is stay silent: scope §8 criterion 6 is
 * "unsupported browsers fail loudly, nothing loses data silently", so the notice
 * below says plainly that nothing can be saved to a file.
 */

export interface BrowserCapabilities {
  /** `showOpenFilePicker` + `showSaveFilePicker` — the MVP's only file path. */
  readonly fileSystemAccess: boolean;
  /**
   * OPFS. Not used by the editor itself in the MVP; the acceptance check uses it
   * to build real file handles when the OS dialog cannot be automated.
   */
  readonly originPrivateFileSystem: boolean;
  /** True when the app can offer its full MVP feature set. */
  readonly supported: boolean;
}

export function detectCapabilities(scope: Window & typeof globalThis = window): BrowserCapabilities {
  const fileSystemAccess =
    typeof scope.showOpenFilePicker === "function" && typeof scope.showSaveFilePicker === "function";
  const originPrivateFileSystem =
    typeof scope.navigator?.storage?.getDirectory === "function";

  return Object.freeze({
    fileSystemAccess,
    originPrivateFileSystem,
    // Only the pickers gate the MVP: without them there is no open and no save.
    supported: fileSystemAccess,
  });
}

export interface UnsupportedNotice {
  readonly title: string;
  readonly body: string;
}

/**
 * The message for a browser that cannot do file I/O — or `null` when it can.
 * Copy is deliberately specific: it names the browsers that work, says what is
 * lost, and tells the user what to do about it.
 */
export function unsupportedNotice(capabilities: BrowserCapabilities): UnsupportedNotice | null {
  if (capabilities.supported) return null;
  return {
    title: "Opening and saving files is not available in this browser",
    body:
      "Notepad++ Web reads and writes files with the File System Access API, and this browser " +
      "does not provide it. Desktop Chrome, Edge and Opera do. Chrome on Android does not — it " +
      "is Chromium too, but mobile Chromium has no file pickers, and phones and tablets running " +
      "anything else have none either. You can keep typing, pasting and " +
      "copying here, but nothing can be saved to a file: copy anything you want to keep " +
      "somewhere safe before closing this tab.",
  };
}
