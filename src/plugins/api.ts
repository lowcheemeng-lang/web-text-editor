/**
 * The plugin-facing API surface (plan task P3).
 *
 * Types only. A plugin is written against this file's declarations — it never
 * imports the app's implementation modules, and it never imports CodeMirror
 * directly: `ctx.cm` hands over the app's own instances (see `cm.ts` for why that
 * singleton rule is load-bearing).
 *
 * `docs/plugins.md` is the prose version of this file; when the two disagree, the
 * types win and the doc is the bug.
 */
import type { Extension } from "@codemirror/state";

export interface Disposable {
  dispose(): void;
}

/** A read-only snapshot of one open document. Never the app's `OpenDocument`. */
export interface DocumentInfo {
  readonly id: string;
  readonly name: string;
  readonly fileName: string | null;
  readonly language: string | null;
  readonly dirty: boolean;
  readonly readOnly: boolean;
  readonly lineCount: number;
  readonly characterCount: number;
}

export interface SelectionInfo {
  readonly from: number;
  readonly to: number;
  readonly head: number;
  readonly anchor: number;
}

export interface CommandSpec {
  /** Unique within the plugin; the host namespaces it with the plugin id. */
  readonly id: string;
  readonly label: string;
  run(): boolean | void;
  /** `Ctrl+Alt+B` or CodeMirror's `Ctrl-Alt-b`; both are accepted. */
  readonly shortcut?: string;
  /** Adds a toolbar button for this command. */
  readonly toolbar?: { readonly title?: string };
  /** N++'s checked menu item. Read when the menu is built. */
  checked?(): boolean;
}

export interface PanelSpec {
  readonly id: string;
  readonly title: string;
  /** Build the panel's DOM; return a cleanup function if it needs one. */
  render(host: HTMLElement): void | (() => void);
  onShow?(): void;
  onHide?(): void;
}

export interface PanelHandle extends Disposable {
  show(): void;
  hide(): void;
  readonly visible: boolean;
}

export interface ToolbarButtonSpec {
  readonly id: string;
  readonly label: string;
  readonly title?: string;
  onClick(): boolean;
}

export type PluginEventType =
  | "document:opened"
  | "document:saved"
  | "document:closed"
  | "document:activated"
  | "document:changed"
  | "language:changed"
  /** Fired once, after the host has started and knows the documents already open. */
  | "ready";

export interface PluginEventPayload {
  readonly type: PluginEventType;
  /** The document the event is about, when there is one. */
  readonly document?: DocumentInfo;
  /** The language id, for `language:changed`. */
  readonly language?: string | null;
}

export interface EditorApi {
  documents(): DocumentInfo[];
  active(): DocumentInfo | null;
  text(documentId?: string): string | null;
  /** One undoable transaction. Returns false when the document is gone or read-only. */
  setText(text: string, documentId?: string): boolean;
  selections(documentId?: string): SelectionInfo[];
  /** Replace every selection; `map` runs once per selection, in document order. */
  replaceSelections(
    map: (text: string, index: number) => string,
    documentId?: string,
  ): boolean;
  /** A view-level CM6 extension, applied to every view of every document. */
  addExtension(extension: Extension): Disposable;
}

export interface CommandsApi {
  register(spec: CommandSpec): Disposable;
  run(id: string): boolean;
  setEnabled(id: string, enabled: boolean): void;
}

export interface PanelsApi {
  register(spec: PanelSpec): PanelHandle;
}

export interface ToolbarApi {
  addButton(spec: ToolbarButtonSpec): Disposable;
}

export interface EventsApi {
  on(type: PluginEventType, handler: (payload: PluginEventPayload) => void): Disposable;
}

export interface UiApi {
  dialog(spec: {
    readonly title: string;
    readonly body?: string;
    readonly content?: HTMLElement;
    readonly actions?: readonly { readonly id: string; readonly label: string }[];
  }): Promise<string | null>;
  confirm(message: string, options?: { title?: string; confirmLabel?: string }): Promise<boolean>;
  notice(title: string, body: string, options?: { kind?: string }): Disposable;
}

export interface SettingsApi {
  get<T = unknown>(key: string, fallback?: T): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  all(): Promise<Record<string, unknown>>;
}

export interface PluginContext {
  readonly apiVersion: 1;
  readonly plugin: Readonly<{ id: string; name: string; version: string }>;
  /** The app's own CodeMirror modules — never a copy. */
  readonly cm: {
    readonly state: typeof import("@codemirror/state");
    readonly view: typeof import("@codemirror/view");
    readonly commands: typeof import("@codemirror/commands");
    readonly search: typeof import("@codemirror/search");
    readonly language: typeof import("@codemirror/language");
  };
  readonly commands: CommandsApi;
  readonly editor: EditorApi;
  readonly panels: PanelsApi;
  readonly toolbar: ToolbarApi;
  readonly events: EventsApi;
  readonly ui: UiApi;
  readonly settings: SettingsApi;
  readonly log: (...args: unknown[]) => void;
}
