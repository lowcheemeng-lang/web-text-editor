/**
 * P1 spike fixture — a plugin that fails during activation.
 *
 * The host must contain the failure: the editor keeps working, the error is
 * reported, and nothing the plugin did before throwing is left behind.
 */
export default {
  id: "spike.broken",
  name: "Broken spike plugin",
  version: "1.0.0",
  apiVersion: 1,

  activate() {
    throw new Error("spike boom");
  },
};
