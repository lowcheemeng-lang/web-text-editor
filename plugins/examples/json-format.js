/**
 * JSON format — prettify the whole document or just the selections.
 *
 * The error path matters more than the happy one: invalid JSON must leave the
 * text exactly as it was and say so, not half-rewrite it.
 */
export default {
  id: "npp.jsonformat",
  name: "JSON Format",
  version: "1.0.0",
  apiVersion: 1,

  activate(ctx) {
    ctx.commands.register({
      id: "format",
      label: "JSON: Format Document or Selection",
      run() {
        const selections = ctx.editor.selections();
        const text = ctx.editor.text() ?? "";

        const withSelection = selections.some((range) => range.from !== range.to);
        if (withSelection) {
          return ctx.editor.replaceSelections((selected) => {
            try {
              return JSON.stringify(JSON.parse(selected), null, 2);
            } catch (error) {
              ctx.ui.notice("Not JSON", `The selection could not be parsed: ${message(error)}`, {
                kind: "json",
              });
              return selected;
            }
          });
        }

        try {
          ctx.editor.setText(JSON.stringify(JSON.parse(text), null, 2));
          return true;
        } catch (error) {
          ctx.ui.notice("Not JSON", `The document could not be parsed: ${message(error)}`, {
            kind: "json",
          });
          return false;
        }
      },
    });
  },
};

function message(error) {
  return error instanceof Error ? error.message : String(error);
}
