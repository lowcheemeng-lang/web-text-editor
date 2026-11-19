/**
 * P4 fixture — a plugin with two commands, a shortcut, a toolbar button and an
 * event subscription. It imports nothing: CodeMirror comes from `ctx.cm` and the
 * document from `ctx.editor`.
 */
export default {
  id: "spike.commands",
  name: "Command fixture",
  version: "1.0.0",
  apiVersion: 1,

  activate(ctx) {
    ctx.commands.register({
      id: "upper",
      label: "Uppercase Document",
      shortcut: "Ctrl+Alt+U",
      run() {
        const text = ctx.editor.text();
        if (text === null) return false;
        ctx.editor.setText(text.toUpperCase());
        window.__pluginFixture = { ran: "upper", length: text.length, doc: ctx.editor.active() };
        return true;
      },
    });

    ctx.commands.register({
      id: "describe",
      label: "Describe Document",
      run() {
        const doc = ctx.editor.active();
        window.__pluginFixture = {
          ran: "describe",
          doc,
          selections: ctx.editor.selections().length,
          documents: ctx.editor.documents().length,
        };
        return true;
      },
    });

    ctx.toolbar.addButton({
      id: "upper",
      label: "UPPER",
      title: "Uppercase the document (fixture)",
      onClick() {
        const text = ctx.editor.text();
        if (text === null) return false;
        ctx.editor.setText(text.toUpperCase());
        window.__pluginFixture = { ran: "toolbar" };
        return true;
      },
    });

    ctx.events.on("document:changed", (event) => {
      (window.__pluginEvents ??= []).push(event.type);
    });

    return () => {
      delete window.__pluginFixture;
    };
  },
};
