/**
 * Word count — a docked panel that follows the active document.
 *
 * The panel opens itself on activation (`panel.show()`), which is a plugin's
 * choice rather than the dock's: registering a panel must not steal screen space
 * from someone who installed a plugin for its commands only.
 */
export default {
  id: "npp.wordcount",
  name: "Word Count",
  version: "1.0.0",
  apiVersion: 1,

  activate(ctx) {
    const panel = ctx.panels.register({
      id: "counts",
      title: "Word Count",
      render(host) {
        const update = () => {
          const document = ctx.editor.active();
          if (!document) {
            host.textContent = "No document";
            return;
          }
          const text = ctx.editor.text();
          const words = (text ?? "").trim().split(/\s+/).filter(Boolean).length;
          host.textContent =
            `${words} words\n${document.characterCount} characters\n${document.lineCount} lines`;
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
    });

    ctx.commands.register({
      id: "show",
      label: "Word Count: Show Panel",
      run() {
        panel.show();
        return true;
      },
    });

    panel.show();
    return () => panel.dispose();
  },
};
