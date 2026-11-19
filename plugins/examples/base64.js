/**
 * Base64 — encode or decode the selected text.
 *
 * The two things this example is here to show: a plugin edits through
 * `ctx.editor.replaceSelections`, so the change is one ordinary transaction that
 * Ctrl+Z takes back; and UTF-8 survives the trip, because `btoa` alone throws on
 * anything above U+00FF.
 */
export default {
  id: "npp.base64",
  name: "Base64",
  version: "1.0.0",
  apiVersion: 1,

  activate(ctx) {
    ctx.commands.register({
      id: "encode",
      label: "Base64 Encode Selection",
      shortcut: "Ctrl+Alt+B",
      run() {
        return ctx.editor.replaceSelections((text) => encode(text));
      },
    });

    ctx.commands.register({
      id: "decode",
      label: "Base64 Decode Selection",
      shortcut: "Ctrl+Alt+Shift+B",
      run() {
        return ctx.editor.replaceSelections((text) => {
          try {
            return decode(text.trim());
          } catch {
            ctx.ui.notice("Not Base64", "The selection is not valid base64.", { kind: "base64" });
            return text;
          }
        });
      },
    });
  },
};

function encode(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decode(text) {
  const binary = atob(text);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
