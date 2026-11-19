/**
 * Broken — throws during activation on purpose.
 *
 * The host must keep the app usable, mark the record `failed` with this message,
 * and offer the Plugin Manager. A plugin that cannot start must not be able to
 * stop the editor from starting.
 */
export default {
  id: "npp.broken",
  name: "Broken Example",
  version: "1.0.0",
  apiVersion: 1,

  activate() {
    throw new Error("this plugin always fails (it is the failure example)");
  },
};
