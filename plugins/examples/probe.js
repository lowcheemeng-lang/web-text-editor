/**
 * Probe — the smallest plugin that proves the extension path.
 *
 * It adds a CodeMirror `ViewPlugin` that marks the editor's own DOM, so the
 * acceptance check can see that a plugin-supplied extension reached a real view
 * (and, in split view, both views) without reading any private state.
 *
 * It marks with a **data attribute, not a class**: CodeMirror owns
 * `view.dom.className` and rewrites it when it applies theme classes, which
 * silently dropped a `plugin-probe` class from the second pane (measured — the
 * primary kept it, the clone lost it until the next reconfigure).
 */
export default {
  id: "npp.probe",
  name: "Probe",
  version: "1.0.0",
  apiVersion: 1,

  activate(ctx) {
    const { ViewPlugin } = ctx.cm.view;

    const probe = ViewPlugin.fromClass(
      class {
        constructor(view) {
          // `destroy()` is called with no argument, so the view has to be kept.
          this.view = view;
          view.dom.dataset.pluginProbe = "1";
        }
        destroy() {
          delete this.view.dom.dataset.pluginProbe;
        }
      },
    );

    ctx.editor.addExtension(probe);

    ctx.commands.register({
      id: "ping",
      label: "Probe: Ping",
      run() {
        ctx.log("probe ping");
        return true;
      },
    });
  },
};
