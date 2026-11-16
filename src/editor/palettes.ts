/**
 * The two palettes this port draws Notepad++ in, kept free of CodeMirror imports so the
 * colour tables can be read in Node (`scripts/test-themes.mjs`) as well as in the browser.
 *
 * **Light** — `stylers.model.xml`'s GlobalStyles and the C lexer, which is what every task
 * before Task 10 drew (the `<WordsStyle>` name is beside each value in `notepadpp-config.ts`'s
 * history; the values themselves were cited there).
 *
 * **Dark** — N++'s own Dark Mode: the editor colours from `installer/themes/DarkModeDefault.xml`
 * and, for the chrome, `NppDarkMode.cpp`'s `Colors` table (see `style.css`). Task 10 built it.
 */
import type { ThemeName } from "../storage/preferences.ts";

/** stylers.model.xml → GlobalStyles. Names are N++'s own. */
export const NPP_COLORS = {
  foreground: "#000000", // Default Style fgColor
  background: "#ffffff", // Default Style bgColor
  activeLine: "#e8e8ff", // Current line background colour
  selection: "#c0c0c0", // Selected text colour
  caret: "#8000ff", // Caret colour
  gutterBackground: "#e4e4e4", // Line number margin bgColor
  gutterForeground: "#808080", // Line number margin fgColor
  foldMarginBackground: "#e9e9e9", // Fold margin bgColor
  foldActive: "#ff0000", // Fold active fgColor
  braceHighlight: "#ff0000", // Brace highlight style fgColor (fontStyle 1 = bold)
  badBrace: "#800000", // Bad brace colour
  indentGuide: "#c0c0c0", // Indent guideline style
  whitespaceSymbol: "#ffb56a", // White space symbol
  smartHighlight: "#00ff00", // Smart Highlighting
  edge: "#80ffff", // Edge colour
  markStyle1: "#00ffff", // Mark Style 1 — the colour of the "Find Mark style" (stylers.model.xml)
  bookmark: "#5f7bd7", // bookmark14, the marker bitmap: centre pixel (rgba_icons.h)
} as const;

/**
 * Every key a palette must define. Both themes are held to it — at compile time here, and at
 * run time by `scripts/test-themes.mjs`, which compares the two tables key by key.
 */
export interface NppColours {
  foreground: string;
  background: string;
  activeLine: string;
  selection: string;
  caret: string;
  gutterBackground: string;
  gutterForeground: string;
  foldMarginBackground: string;
  foldActive: string;
  braceHighlight: string;
  badBrace: string;
  indentGuide: string;
  whitespaceSymbol: string;
  smartHighlight: string;
  edge: string;
  markStyle1: string;
  bookmark: string;
}

/**
 * N++'s Dark Mode palette, from `installer/themes/DarkModeDefault.xml` — the
 * `<WidgetStyle>` name is beside each value. The chrome half of the same mode lives in
 * `NppDarkMode.cpp`'s `Colors` table and is applied by `style.css`, because chrome is CSS;
 * these are the editor's own colours.
 *
 * The bookmark dot keeps the light value on purpose: N++ does not recolour its marker
 * bitmaps for dark mode (`rgba_icons.h`), and the dot is drawn at 27% alpha over the
 * margin either way.
 */
export const DARK_COLORS: NppColours = {
  foreground: "#dcdccc", // Default Style fgColor
  background: "#3f3f3f", // Default Style bgColor
  activeLine: "#101010", // Current line background colour
  selection: "#585858", // Selected text colour bgColor (N++ also sets fgColor 000000)
  caret: "#8faf9f", // Caret colour
  gutterBackground: "#0c0c0c", // Line number margin bgColor
  gutterForeground: "#8a8a8a", // Line number margin fgColor
  foldMarginBackground: "#101010", // Fold margin bgColor
  foldActive: "#7f9f7f", // Fold active
  braceHighlight: "#f0f9f9", // Brace highlight style (fontStyle 1 = bold)
  badBrace: "#f09f9f", // Bad brace colour
  indentGuide: "#4f5f5f", // Indent guideline style
  whitespaceSymbol: "#5f5f5f", // White space symbol
  smartHighlight: "#358a35", // Smart Highlighting
  edge: "#4f5f5f", // Edge colour
  markStyle1: "#88b090", // Mark Style 1 (the Find Mark style)
  bookmark: "#5f7bd7", // bookmark14 bitmap — unchanged in N++'s dark mode
};

/** A theme is a palette plus the one fact the rest of the app needs about it. */
export interface NppPalette {
  readonly dark: boolean;
  readonly colors: NppColours;
}

export const PALETTES: Record<ThemeName, NppPalette> = {
  notepadpp: { dark: false, colors: NPP_COLORS },
  dark: { dark: true, colors: DARK_COLORS },
};

/** What a theme name this build does not know falls back to: N++'s light styles. */
const DEFAULT_PALETTE: NppPalette = PALETTES.notepadpp;

/** The palette for a stored theme name, never null — an unknown name is light, not broken. */
export function paletteFor(theme?: ThemeName): NppPalette {
  return (theme && PALETTES[theme]) || DEFAULT_PALETTE;
}
