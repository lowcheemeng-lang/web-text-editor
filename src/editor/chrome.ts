/**
 * The Notepad++-style chrome: toolbar, per-pane tab strips, status bar, split divider
 * and the close-confirmation dialog (Task 3 step 2). Pure DOM — it holds no editor
 * state, so the workspace stays the only place that mutates documents.
 *
 * Scope note: the **menu bar arrives with Task 4**, when File ▸ Open / Save exist to
 * put in it. An empty File menu now would be a control that does nothing, and this
 * project's convention is not to ship a claim it cannot back.
 */

export interface PaneElements {
  readonly id: string;
  readonly root: HTMLElement;
  readonly tabStrip: HTMLElement;
  readonly editorHost: HTMLElement;
}

export interface TabDescriptor {
  readonly id: string;
  readonly label: string;
  readonly dirty: boolean;
  readonly active: boolean;
}

export interface TabHandlers {
  activate(id: string): void;
  close(id: string): void;
}

export interface ToolbarButtonSpec {
  readonly id: string;
  readonly label: string;
  readonly title: string;
  /** Returns the button's new pressed state, which the chrome reflects back. */
  readonly onClick: () => boolean;
}

export interface ConfirmOptions {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
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

export interface MenuItemSpec {
  readonly id: string;
  readonly label: string;
  /** Shown right-aligned as a hint. The real binding lives in the keymap. */
  readonly shortcut?: string;
  readonly onClick: () => void;
}

/** A rule between groups of items. */
export interface MenuSeparator {
  readonly id: string;
  readonly separator: true;
}

export type MenuEntry = MenuItemSpec | MenuSeparator;

export function isSeparator(entry: MenuEntry): entry is MenuSeparator {
  return "separator" in entry;
}

export interface MenuSpec {
  readonly label: string;
  /**
   * A function is re-read every time the menu opens. That is what lets File ▸
   * Recent show a live list without every menu being rebuilt on each change.
   */
  readonly items: readonly MenuEntry[] | (() => readonly MenuEntry[]);
}

export class Chrome {
  /** The menu bar Task 3 deferred to this task, "once File ▸ Open / Save exist". */
  readonly menuBar: HTMLElement;
  readonly toolbar: HTMLElement;
  readonly workspace: HTMLElement;
  readonly splitter: HTMLElement;
  readonly statusBar: HTMLElement;

  readonly #buttons = new Map<string, HTMLButtonElement>();
  readonly #menus = new Map<
    string,
    { spec: MenuSpec; popup: HTMLElement; button: HTMLButtonElement }
  >();
  #openMenu: string | null = null;

  constructor(host: HTMLElement) {
    host.classList.add("npp-app");
    this.menuBar = el("div", {
      className: "npp-menubar",
      attrs: { role: "menubar", "aria-label": "Main menu" },
    });
    this.toolbar = el("div", {
      className: "npp-toolbar",
      attrs: { role: "toolbar", "aria-label": "Editor toolbar" },
    });
    this.workspace = el("div", { className: "npp-workspace" });
    this.splitter = el("div", {
      className: "npp-splitter",
      attrs: {
        role: "separator",
        "aria-orientation": "vertical",
        "aria-label": "Drag to resize the two views",
        title: "Drag to resize the two views",
      },
    });
    this.splitter.hidden = true;
    this.statusBar = el("div", { className: "npp-statusbar", attrs: { role: "status" } });
    this.workspace.appendChild(this.splitter);
    host.append(this.menuBar, this.toolbar, this.workspace, this.statusBar);
  }

  /**
   * Build the menu bar. A title click opens its popup; Escape, a click anywhere
   * else, or choosing an item closes it. Menu items run the same actions as the
   * keymap, so neither path is second-class.
   */
  addMenus(menus: readonly MenuSpec[]): void {
    for (const menu of menus) {
      const button = el("button", {
        className: "npp-menu-title",
        text: menu.label,
        attrs: { type: "button", "aria-haspopup": "true", "aria-expanded": "false" },
      });
      const popup = el("div", { className: "npp-menu-popup", attrs: { role: "menu" } });
      popup.hidden = true;

      const wrapper = el("div", { className: "npp-menu" });
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this.#toggleMenu(menu.label);
      });
      wrapper.append(button, popup);
      this.#menus.set(menu.label, { spec: menu, popup, button });
      this.menuBar.appendChild(wrapper);
    }

    document.addEventListener("click", () => this.#closeMenus());
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.#closeMenus();
    });
  }

  /** Rebuild one menu's popup — cheap, and the only way a dynamic list stays live. */
  #renderMenu(target: { spec: MenuSpec; popup: HTMLElement }): void {
    const items = typeof target.spec.items === "function" ? target.spec.items() : target.spec.items;
    target.popup.replaceChildren(
      ...items.map((item) => (isSeparator(item) ? this.#menuRule() : this.#menuItem(item))),
    );
  }

  #menuRule(): HTMLElement {
    return el("hr", { className: "npp-menu-rule" });
  }

  #menuItem(item: MenuItemSpec): HTMLElement {
    const entry = el("button", {
      className: "npp-menu-item",
      attrs: { type: "button", role: "menuitem", "data-menu-item": item.id },
    });
    entry.append(
      el("span", { className: "npp-menu-label", text: item.label }),
      el("span", { className: "npp-menu-shortcut", text: item.shortcut ?? "" }),
    );
    entry.addEventListener("click", () => {
      this.#closeMenus();
      item.onClick();
      // The next keystroke belongs to the editor, not the menu.
      document.querySelector<HTMLElement>(".npp-pane .cm-content")?.focus();
    });
    return entry;
  }

  #toggleMenu(label: string): void {
    const target = this.#menus.get(label);
    if (!target) return;
    const wasOpen = this.#openMenu === label;
    this.#closeMenus();
    if (wasOpen) return;
    this.#renderMenu(target);
    target.popup.hidden = false;
    target.button.setAttribute("aria-expanded", "true");
    this.#openMenu = label;
  }

  #closeMenus(): void {
    if (this.#openMenu === null) return;
    const current = this.#menus.get(this.#openMenu);
    if (current) {
      current.popup.hidden = true;
      current.button.setAttribute("aria-expanded", "false");
    }
    this.#openMenu = null;
  }

  addButton(spec: ToolbarButtonSpec): void {
    const button = el("button", {
      className: "npp-tool",
      text: spec.label,
      attrs: { type: "button", title: spec.title, "data-tool": spec.id },
    });
    button.addEventListener("click", () => {
      const active = spec.onClick();
      this.setButtonActive(spec.id, active);
      // The toolbar must not keep focus: the next keystroke belongs to the editor.
      document.querySelector<HTMLElement>(".npp-pane .cm-content")?.focus();
    });
    this.#buttons.set(spec.id, button);
    this.toolbar.appendChild(button);
  }

  setButtonActive(id: string, active: boolean): void {
    const button = this.#buttons.get(id);
    if (!button) return;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  /** Panes sit either side of the splitter; the primary pane goes before it. */
  addPane(id: string, position: "before-splitter" | "after-splitter"): PaneElements {
    const root = el("section", { className: "npp-pane", attrs: { "data-pane": id } });
    const tabStrip = el("div", { className: "npp-tabstrip", attrs: { role: "tablist" } });
    const editorHost = el("div", { className: "npp-editor-host" });
    root.append(tabStrip, editorHost);
    if (position === "before-splitter") this.workspace.insertBefore(root, this.splitter);
    else this.workspace.appendChild(root);
    return { id, root, tabStrip, editorHost };
  }

  removePane(pane: PaneElements): void {
    pane.root.remove();
  }

  /**
   * Turn the divider into a drag handle for the second pane. Returns a disposer, so
   * closing the split does not leave a listener resizing a pane that no longer exists.
   */
  enableSplitterDrag(secondary: PaneElements): () => void {
    const onPointerDown = (event: PointerEvent) => {
      const startX = event.clientX;
      const startWidth = secondary.root.getBoundingClientRect().width;
      const total = this.workspace.getBoundingClientRect().width;
      const move = (moveEvent: PointerEvent) => {
        const width = Math.min(Math.max(startWidth + (startX - moveEvent.clientX), 120), total - 120);
        secondary.root.style.flex = `0 0 ${width}px`;
      };
      const stop = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
      event.preventDefault();
    };
    this.splitter.addEventListener("pointerdown", onPointerDown);
    return () => this.splitter.removeEventListener("pointerdown", onPointerDown);
  }

  setSplitterVisible(visible: boolean): void {
    this.splitter.hidden = !visible;
  }

  /**
   * Render a pane's tab strip. Called after every transaction, so it short-circuits on
   * an unchanged signature instead of rebuilding the DOM per keystroke.
   */
  renderTabs(pane: PaneElements, tabs: readonly TabDescriptor[], handlers: TabHandlers): void {
    const signature = tabs.map((tab) => `${tab.id}:${tab.label}:${tab.active}`).join("|");
    if (pane.tabStrip.dataset.signature === signature) return;
    pane.tabStrip.dataset.signature = signature;
    pane.tabStrip.replaceChildren(...tabs.map((tab) => this.#tab(tab, handlers)));
  }

  #tab(tab: TabDescriptor, handlers: TabHandlers): HTMLElement {
    const wrapper = el("div", {
      className: `npp-tab${tab.active ? " is-active" : ""}`,
      attrs: {
        role: "tab",
        "aria-selected": String(tab.active),
        "data-doc": tab.id,
        title: tab.dirty ? `${tab.label} — modified` : tab.label,
      },
    });
    const label = el("button", {
      className: "npp-tab-label",
      text: tab.label,
      attrs: { type: "button" },
    });
    label.addEventListener("click", () => handlers.activate(tab.id));
    const close = el("button", {
      className: "npp-tab-close",
      text: "\u00d7",
      attrs: { type: "button", "aria-label": `Close ${tab.label}`, title: `Close ${tab.label}` },
    });
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      handlers.close(tab.id);
    });
    // N++ closes a tab on middle-click; keep that.
    wrapper.addEventListener("auxclick", (event) => {
      if (event.button === 1) handlers.close(tab.id);
    });
    wrapper.append(label, close);
    return wrapper;
  }

  setStatus(segments: readonly string[]): void {
    this.statusBar.replaceChildren(
      ...segments.map((text) => el("span", { className: "npp-status-item", text })),
    );
  }

  setTitle(text: string): void {
    document.title = text;
  }

  /**
   * A message the user must acknowledge: an encoding that cannot be saved, a read
   * that failed. Same visual language as `confirm`, one button.
   */
  alert(options: { title: string; body: string; okLabel?: string }): Promise<void> {
    return new Promise<void>((resolve) => {
      const dialog = el("dialog", { className: "npp-dialog", attrs: { "data-dialog": "alert" } });
      const title = el("h2", { className: "npp-dialog-title", text: options.title });
      const body = el("p", { className: "npp-dialog-body", text: options.body });
      const ok = el("button", {
        className: "npp-dialog-confirm",
        text: options.okLabel ?? "OK",
        attrs: { type: "button", "data-dialog-action": "ok" },
      });
      const actions = el("div", { className: "npp-dialog-actions" });
      ok.addEventListener("click", () => dialog.close("ok"));
      actions.append(ok);
      dialog.append(title, body, actions);
      dialog.addEventListener("close", () => {
        dialog.remove();
        resolve();
      });
      document.body.appendChild(dialog);
      dialog.showModal();
      ok.focus();
    });
  }

  /**
   * Persistent banner for a browser that cannot do file I/O (S4, scope §8 criterion
   * 6). It sits under the menu bar, is never auto-dismissed, and states plainly
   * that nothing can be saved to a file — silence is the failure mode this exists
   * to prevent.
   */
  showNotice(title: string, body: string): void {
    const notice = el("div", {
      className: "npp-notice",
      attrs: { role: "alert", "data-notice": "unsupported" },
    });
    notice.append(
      el("strong", { className: "npp-notice-title", text: title }),
      el("span", { className: "npp-notice-body", text: body }),
    );
    this.menuBar.after(notice);
  }

  /**
   * N++'s three-way close prompt: Save / Don't Save / Cancel. Two buttons cannot
   * express it, and now that saving is real, offering only discard-or-cancel would
   * hide the safe choice. Resolves `"cancel"` when the dialog is dismissed.
   */
  confirmSave(options: {
    title: string;
    body: string;
    canSave: boolean;
  }): Promise<"save" | "discard" | "cancel"> {
    return new Promise((resolve) => {
      const dialog = el("dialog", {
        className: "npp-dialog",
        attrs: { "data-dialog": "save-changes" },
      });
      const title = el("h2", { className: "npp-dialog-title", text: options.title });
      const body = el("p", { className: "npp-dialog-body", text: options.body });
      const actions = el("div", { className: "npp-dialog-actions" });

      const addButton = (id: string, label: string, className: string) => {
        const node = el("button", {
          className,
          text: label,
          attrs: { type: "button", "data-dialog-action": id },
        });
        node.addEventListener("click", () => dialog.close(id));
        actions.append(node);
      };

      // Without the pickers there is nothing Save could do, so do not offer it.
      if (options.canSave) addButton("save", "Save", "npp-dialog-confirm");
      addButton("discard", "Don't Save", "npp-dialog-discard");
      addButton("cancel", "Cancel", "npp-dialog-cancel");

      dialog.append(title, body, actions);
      dialog.addEventListener("close", () => {
        const choice = dialog.returnValue;
        dialog.remove();
        // Esc leaves returnValue empty; treating that as cancel keeps data safe.
        resolve(choice === "save" || choice === "discard" ? choice : "cancel");
      });
      document.body.appendChild(dialog);
      dialog.showModal();
    });
  }

  /** Modal confirmation used by the close prompt. Resolves false on Esc or Cancel. */
  confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const dialog = el("dialog", { className: "npp-dialog", attrs: { "data-dialog": "confirm" } });
      const title = el("h2", { className: "npp-dialog-title", text: options.title });
      const body = el("p", { className: "npp-dialog-body", text: options.body });
      const cancel = el("button", {
        className: "npp-dialog-cancel",
        text: options.cancelLabel ?? "Cancel",
        attrs: { type: "button", "data-dialog-action": "cancel" },
      });
      const confirmButton = el("button", {
        className: "npp-dialog-confirm",
        text: options.confirmLabel,
        attrs: { type: "button", "data-dialog-action": "confirm" },
      });
      cancel.addEventListener("click", () => dialog.close("cancel"));
      confirmButton.addEventListener("click", () => dialog.close("confirm"));
      const actions = el("div", { className: "npp-dialog-actions" });
      actions.append(cancel, confirmButton);
      dialog.append(title, body, actions);
      dialog.addEventListener("close", () => {
        const accepted = dialog.returnValue === "confirm";
        dialog.remove();
        resolve(accepted);
      });
      document.body.appendChild(dialog);
      dialog.showModal();
      cancel.focus();
    });
  }
}
