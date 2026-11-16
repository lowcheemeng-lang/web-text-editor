#!/usr/bin/env node
/**
 * Task 10 — the two palettes, checked without a browser.
 *
 *     node --experimental-strip-types scripts/test-themes.mjs
 *
 * The browser check (`scripts/verify-task10.py`) proves the theme reaches the screen. This one
 * proves the tables behind it are complete and honest, which is the failure a screenshot cannot
 * see: a palette missing one key, a dark table that silently kept a light colour, or a token
 * colour that is unreadable on the background it is actually drawn on.
 *
 * The contrast numbers are WCAG 2.1's ratio, computed here rather than asserted from memory.
 * **Neither palette meets WCAG AA for every token, and N++ is the reason:** its light theme
 * ships number/heading at 2.52:1 on white, and DarkModeDefault.xml puts five colours below
 * 4.5:1 on its #3f3f3f background (comment and docComment 3.59, operator 3.77, regexp 3.97,
 * string 4.09). This port keeps N++'s values — the task is N++'s look, not a redesigned one —
 * so the checks pin both sets by name. That way a palette edit has to say what it changed and
 * these numbers cannot drift silently.
 */
import { PALETTES, DARK_COLORS, NPP_COLORS, paletteFor } from "../src/editor/palettes.ts";
import { DARK_TOKEN_COLORS, NPP_TOKEN_COLORS } from "../src/languages/token-colours.ts";
import {
  NPP_PREFERENCES,
  THEMES,
  normalisePreferences,
  readThemeMirror,
} from "../src/storage/preferences.ts";

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`PASS  ${name}${detail ? `  [${detail}]` : ""}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`FAIL  ${name}${detail ? `  [${detail}]` : ""}`);
  }
}

const keys = (object) => Object.keys(object).sort();
const sameKeys = (a, b) => JSON.stringify(keys(a)) === JSON.stringify(keys(b));
const isHex = (value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

/** WCAG 2.1 relative luminance and contrast ratio. */
function luminance(hex) {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// ── the theme list and the preference ───────────────────────────────────────
check(
  "the app ships exactly N++'s light styles and Dark Mode",
  JSON.stringify(THEMES) === JSON.stringify(["notepadpp", "dark"]),
  JSON.stringify(THEMES),
);
check(
  "both theme names resolve to a palette, and the default is N++'s light one",
  PALETTES.notepadpp?.dark === false && PALETTES.dark?.dark === true,
);
check(
  "an unknown or missing theme name falls back to light instead of failing",
  paletteFor(undefined) === PALETTES.notepadpp && paletteFor("nonsense") === PALETTES.notepadpp,
);
check(
  "the stored preference accepts 'dark' and rejects anything else",
  normalisePreferences({ theme: "dark" }).theme === "dark" &&
    normalisePreferences({ theme: "midnight" }).theme === NPP_PREFERENCES.theme,
);
check(
  "the synchronous mirror is absent in Node (fail-soft, not a crash)",
  readThemeMirror() === null,
  String(readThemeMirror()),
);

// ── the two palettes ───────────────────────────────────────────────────────
check(
  "the light and dark palettes define the same keys",
  sameKeys(NPP_COLORS, DARK_COLORS),
  `${keys(NPP_COLORS).length} keys`,
);
const badValues = Object.entries(DARK_COLORS)
  .filter(([, value]) => !isHex(value))
  .map(([key]) => key);
check("every dark value is a 6-digit hex colour", badValues.length === 0, badValues.join(", "));

const mustDiffer = [
  "foreground",
  "background",
  "activeLine",
  "selection",
  "caret",
  "gutterBackground",
  "gutterForeground",
  "foldMarginBackground",
  "braceHighlight",
  "badBrace",
  "indentGuide",
  "whitespaceSymbol",
  "smartHighlight",
  "edge",
  "markStyle1",
];
const unchanged = mustDiffer.filter((key) => DARK_COLORS[key] === NPP_COLORS[key]);
check(
  "every editor colour that should change with the theme does change",
  unchanged.length === 0,
  unchanged.join(", "),
);
check(
  "the dark palette is N++'s own (background 3f3f3f, Default Style fg dcdccc)",
  DARK_COLORS.background === "#3f3f3f" && DARK_COLORS.foreground === "#dcdccc",
);

// ── the token tables ───────────────────────────────────────────────────────
check(
  "the light and dark token tables define the same keys",
  sameKeys(NPP_TOKEN_COLORS, DARK_TOKEN_COLORS),
  `${keys(NPP_TOKEN_COLORS).length} tokens`,
);
const badTokens = Object.entries(DARK_TOKEN_COLORS)
  .filter(([, value]) => !isHex(value))
  .map(([key]) => key);
check("every dark token colour is a 6-digit hex", badTokens.length === 0, badTokens.join(", "));
check(
  "the dark token table is not the light one under another name",
  keys(NPP_TOKEN_COLORS).filter((key) => DARK_TOKEN_COLORS[key] === NPP_TOKEN_COLORS[key]).length === 0,
);
check(
  "the keyword/comment/number colours are the dark theme's own",
  DARK_TOKEN_COLORS.keyword === "#dfc47d" &&
    DARK_TOKEN_COLORS.comment === "#7f9f7f" &&
    DARK_TOKEN_COLORS.number === "#8cd0d3",
);

// ── contrast, against the background each theme actually draws ─────────────
const belowFloor = keys(DARK_TOKEN_COLORS).filter(
  (key) => contrast(DARK_TOKEN_COLORS[key], DARK_COLORS.background) < 3,
);
check(
  "every dark token colour clears 3:1 against the dark background",
  belowFloor.length === 0,
  belowFloor.join(", "),
);
const belowAA = keys(DARK_TOKEN_COLORS)
  .filter((key) => contrast(DARK_TOKEN_COLORS[key], DARK_COLORS.background) < 4.5)
  .sort();
check(
  "the dark tokens below 4.5:1 are exactly the five N++ ships",
  JSON.stringify(belowAA) === JSON.stringify(["comment", "docComment", "operator", "regexp", "string"]),
  belowAA
    .map((key) => `${key} ${contrast(DARK_TOKEN_COLORS[key], DARK_COLORS.background).toFixed(2)}`)
    .join(", "),
);
const lightBelowAA = keys(NPP_TOKEN_COLORS)
  .filter((key) => contrast(NPP_TOKEN_COLORS[key], NPP_COLORS.background) < 4.5)
  .sort();
check(
  "the light tokens below 4.5:1 are exactly the eight N++ ships",
  JSON.stringify(lightBelowAA) ===
    JSON.stringify(["added", "attribute", "error", "heading", "number", "removed", "strikethrough", "string"]),
  lightBelowAA
    .map((key) => `${key} ${contrast(NPP_TOKEN_COLORS[key], NPP_COLORS.background).toFixed(2)}`)
    .join(", "),
);
const worst = (colours, background) =>
  Math.min(...keys(colours).map((key) => contrast(colours[key], background)));
check(
  "neither theme's worst token falls below N++'s own 2.5:1 floor",
  worst(NPP_TOKEN_COLORS, NPP_COLORS.background) >= 2.5 &&
    worst(DARK_TOKEN_COLORS, DARK_COLORS.background) >= 2.5,
  `light ${worst(NPP_TOKEN_COLORS, NPP_COLORS.background).toFixed(2)}, dark ${worst(
    DARK_TOKEN_COLORS,
    DARK_COLORS.background,
  ).toFixed(2)}`,
);

// ── the chrome table in style.css is the one N++ documents ─────────────────
// The CSS cannot be imported here, so the check reads the file and asserts the sourced values.
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
const darkBlock = css.slice(css.indexOf('[data-theme="dark"]'), css.indexOf("* {\n  box-sizing"));
const chromeValues = {
  "--chrome-bg": "#202020", // NppDarkMode.cpp background
  "--chrome-hover": "#383838", // softerBackground
  "--chrome-active": "#454545", // hotBackground
  "--chrome-text": "#e0e0e0", // textColor
  "--chrome-border": "#646464", // edgeColor
  "--pane-bg": "#3f3f3f", // DarkModeDefault.xml Default Style bgColor
};
const missing = Object.entries(chromeValues)
  .filter(([name, value]) => !new RegExp(`${name}:\\s*${value}`, "i").test(darkBlock))
  .map(([name]) => name);
check(
  "style.css carries N++'s dark chrome values under [data-theme=\"dark\"]",
  missing.length === 0,
  missing.join(", "),
);

console.log(`\n${passed}/${passed + failed} checks passed`);
if (failed > 0) {
  console.log(`FAILED: ${failures.join(" | ")}`);
  process.exit(1);
}
