/**
 * The **single** import site for the CodeMirror modules a plugin is allowed to
 * use (plan task P3).
 *
 * Why one site: CM6 keys extension behaviour on class identity. A `Decoration`
 * built from one copy of `@codemirror/view` is rejected — or, worse, silently
 * ignored — by a view built from another. So plugins are handed these very
 * namespace objects through `ctx.cm`, and a plugin that writes
 * `import { Decoration } from "@codemirror/view"` fails loudly at import time
 * instead (there is no import map, deliberately: a mapped bare specifier would
 * resolve to a second copy, which is the failure this file prevents).
 *
 * `scripts/spike-plugin-host.py` measured both directions of that rule (P1):
 * the plugin's `instanceof ctx.cm.view.EditorView` check on the host's view is
 * true, and an extension built from these modules is accepted by a mounted view.
 */
import * as state from "@codemirror/state";
import * as view from "@codemirror/view";
import * as commands from "@codemirror/commands";
import * as search from "@codemirror/search";
import * as language from "@codemirror/language";

export const cm = Object.freeze({ state, view, commands, search, language });

export type CmModules = typeof cm;
