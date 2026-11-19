/**
 * P1 spike fixture — a plugin module in the shape the plan proposes.
 *
 * It imports nothing: CodeMirror comes from `ctx.cm`, which is the app's own
 * module instance. A plugin that imported `@codemirror/view` itself would fail
 * at import time (no import map), which is the intended loud failure.
 *
 * The plugin adds a view plugin that marks the first four characters of every
 * line it renders, plus a class on the editor element. Both are visible to the
 * driver, and both must disappear from *both* panes when it is disposed.
 */
export default {
  id: "spike.probe",
  name: "Plugin host spike probe",
  version: "1.0.0",
  apiVersion: 1,

  activate(ctx) {
    const { Decoration, EditorView, ViewPlugin } = ctx.cm.view;

    // The singleton proof: the view the host hands over must be an instance of
    // the same EditorView class the plugin was given. If the host had handed
    // over a second copy of CodeMirror, this would be false — and the extension
    // below would be rejected by the view.
    const hostView = ctx.editor.hostView();
    ctx.results.viewInstanceof = hostView instanceof EditorView;
    ctx.results.apiVersion = ctx.apiVersion;
    ctx.results.pluginId = ctx.plugin.id;
    ctx.results.cmHasCommands = typeof ctx.cm.commands.undo === "function";
    ctx.results.cmHasSearch = typeof ctx.cm.search.SearchQuery === "function";

    const mark = Decoration.mark({ class: "plugin-probe-mark" });
    const marks = ViewPlugin.fromClass(
      class {
        constructor(view) {
          this.decorations = Decoration.set([mark.range(0, Math.min(4, view.state.doc.length))]);
        }
        update(update) {
          this.decorations = Decoration.set([
            mark.range(0, Math.min(4, update.state.doc.length)),
          ]);
        }
      },
      { decorations: (plugin) => plugin.decorations },
    );

    const attrs = EditorView.editorAttributes.of({ class: "plugin-probe" });
    const subscription = ctx.editor.addExtension([marks, attrs]);

    ctx.results.extensionAccepted = true;
    return () => subscription.dispose();
  },
};
