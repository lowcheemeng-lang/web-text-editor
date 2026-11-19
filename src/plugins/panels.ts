/**
 * The right-hand dock for plugin panels (plan task P5).
 *
 * One column, a tab strip, one visible panel at a time — not a general docking
 * system, and deliberately not N++'s: it has no floating panels, no nested docks
 * and no per-panel close box beyond the one tab. What it does keep is N++'s shape
 * for the thing plugins actually use a dock for (Function List, Document Map):
 * a tab on the right edge that shows the plugin's panel and follows the document.
 *
 * The dock owns the DOM, never the registration: which panels exist and which one
 * is visible live in `PluginRegistry`, so a plugin's `panel.show()` and a click on
 * the tab take exactly the same path (`showPanel`), and `onShow` runs once.
 *
 * Width is stored in `localStorage` (`npp-web.dock-width`) — a web-only view
 * preference, kept out of the N++-keyed `Preferences` table on purpose. The last
 * shown panel is remembered too (`npp-web.dock-panel`) and reopened once per page
 * load, which is what makes a panel feel docked rather than summoned.
 */
import type { PluginRegistry, RegisteredPanel } from "./registry.ts";

const WIDTH_KEY = "npp-web.dock-width";
const PANEL_KEY = "npp-web.dock-panel";
const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 180;
const MAX_FRACTION = 0.6;

function readNumber(key: string, fallback: number): number {
  try {
    const value = Number.parseFloat(localStorage.getItem(key) ?? "");
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function readString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: the panel still works, it just is not remembered */
  }
}

export class PluginDock {
  readonly root: HTMLElement;
  readonly #registry: PluginRegistry;
  readonly #parent: HTMLElement;
  readonly #tabs: HTMLElement;
  readonly #body: HTMLElement;
  readonly #handle: HTMLElement;
  readonly #rendered = new Map<string, { element: HTMLElement; cleanup: (() => void) | null }>();
  #activeKey: string | null = null;
  #width: number;
  #signature = "";
  /** The saved panel is reopened once per page load, never after the user closes it. */
  #restored = false;

  constructor(parent: HTMLElement, registry: PluginRegistry) {
    this.#parent = parent;
    this.#registry = registry;
    this.#width = Math.max(MIN_WIDTH, readNumber(WIDTH_KEY, DEFAULT_WIDTH));

    this.root = document.createElement("div");
    this.root.className = "npp-dock";
    this.root.dataset.dock = "plugins";
    this.root.hidden = true;
    this.root.style.flex = `0 0 ${this.#width}px`;

    this.#handle = document.createElement("div");
    this.#handle.className = "npp-dock-handle";
    this.#handle.title = "Drag to resize the panel";
    this.#handle.setAttribute("role", "separator");
    this.#handle.setAttribute("aria-orientation", "vertical");

    const main = document.createElement("div");
    main.className = "npp-dock-main";

    const header = document.createElement("div");
    header.className = "npp-dock-header";

    this.#tabs = document.createElement("div");
    this.#tabs.className = "npp-dock-tabs";
    this.#tabs.setAttribute("role", "tablist");

    const close = document.createElement("button");
    close.type = "button";
    close.className = "npp-dock-close";
    close.textContent = "×";
    close.title = "Close this panel";
    close.setAttribute("aria-label", "Close this panel");
    close.addEventListener("click", () => {
      const panel = this.#registry.panels().find((candidate) => candidate.visible);
      if (panel) this.#registry.hidePanel(panel.pluginId, panel.spec.id);
    });

    this.#body = document.createElement("div");
    this.#body.className = "npp-dock-body";

    header.append(this.#tabs, close);
    main.append(header, this.#body);
    this.root.append(this.#handle, main);
    parent.appendChild(this.root);

    this.#handle.addEventListener("pointerdown", (event) => this.#startResize(event));
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  get width(): number {
    return this.#width;
  }

  #key(panel: RegisteredPanel): string {
    return `${panel.pluginId}:${panel.spec.id}`;
  }

  /** Reconcile the dock with the registry. Cheap when nothing changed. */
  sync(): void {
    const panels = this.#registry.panels();

    for (const [key, entry] of [...this.#rendered]) {
      if (panels.some((panel) => this.#key(panel) === key)) continue;
      try {
        entry.cleanup?.();
      } catch {
        /* the plugin is going away; a cleanup failure must not block it */
      }
      entry.element.remove();
      this.#rendered.delete(key);
      if (this.#activeKey === key) this.#activeKey = null;
    }

    if (panels.length === 0) {
      this.#tabs.replaceChildren();
      this.#signature = "";
      this.#body.replaceChildren();
      this.#activeKey = null;
      this.root.hidden = true;
      return;
    }

    let active = panels.find((panel) => panel.visible) ?? null;

    if (!active && !this.#restored) {
      this.#restored = true;
      const saved = readString(PANEL_KEY);
      const match = saved ? panels.find((panel) => this.#key(panel) === saved) : undefined;
      if (match) {
        this.#registry.showPanel(match.pluginId, match.spec.id);
        return; // the notify re-enters sync with an active panel
      }
    }
    this.#restored = true;

    this.#renderTabs(panels, active);
    if (!active) {
      this.root.hidden = true;
      this.#body.replaceChildren();
      this.#activeKey = null;
      return;
    }
    this.#show(active);
  }

  #renderTabs(panels: readonly RegisteredPanel[], active: RegisteredPanel | null): void {
    const signature = panels
      .map((panel) => `${this.#key(panel)}:${panel.spec.title}:${panel.visible}`)
      .join("|");
    if (signature === this.#signature) return;
    this.#signature = signature;

    this.#tabs.replaceChildren(
      ...panels.map((panel) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `npp-dock-tab${panel === active ? " is-active" : ""}`;
        button.dataset.panelTab = this.#key(panel);
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", String(panel === active));
        button.textContent = panel.spec.title;
        button.addEventListener("click", () => this.#registry.showPanel(panel.pluginId, panel.spec.id));
        return button;
      }),
    );
  }

  #show(panel: RegisteredPanel): void {
    const key = this.#key(panel);
    let entry = this.#rendered.get(key);
    if (!entry) {
      const element = document.createElement("div");
      element.className = "npp-dock-panel";
      element.dataset.panel = key;
      let cleanup: (() => void) | null = null;
      try {
        const result = panel.spec.render(element);
        if (typeof result === "function") cleanup = result;
      } catch (error) {
        // A panel that cannot render says so in its own body instead of taking the
        // dock — or the editor — down with it.
        const message = error instanceof Error ? error.message : String(error);
        this.#registry.noteError(panel.pluginId, error);
        element.textContent = `This panel failed to render: ${message}`;
      }
      entry = { element, cleanup };
      this.#rendered.set(key, entry);
    }
    if (this.#activeKey !== key) {
      this.#body.replaceChildren(entry.element);
      this.#activeKey = key;
    }
    this.root.hidden = false;
    this.root.style.flex = `0 0 ${this.#width}px`;
    writeString(PANEL_KEY, key);
  }

  #startResize(event: PointerEvent): void {
    const startX = event.clientX;
    const startWidth = this.root.getBoundingClientRect().width;
    const total = this.#parent.getBoundingClientRect().width;
    const maximum = Math.max(MIN_WIDTH, total * MAX_FRACTION);

    const move = (moveEvent: PointerEvent): void => {
      const width = Math.min(Math.max(startWidth + (startX - moveEvent.clientX), MIN_WIDTH), maximum);
      this.#width = Math.round(width);
      this.root.style.flex = `0 0 ${this.#width}px`;
    };
    const stop = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      writeString(WIDTH_KEY, String(this.#width));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    event.preventDefault();
  }
}
