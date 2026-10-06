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

export class Chrome {
  readonly toolbar: HTMLElement;
  readonly workspace: HTMLElement;
  readonly splitter: HTMLElement;
  readonly statusBar: HTMLElement;

  readonly #buttons = new Map<string, HTMLButtonElement>();

  constructor(host: HTMLElement) {
    host.classList.add("npp-app");
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
    host.append(this.toolbar, this.workspace, this.statusBar);
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
