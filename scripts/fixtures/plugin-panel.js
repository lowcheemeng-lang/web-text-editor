/**
 * P5 fixture — a docked panel that reports the active document's size and follows
 * it on every change. Also registers a command that reopens the panel, because a
 * closed dock has no tab to click.
 */
export default {
  id: "spike.panel",
  name: "Word count panel",
  version: "1.0.0",
  apiVersion: 1,

  activate(ctx) {
    const panel = ctx.panels.register({
      id: "counts",
      title: "Word Count",
      render(host) {
        const update = () => {
          const doc = ctx.editor.active();
          host.textContent = doc
            ? `${doc.lineCount} lines · ${doc.characterCount} characters`
            : "No document";
        };
        update();
        const subscriptions = [
          ctx.events.on("document:changed", update),
          ctx.events.on("document:activated", update),
        ];
        return () => {
          for (const subscription of subscriptions) subscription.dispose();
        };
      },
      onShow() {
        window.__panelShows = (window.__panelShows ?? 0) + 1;
      },
    });

    const info = ctx.panels.register({
      id: "info",
      title: "Document Info",
      render(host) {
        const update = () => {
          const doc = ctx.editor.active();
          host.textContent = doc
            ? `${doc.name} · ${doc.language ?? "plain text"} · ${doc.dirty ? "modified" : "saved"}`
            : "No document";
        };
        update();
        const subscriptions = [ctx.events.on("document:activated", update)];
        return () => {
          for (const subscription of subscriptions) subscription.dispose();
        };
      },
    });

    ctx.commands.register({
      id: "show",
      label: "Show Word Count",
      run() {
        panel.show();
        return true;
      },
    });

    ctx.commands.register({
      id: "show-info",
      label: "Show Document Info",
      run() {
        info.show();
        return true;
      },
    });

    return () => {
      panel.dispose();
      info.dispose();
    };
  },
};
