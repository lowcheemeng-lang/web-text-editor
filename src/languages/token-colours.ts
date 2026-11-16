/**
 * N++'s syntax colours, one table per theme. Kept free of CodeMirror imports so the tables can
 * be read in Node (`scripts/test-themes.mjs`) as well as in the browser; `highlight.ts` turns
 * them into a `HighlightStyle`.
 *
 * **Light** — `stylers.model.xml`, with the C lexer as the spine (the reasoning is in
 * `highlight.ts`). **Dark** — `installer/themes/DarkModeDefault.xml`, N++'s own dark theme.
 * The markdown tokens have no dark counterpart there (the theme ships no UDL styles), so their
 * dark values are approximations and are labelled as such.
 */

/** N++'s light token colours, with the lexer each comes from. */
export const NPP_TOKEN_COLORS = {
  keyword: "#0000ff", // c: INSTRUCTION WORD
  type: "#8000ff", // c: TYPE WORD
  number: "#ff8000", // c: NUMBER
  string: "#808080", // c: STRING
  comment: "#008000", // c: COMMENT / COMMENT LINE
  docComment: "#008080", // c: COMMENT DOC
  operator: "#000080", // c: OPERATOR
  preprocessor: "#804000", // c: PREPROCESSOR
  tag: "#0000ff", // html/xml: TAG, TAG END
  attribute: "#ff0000", // html/xml: ATTRIBUTE
  property: "#8000ff", // json: PROPERTY NAME
  escape: "#0000ff", // json: ESCAPE SEQUENCE
  regexp: "#000000", // c: REGEX (bold)
  error: "#ff0000", // yaml: ERROR
  added: "#0080ff", // diff: ADDED
  removed: "#808040", // diff: DELETED
  // markdown._preinstalled.udl.xml: LINE COMMENTS (1), KEYWORDS4 (** __, 1), KEYWORDS5 (* _, 2),
  // KEYWORDS3 (*** ___, 3), DELIMITERS3 (```…```, 3), KEYWORDS1 (urls, 0), KEYWORDS2 (==== ----, 1)
  heading: "#ff8000",
  strong: "#000080",
  emphasis: "#000080",
  code: "#000080",
  link: "#8000ff",
  strikethrough: "#ff8000",
} as const;

/**
 * The colours as a type, so the dark table cannot silently miss a key: `TokenColours` is
 * derived from the light table's own keys, and `scripts/test-themes.mjs` compares the two
 * tables key by key at run time as well.
 */
export type TokenColours = { [K in keyof typeof NPP_TOKEN_COLORS]: string };

/**
 * N++'s Dark Mode token colours, from `installer/themes/DarkModeDefault.xml` (N++'s dark
 * theme, itself based on Zenburn). Same spine as the light table — the C lexer, plus
 * HTML/XML, JSON and diff for what C has no opinion about — with the `<WordsStyle>` name in
 * each comment. Two honesty notes:
 *
 *   - the markdown tokens have **no dark counterpart**: DarkModeDefault.xml ships no UDL
 *     styles, so `heading`/`strong`/`emphasis`/`code`/`strikethrough` are mapped to the
 *     nearest Zenburn style (DFC47D, CEDF99, DCDCCC italic, 8CD0D3, FFCFAF) rather than
 *     passed off as N++'s own;
 *   - `link` is not a lexer colour here: it is NppDarkMode.cpp's `linkTextColor` (FFFF00).
 */
export const DARK_TOKEN_COLORS: TokenColours = {
  keyword: "#dfc47d", // c: INSTRUCTION WORD (fontStyle 1)
  type: "#cedf99", // c: TYPE WORD (fontStyle 1)
  number: "#8cd0d3", // c: NUMBER
  string: "#cc9393", // c: STRING
  comment: "#7f9f7f", // c: COMMENT / COMMENT LINE
  docComment: "#7f9f7f", // c: COMMENT DOC
  operator: "#9f9d6d", // c: OPERATOR (fontStyle 1)
  preprocessor: "#ffcfaf", // c: PREPROCESSOR
  tag: "#e3ceab", // html/xml: TAG, TAG END
  attribute: "#dfdfdf", // html: ATTRIBUTE
  property: "#cedf99", // json: PROPERTY NAME
  escape: "#dca3a3", // json: ESCAPE SEQUENCE
  regexp: "#c89191", // c: REGEX
  error: "#ebd6eb", // yaml: ERROR
  added: "#e3ceab", // diff: ADDED
  removed: "#cfbfaf", // diff: DELETED
  heading: "#dfc47d", // approximation — no markdown UDL in the dark theme
  strong: "#cedf99", // approximation
  emphasis: "#dcdccc", // approximation — Default Style fg, italic
  code: "#8cd0d3", // approximation
  link: "#ffff00", // NppDarkMode.cpp: linkTextColor
  strikethrough: "#ffcfaf", // approximation
};
