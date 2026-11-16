/**
 * Settings ▸ Preferences… — the port of N++'s Preferences dialog, cut down to the settings this
 * app actually has. N++'s dialog is a tree of eight tabs (`IDD_PREFERENCE`, `Notepad_plus.rc`);
 * the groups here are the ones whose keys exist in `src/storage/preferences.ts`, and only the
 * session group is new with Task 7 — the rest of that tree belongs to features nobody has built.
 *
 * Two conventions from the rest of the app:
 *
 *   - every control carries a `data-pref` attribute naming the key it edits, so a check can drive
 *     the real dialog rather than a private setter (`scripts/verify-task7.py` does exactly that);
 *   - nothing is applied until **OK**, which is N++'s behaviour (Cancel must not leave a change
 *     behind), and the values written are the ones the store returns, not the ones the form had.
 */
import {
  TOOLBAR_LAYOUTS,
  THEMES,
  ZOOM_LIMITS,
  type Preferences,
  type ThemeName,
  type ToolbarLayout,
} from "../storage/preferences";

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

export interface PreferencesDialogOptions {
  /** The preferences in force right now. */
  readonly current: Preferences;
  /** Apply and store the changed keys; resolves with what is now in force. */
  readonly apply: (patch: Partial<Preferences>) => Promise<Preferences>;
}

function checkboxRow(
  key: string,
  label: string,
  checked: boolean,
  note?: string,
): { row: HTMLElement; input: HTMLInputElement } {
  const row = el("div", { className: "npp-pref-row" });
  const input = el("input", {
    attrs: { type: "checkbox", id: `pref-${key}`, "data-pref": key },
  });
  input.checked = checked;
  const text = el("label", {
    className: "npp-pref-label",
    text: label,
    attrs: { for: `pref-${key}` },
  });
  row.append(input, text);
  if (note) row.append(el("span", { className: "npp-pref-note", text: note }));
  return { row, input };
}

function selectRow(
  key: string,
  label: string,
  values: readonly string[],
  selected: string,
  note?: string,
  labels?: Readonly<Record<string, string>>,
): HTMLElement {
  const row = el("div", { className: "npp-pref-row" });
  const select = el("select", { attrs: { id: `pref-${key}`, "data-pref": key } });
  for (const value of values) {
    const text = labels?.[value] ?? value;
    const option = el("option", { text, attrs: { value } });
    if (value === selected) option.selected = true;
    select.append(option);
  }
  row.append(
    el("label", { className: "npp-pref-label", text: label, attrs: { for: `pref-${key}` } }),
    select,
  );
  if (note) row.append(el("span", { className: "npp-pref-note", text: note }));
  return row;
}

/** The two themes in N++'s own vocabulary; the stored values stay internal ids. */
const THEME_LABELS: Readonly<Record<string, string>> = {
  notepadpp: "Notepad++ (light)",
  dark: "Notepad++ Dark Mode",
};

function numberRow(
  key: string,
  label: string,
  value: number,
  attrs: Record<string, string> = {},
): { row: HTMLElement; input: HTMLInputElement } {
  const row = el("div", { className: "npp-pref-row" });
  const input = el("input", { attrs: { type: "number", id: `pref-${key}`, "data-pref": key, ...attrs } });
  input.value = String(value);
  row.append(
    el("label", { className: "npp-pref-label", text: label, attrs: { for: `pref-${key}` } }),
    input,
  );
  return { row, input };
}

/**
 * Open the dialog. Resolves with the stored preferences when OK was pressed, or `null` when the
 * dialog was cancelled — a caller must not treat "cancelled" as "applied".
 */
export function openPreferencesDialog(
  options: PreferencesDialogOptions,
): Promise<Preferences | null> {
  const current = options.current;

  return new Promise<Preferences | null>((resolve) => {
    const dialog = el("dialog", {
      className: "npp-dialog npp-pref-dialog",
      attrs: { "data-dialog": "preferences" },
    });
    const title = el("h2", { className: "npp-dialog-title", text: "Preferences" });
    const body = el("div", { className: "npp-dialog-body npp-pref-body" });

    /** N++ Preferences ▸ MISC, the session group (Parameters.h:755-756, 867-869). */
    body.append(el("h3", { className: "npp-pref-group", text: "Session" }));
    const remember = checkboxRow(
      "rememberLastSession",
      "Remember current session for next launch",
      current.rememberLastSession,
    );
    body.append(remember.row);

    const snapshot = checkboxRow(
      "snapshotMode",
      "Enable session snapshot and periodic backup",
      current.snapshotMode,
      "Unsaved documents are written to backup/ and restored as dirty.",
    );
    body.append(snapshot.row);

    const timing = numberRow(
      "snapshotBackupTiming",
      "Backup interval (ms)",
      current.snapshotBackupTiming,
      { min: "1000", max: "600000", step: "500" },
    );
    body.append(timing.row);

    const keep = checkboxRow(
      "keepSessionAbsentFileEntries",
      "Keep session absent file entries",
      current.keepSessionAbsentFileEntries,
      "Off: a file that cannot be reopened is dropped. On: you are offered an empty read-only placeholder.",
    );
    body.append(keep.row);

    body.append(el("h3", { className: "npp-pref-group", text: "Toolbar" }));
    const toolbar = checkboxRow("toolbarVisible", "Show the toolbar", current.toolbarVisible);
    body.append(toolbar.row);
    body.append(
      selectRow(
        "toolbarLayout",
        "Layout",
        TOOLBAR_LAYOUTS,
        current.toolbarLayout,
        // N++ puts its icon-set name in this node's text; a text toolbar has no icons.
        "N++ spells this value with icon-set names (standard/small/fluent) because its toolbar is a strip of icons; this toolbar is text.",
      ),
    );

    body.append(el("h3", { className: "npp-pref-group", text: "Appearance" }));
    body.append(
      selectRow(
        "theme",
        "Theme",
        THEMES,
        current.theme,
        "N++'s light styles and its own Dark Mode — the dark palette is DarkModeDefault.xml and NppDarkMode.cpp's colours, not a CSS filter. Applied on OK and restored before the first paint.",
        THEME_LABELS,
      ),
    );
    body.append(
      numberRow("zoom", "Zoom (points)", current.zoom, {
        min: String(ZOOM_LIMITS.min),
        max: String(ZOOM_LIMITS.max),
        step: "1",
      }).row,
    );
    body.append(
      el("p", {
        className: "npp-pref-note",
        text:
          "Zoom is N++'s (Scintilla scales its styles by whole points) and the View ▸ Zoom commands " +
          "change it too. Word wrap is not here: N++ keeps it per document, so this port stores it " +
          "with the document in the session.",
      }),
    );

    const actions = el("div", { className: "npp-dialog-actions" });
    const cancel = el("button", {
      className: "npp-dialog-cancel",
      text: "Cancel",
      attrs: { type: "button", "data-dialog-action": "cancel" },
    });
    const ok = el("button", {
      className: "npp-dialog-confirm",
      text: "OK",
      attrs: { type: "button", "data-dialog-action": "confirm" },
    });
    actions.append(cancel, ok);

    dialog.append(title, body, actions);

    cancel.addEventListener("click", () => dialog.close("cancel"));
    ok.addEventListener("click", () => dialog.close("confirm"));

    dialog.addEventListener("close", () => {
      const confirmed = dialog.returnValue === "confirm";
      if (!confirmed) {
        dialog.remove();
        resolve(null);
        return;
      }
      // Read the form only now: nothing is applied before OK, so Cancel truly changes nothing.
      const patch: Partial<Preferences> = {
        rememberLastSession: remember.input.checked,
        keepSessionAbsentFileEntries: keep.input.checked,
        snapshotMode: snapshot.input.checked,
        snapshotBackupTiming: Number(timing.input.value),
        toolbarVisible: toolbar.input.checked,
        toolbarLayout: (dialog.querySelector<HTMLSelectElement>("[data-pref='toolbarLayout']")
          ?.value ?? current.toolbarLayout) as ToolbarLayout,
        theme: (dialog.querySelector<HTMLSelectElement>("[data-pref='theme']")?.value ??
          current.theme) as ThemeName,
        zoom: Number(dialog.querySelector<HTMLInputElement>("[data-pref='zoom']")?.value ?? current.zoom),
      };
      void options.apply(patch).then((stored) => {
        dialog.remove();
        resolve(stored);
      });
    });

    document.body.appendChild(dialog);
    dialog.showModal();
    ok.focus();
  });
}
