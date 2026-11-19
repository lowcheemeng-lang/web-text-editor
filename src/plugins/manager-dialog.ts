/**
 * Plugins ▸ Plugin Manager… — N++'s Plugin Admin without the catalogue (plan P6).
 *
 * What it does: lists the installed plugins with their state, installs one from a
 * `.js` file, a drop or pasted source, and enables / disables / reloads /
 * uninstalls them. What it cannot do is *trust* a plugin: a module loaded into
 * this page has this page's privileges. The trust sentence is therefore the first
 * thing in the dialog, above the picker, not a footnote after it.
 *
 * Two behaviours the check pins:
 *
 *   - **Uninstall is two-step.** Clicking Uninstall turns the row into
 *     "Remove? [Yes] [No]" rather than opening a second modal; a nested
 *     `confirm()` would be modal on a modal, and its text is unstyleable.
 *   - **`?plugins=off` is honoured here too.** The manager still opens — it is the
 *     way to disable or remove the plugin that broke the page — but Enable is
 *     refused while the flag is in force, because a plugin started from here
 *     would defeat the flag that exists to get the app back.
 *
 * Nothing in this file touches the loader directly: every action goes through the
 * callbacks `Workspace` hands in, which are the same facade the command line and
 * the acceptance check use. That is what keeps this dialog replaceable and the
 * dev-only handles out of the shipped code.
 */
import type { PluginRecord } from "./model.ts";
import type { PluginActionResult } from "./loader.ts";

export interface PluginManagerOptions {
  readonly list: () => Promise<PluginRecord[]>;
  readonly install: (source: string) => Promise<PluginActionResult>;
  readonly enable: (id: string) => Promise<PluginActionResult>;
  readonly disable: (id: string) => Promise<boolean>;
  readonly reload: (id: string) => Promise<PluginActionResult>;
  readonly uninstall: (id: string) => Promise<boolean>;
  /** True when the page was opened with `?plugins=off`. */
  readonly disabled: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: { className?: string; text?: string; attrs?: Record<string, string> } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [name, value] of Object.entries(options.attrs ?? {})) node.setAttribute(name, value);
  return node;
}

function statusOf(record: PluginRecord): { label: string; className: string } {
  if (record.lastError) return { label: "failed", className: "is-failed" };
  if (record.enabled) return { label: "enabled", className: "is-enabled" };
  return { label: "disabled", className: "is-disabled" };
}

/** Resolves when the dialog closes; the caller has nothing to apply. */
export function openPluginManager(options: PluginManagerOptions): Promise<void> {
  return new Promise<void>((resolve) => {
    let records: PluginRecord[] = [];
    let pendingUninstall: string | null = null;
    let busy = false;

    const dialog = el("dialog", {
      className: "npp-dialog npp-manager-dialog",
      attrs: { "data-dialog": "plugin-manager" },
    });
    const title = el("h2", { className: "npp-dialog-title", text: "Plugin Manager" });

    const body = el("div", { className: "npp-dialog-body npp-manager-body" });

    if (options.disabled) {
      body.append(
        el("p", {
          className: "npp-manager-banner",
          text:
            "Plugins are disabled for this page (?plugins=off). Installed plugins are not " +
            "loaded and cannot be enabled here; disable or uninstall one to recover, then " +
            "reload without the parameter.",
          attrs: { "data-plugin-disabled-banner": "" },
        }),
      );
    }

    body.append(
      el("p", {
        className: "npp-manager-trust",
        text:
          "Plugins run with this page's full privileges: they can read every document open " +
          "here, and anything this origin can reach. There is no sandbox. Install only source " +
          "you have read or an author you trust.",
      }),
    );

    const rows = el("div", { className: "npp-manager-rows", attrs: { "data-plugin-rows": "" } });
    body.append(rows);

    const message = el("p", {
      className: "npp-manager-message",
      attrs: { "data-plugin-message": "", role: "status" },
    });

    /* ---------------------------------------------------------------- install */

    const installRow = el("div", { className: "npp-manager-install" });
    const fileInput = el("input", {
      attrs: { type: "file", accept: ".js,text/javascript", "data-plugin-file": "" },
    });
    fileInput.hidden = true;
    const pick = el("button", {
      className: "npp-manager-button",
      text: "Install from file…",
      attrs: { type: "button", "data-plugin-install": "" },
    });
    const drop = el("div", {
      className: "npp-manager-drop",
      text: "…or drop the plugin's .js file here",
      attrs: { "data-plugin-drop": "" },
    });

    const source = el("textarea", {
      className: "npp-manager-source",
      attrs: {
        "data-plugin-source": "",
        rows: "4",
        spellcheck: "false",
        placeholder: "…or paste the plugin's source",
      },
    });
    const paste = el("button", {
      className: "npp-manager-button",
      text: "Install pasted source",
      attrs: { type: "button", "data-plugin-install-paste": "" },
    });

    installRow.append(pick, fileInput, drop, source, paste);
    if (options.disabled) {
      // Recovery mode: there is deliberately no install path while ?plugins=off.
      body.append(message);
    } else {
      body.append(installRow, message);
    }

    pick.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (file) void installFromFile(file);
    });

    drop.addEventListener("dragover", (event) => {
      event.preventDefault();
      drop.classList.add("is-over");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
    drop.addEventListener("drop", (event) => {
      event.preventDefault();
      drop.classList.remove("is-over");
      const file = event.dataTransfer?.files?.[0];
      if (file) void installFromFile(file);
    });

    paste.addEventListener("click", () => {
      if (!source.value.trim()) {
        setMessage("There is no pasted source to install.", "error");
        return;
      }
      void installSource(source.value, "the pasted source");
    });

    async function installFromFile(file: File): Promise<void> {
      if (!/\.js$/i.test(file.name)) {
        setMessage(`${file.name} is not a .js file; a plugin is one ES module file.`, "error");
        return;
      }
      await installSource(await file.text(), file.name);
    }

    async function installSource(text: string, label: string): Promise<void> {
      if (busy) return;
      busy = true;
      setMessage(`Installing ${label}…`, "busy");
      try {
        const result = await options.install(text);
        if (result.ok) {
          setMessage(`Installed ${label}.`, "ok");
          source.value = "";
        } else {
          setMessage(`Could not install ${label}: ${result.error ?? "unknown error"}`, "error");
        }
      } finally {
        busy = false;
        await refresh();
      }
    }

    function setMessage(text: string, kind: "ok" | "error" | "busy" | "idle"): void {
      message.textContent = text;
      message.dataset.state = kind;
    }

    /* ------------------------------------------------------------------ rows */

    function button(
      label: string,
      action: string,
      onClick: () => void,
      extra: Record<string, string> = {},
    ): HTMLButtonElement {
      const node = el("button", {
        className: "npp-manager-button",
        text: label,
        attrs: { type: "button", "data-plugin-action": action, ...extra },
      });
      node.addEventListener("click", () => {
        if (busy) return;
        onClick();
      });
      return node;
    }

    function renderRows(): void {
      rows.replaceChildren();
      if (records.length === 0) {
        rows.append(
          el("p", {
            className: "npp-manager-empty",
            text: "No plugins are installed.",
            attrs: { "data-plugin-empty": "" },
          }),
        );
        return;
      }

      for (const record of records) {
        const row = el("div", {
          className: "npp-manager-row",
          attrs: { "data-plugin-row": record.id },
        });

        const main = el("div", { className: "npp-manager-main" });
        const status = statusOf(record);
        const name = el("span", { className: "npp-manager-name", text: record.name });
        const version = el("span", { className: "npp-manager-version", text: `v${record.version}` });
        const badge = el("span", {
          className: `npp-manager-status ${status.className}`,
          text: status.label,
          attrs: { "data-plugin-status": record.id },
        });
        main.append(name, version, badge);
        if (record.author) {
          main.append(el("span", { className: "npp-manager-author", text: `by ${record.author}` }));
        }
        row.append(main);

        if (record.lastError) {
          row.append(
            el("p", {
              className: "npp-manager-error",
              text: record.lastError,
              attrs: { "data-plugin-error": record.id },
            }),
          );
        }

        row.append(el("p", { className: "npp-manager-meta", text: record.id }));

        const actions = el("div", { className: "npp-manager-actions" });

        if (pendingUninstall === record.id) {
          actions.append(
            el("span", { className: "npp-manager-question", text: `Remove ${record.name}?` }),
            button(
              "Yes, remove",
              "uninstall-confirm",
              () => {
                pendingUninstall = null;
                void run(() => options.uninstall(record.id), `Removed ${record.name}.`);
              },
              { "data-plugin-confirm": record.id },
            ),
            button("No", "uninstall-cancel", () => {
              pendingUninstall = null;
              renderRows();
            }),
          );
        } else {
          if (record.enabled) {
            actions.append(
              button("Disable", "disable", () =>
                void run(() => options.disable(record.id), `Disabled ${record.name}.`),
              ),
              button("Reload", "reload", () =>
                void run(() => options.reload(record.id), `Reloaded ${record.name}.`),
              ),
            );
          } else {
            const enable = button("Enable", "enable", () =>
              void run(
                () =>
                  options.disabled
                    ? Promise.resolve({
                        ok: false,
                        error: "plugins are disabled for this page (?plugins=off)",
                      })
                    : options.enable(record.id),
                `Enabled ${record.name}.`,
              ),
            );
            if (options.disabled) {
              enable.disabled = true;
              enable.title = "Remove ?plugins=off from the address and reload first.";
            }
            actions.append(enable);
          }
          actions.append(
            button("Uninstall", "uninstall", () => {
              pendingUninstall = record.id;
              renderRows();
            }),
          );
        }

        row.append(actions);
        rows.append(row);
      }
    }

    async function run(action: () => Promise<boolean | PluginActionResult>, success: string): Promise<void> {
      busy = true;
      setMessage("Working…", "busy");
      try {
        const result = await action();
        const ok = typeof result === "boolean" ? result : result.ok;
        const error = typeof result === "boolean" ? undefined : result.error;
        if (ok) setMessage(success, "ok");
        else setMessage(`That did not work: ${error ?? "no reason given"}`, "error");
      } finally {
        busy = false;
        await refresh();
      }
    }

    async function refresh(): Promise<void> {
      records = await options.list();
      if (pendingUninstall && !records.some((record) => record.id === pendingUninstall)) {
        pendingUninstall = null;
      }
      renderRows();
    }

    /* ---------------------------------------------------------------- closing */

    const actions = el("div", { className: "npp-dialog-actions" });
    const close = el("button", {
      className: "npp-dialog-confirm",
      text: "Close",
      attrs: { type: "button", "data-dialog-action": "close" },
    });
    actions.append(close);
    close.addEventListener("click", () => dialog.close("close"));

    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve();
    });

    dialog.append(title, body, actions);
    document.body.append(dialog);
    dialog.showModal();

    void refresh().then(() => {
      pick.focus();
    });
  });
}
