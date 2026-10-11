/**
 * N++'s syntax colours as a CodeMirror 6 `HighlightStyle` — Task 6.
 *
 * Notepad++ has no single token palette: every lexer in `stylers.model.xml` carries its own
 * `<WordsStyle>` table. What makes one palette defensible here is `_langNameInfoArray`
 * (`ScintillaEditView.cpp:99`), whose `_lexerID` column shows which lexer each language
 * actually uses — and the largest family by far is the **C lexer**:
 *
 *   c · cpp · cs · rc · java · javascript (embedded) · actionscript · swift · typescript · go
 *
 * So the C lexer's table is the spine of the mapping below, with HTML/XML, JSON, CSS and the
 * preinstalled markdown UDL supplying the token kinds C has no opinion about (tags,
 * attributes, headings). Every colour is cited by lexer and `<WordsStyle name=…>`, and the
 * handful that are *not* N++'s are called out as approximations rather than passed off.
 *
 * The port is not pixel-identical and does not pretend to be: `fontStyle` in N++ is a
 * bitmask (1 bold, 2 italic, 3 both) applied per style, and CM6 concentrates it in
 * `fontWeight`/`fontStyle` on the same tag. Where a language's own lexer would have
 * disagreed with the C lexer (Ruby's `DEF NAME` is 8080FF bold, Python's is FF00FF), the
 * shared palette wins — one coherent look across 140 languages beats 140 faithful ones.
 */
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/** Colours, with the lexer each comes from. */
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
 * The default has to be honest about what it cannot colour. Two things CM6 offers that N++
 * has no colour for, left at the document's own black:
 *   - function and method **names** — the C lexer has no style for them at all (its
 *     `IDENTIFIER` row does not exist; `DEFAULT` is 000000), and the lexers that do differ
 *     from each other. Inventing one colour for 140 languages would be the port's taste,
 *     not N++'s;
 *   - punctuation and brackets — `DEFAULT` 000000, except the matched-brace highlight, which
 *     Task 3 already themes red.
 */
export const NPP_HIGHLIGHT_STYLE = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword, t.self, t.modifier], color: NPP_TOKEN_COLORS.keyword, fontWeight: "bold" },
  { tag: [t.typeName, t.className, t.namespace, t.labelName], color: NPP_TOKEN_COLORS.type },
  { tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom, t.unit], color: NPP_TOKEN_COLORS.number },
  { tag: [t.string, t.special(t.string), t.character, t.attributeValue], color: NPP_TOKEN_COLORS.string },
  { tag: [t.comment, t.lineComment, t.blockComment], color: NPP_TOKEN_COLORS.comment },
  { tag: [t.docComment, t.special(t.comment)], color: NPP_TOKEN_COLORS.docComment },
  { tag: [t.operator, t.derefOperator, t.arithmeticOperator, t.logicOperator, t.bitwiseOperator, t.compareOperator, t.updateOperator, t.definitionOperator, t.typeOperator, t.controlOperator], color: NPP_TOKEN_COLORS.operator, fontWeight: "bold" },
  { tag: [t.meta, t.documentMeta, t.annotation, t.processingInstruction, t.macroName], color: NPP_TOKEN_COLORS.preprocessor },
  { tag: [t.tagName], color: NPP_TOKEN_COLORS.tag },
  { tag: [t.angleBracket], color: NPP_TOKEN_COLORS.tag },
  { tag: [t.attributeName], color: NPP_TOKEN_COLORS.attribute },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: NPP_TOKEN_COLORS.property },
  { tag: [t.escape], color: NPP_TOKEN_COLORS.escape, fontWeight: "bold" },
  { tag: [t.regexp], color: NPP_TOKEN_COLORS.regexp, fontWeight: "bold" },
  { tag: [t.invalid], color: NPP_TOKEN_COLORS.error },
  { tag: [t.inserted], color: NPP_TOKEN_COLORS.added },
  { tag: [t.deleted], color: NPP_TOKEN_COLORS.removed },
  { tag: [t.heading, t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], color: NPP_TOKEN_COLORS.heading, fontWeight: "bold" },
  { tag: [t.strong], color: NPP_TOKEN_COLORS.strong, fontWeight: "bold" },
  { tag: [t.emphasis], color: NPP_TOKEN_COLORS.emphasis, fontStyle: "italic" },
  { tag: [t.monospace], color: NPP_TOKEN_COLORS.code, fontWeight: "bold", fontStyle: "italic" },
  { tag: [t.link, t.url], color: NPP_TOKEN_COLORS.link },
  { tag: [t.strikethrough], color: NPP_TOKEN_COLORS.strikethrough, fontWeight: "bold" },
  { tag: [t.list, t.quote, t.contentSeparator, t.punctuation, t.separator, t.bracket, t.squareBracket, t.paren, t.brace, t.variableName, t.function(t.variableName), t.function(t.propertyName)], color: null },
]);

/** The extension `notepadpp-config.ts` installs; one instance for every document. */
export const nppHighlighting = syntaxHighlighting(NPP_HIGHLIGHT_STYLE);
