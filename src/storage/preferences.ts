/**
 * UI preferences — the *browser* half of Notepad++'s `config.xml`.
 *
 * N++ spreads these across `GUIConfigs` (session, toolbar) and `ScintillaViewParams` (zoom).
 * Every key here is one of N++'s own, with the source line it came from, and every default is
 * N++'s default rather than a taste call. Where a browser cannot reproduce the original, the
 * deviation is recorded in `DEVIATIONS_FROM_NPP` and in `docs/session-persistence.md`.
 *
 *   Parameters.h:755   `bool _rememberLastSession = true;`
 *   Parameters.h:756   `bool _keepSessionAbsentFileEntries = false;`
 *   Parameters.h:867   `isSnapshotMode()` — `_isSnapshotMode && _rememberLastSession && …`
 *   Parameters.h:869   `size_t _snapshotBackupTiming = 7000;`
 *   Parameters.h:919   `intptr_t _zoom = 0;` (+ `_zoom2`, `_zoomSync`)
 *   Parameters.cpp:6046 `<GUIConfig name="ToolBar" visible="yes" …>standard</GUIConfig>`
 *   Parameters.cpp:6734 `<GUIConfig name="Backup" … isSnapshotMode="yes" snapshotBackupTiming="7000" />`
 *   Parameters.cpp:7288 `<ScintillaViewParams … zoom="0" zoom2="0" zoomSync="false">`
 *   stylers.model.xml  GlobalStyles/"Default Style": `fontName="Courier New" fontSize="10"`
 *
 * This module is deliberately dependency-free (bar the IndexedDB helper) so the same code the
 * browser runs can be exercised in Node by `scripts/test-session.mjs`.
 */
import { idbGet, idbPut } from "./idb.ts";

/** N++'s Style Configurator lists the theme *file* names it found (`ThemeSwitcher`, Parameters.h:1253). */
export type ThemeName = "notepadpp";
export type ToolbarLayout = "standard" | "small";

export interface Preferences {
  /** N++ Preferences ▸ MISC ▸ "Remember current session for next launch". */
  rememberLastSession: boolean;
  /**
   * N++ Preferences ▸ MISC. Its *code* semantics, not its label: when false an entry whose
   * file cannot be found is dropped from the restored session without a word
   * (`NppIO.cpp:2553`); when true N++ offers read-only placeholders for them
   * (`FileManager::newPlaceholderDocument`, `Buffer.cpp:1719`).
   */
  keepSessionAbsentFileEntries: boolean;
  /** N++ Preferences ▸ MISC ▸ "Enable session snapshot and periodic backup". */
  snapshotMode: boolean;
  /** How often a dirty document is backed up, in milliseconds. N++'s default is 7000. */
  snapshotBackupTiming: number;
  /** `<GUIConfig name="ToolBar" visible="…">`. */
  toolbarVisible: boolean;
  /**
   * The text of that same node — N++ puts its icon-set name there ("standard", "small",
   * "fluent", …). A text toolbar has no icon set, so this port spends the value on button
   * size, which is the half of the setting a text toolbar *can* honour.
   */
  toolbarLayout: ToolbarLayout;
  /** The theme the editor is drawn in; N++ stores the theme *name*. */
  theme: ThemeName;
  /**
   * Scintilla's zoom, in points, added to the style's own font size (10 pt, above). N++ keeps
   * one per view (`_zoom`, `_zoom2`) plus `zoomSync` for "make them agree"; this port has one
   * value in the whole app, which is what `zoomSync="true"` means in N++.
   */
  zoom: number;
}

export const NPP_PREFERENCES: Readonly<Preferences> = Object.freeze({
  rememberLastSession: true,
  keepSessionAbsentFileEntries: false,
  snapshotMode: true,
  snapshotBackupTiming: 7000,
  toolbarVisible: true,
  toolbarLayout: "standard" as ToolbarLayout,
  theme: "notepadpp" as ThemeName,
  zoom: 0,
});

/** The themes this port ships. N++'s Dark Mode is *not* one of them yet (see the ledger). */
export const THEMES: readonly ThemeName[] = ["notepadpp"];

export const TOOLBAR_LAYOUTS: readonly ToolbarLayout[] = ["standard", "small"];

/** stylers.model.xml → GlobalStyles/"Default Style" fontSize="10". */
export const BASE_FONT_SIZE_PT = 10;

/**
 * Scintilla's own limits, from its documentation of `SCI_ZOOMIN`/`SCI_ZOOMOUT`: "increases the
 * zoom factor by one point if the current zoom factor is less than 60 points", "decreases … if
 * … greater than -10 points", and "limiting yourself to -10 to +60 … is a good idea". Out-of-range
 * stored values are clamped rather than honoured, so a corrupted record cannot render the
 * editor unusable.
 */
export const ZOOM_LIMITS = Object.freeze({ min: -10, max: 60 });

/** The preference store's key. One record, like the file it stands in for. */
const PREFERENCES_KEY = "config";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Anything but a sane, finite interval falls back to N++'s own 7000 ms. */
function timing(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1000 && value <= 600_000
    ? Math.round(value)
    : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Turn whatever came out of storage into a complete, in-range `Preferences`. A record written
 * by an older version, or one hand-edited in devtools, must not be able to break the app: unknown
 * keys are dropped, wrong types fall back to N++'s default, and the zoom is clamped.
 */
export function normalisePreferences(raw: unknown): Preferences {
  const source = isRecord(raw) ? raw : {};
  const zoom =
    typeof source.zoom === "number" && Number.isFinite(source.zoom)
      ? Math.min(ZOOM_LIMITS.max, Math.max(ZOOM_LIMITS.min, Math.round(source.zoom)))
      : NPP_PREFERENCES.zoom;

  return {
    rememberLastSession: bool(source.rememberLastSession, NPP_PREFERENCES.rememberLastSession),
    keepSessionAbsentFileEntries: bool(
      source.keepSessionAbsentFileEntries,
      NPP_PREFERENCES.keepSessionAbsentFileEntries,
    ),
    snapshotMode: bool(source.snapshotMode, NPP_PREFERENCES.snapshotMode),
    snapshotBackupTiming: timing(source.snapshotBackupTiming, NPP_PREFERENCES.snapshotBackupTiming),
    toolbarVisible: bool(source.toolbarVisible, NPP_PREFERENCES.toolbarVisible),
    toolbarLayout: oneOf(source.toolbarLayout, TOOLBAR_LAYOUTS, NPP_PREFERENCES.toolbarLayout),
    theme: oneOf(source.theme, THEMES, NPP_PREFERENCES.theme),
    zoom,
  };
}

/**
 * The editor's font size for a zoom level: the style's own size plus the zoom, in points
 * (Scintilla's model — a zoom level *is* a point count). Never below 1 pt, so a corrupt record
 * cannot make the text vanish.
 */
export function fontSizeForZoom(zoom: number, basePt: number = BASE_FONT_SIZE_PT): string {
  return `${Math.max(1, Math.round(basePt + zoom))}pt`;
}

/** True when `zoom` is inside Scintilla's incremental range. */
export function zoomInRange(zoom: number): boolean {
  return Number.isFinite(zoom) && zoom >= ZOOM_LIMITS.min && zoom <= ZOOM_LIMITS.max;
}

/** Clamp a zoom to Scintilla's range, for the View ▸ Zoom commands. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return NPP_PREFERENCES.zoom;
  return Math.min(ZOOM_LIMITS.max, Math.max(ZOOM_LIMITS.min, Math.round(zoom)));
}

/** Read the stored preferences; N++'s defaults when there is nothing stored (or no storage). */
export async function loadPreferences(): Promise<Preferences> {
  const stored = await idbGet<unknown>("preferences", PREFERENCES_KEY);
  return normalisePreferences(stored);
}

/**
 * Merge a change into the stored preferences and return the merged whole. The value returned is
 * what was written, so a caller never has to guess whether the write landed.
 */
export async function savePreferences(patch: Partial<Preferences>): Promise<Preferences> {
  const merged = normalisePreferences({ ...(await loadPreferences()), ...patch });
  await idbPut("preferences", merged, PREFERENCES_KEY);
  return merged;
}
