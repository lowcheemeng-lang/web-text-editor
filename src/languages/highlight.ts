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
import type { Extension } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";

import { NPP_TOKEN_COLORS, type TokenColours } from "./token-colours.ts";

// The tables live in `token-colours.ts` — free of CodeMirror imports, so `scripts/test-themes.mjs`
// can compare them in Node. Re-exported here because this is the module the editor imports.
export { NPP_TOKEN_COLORS, DARK_TOKEN_COLORS, type TokenColours } from "./token-colours.ts";

/**
 * The default has to be honest about what it cannot colour. Two things CM6 offers that N++
 * has no colour for, left at the document's own foreground:
 *   - function and method **names** — the C lexer has no style for them at all (its
 *     `IDENTIFIER` row does not exist; `DEFAULT` is 000000), and the lexers that do differ
 *     from each other. Inventing one colour for 140 languages would be the port's taste,
 *     not N++'s;
 *   - punctuation and brackets — `DEFAULT`, except the matched-brace highlight, which
 *     Task 3 already themes red.
 */
export function nppHighlightStyle(colours: TokenColours = NPP_TOKEN_COLORS): HighlightStyle {
  return HighlightStyle.define([
    { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword, t.self, t.modifier], color: colours.keyword, fontWeight: "bold" },
    { tag: [t.typeName, t.className, t.namespace, t.labelName], color: colours.type },
    { tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom, t.unit], color: colours.number },
    { tag: [t.string, t.special(t.string), t.character, t.attributeValue], color: colours.string },
    { tag: [t.comment, t.lineComment, t.blockComment], color: colours.comment },
    { tag: [t.docComment, t.special(t.comment)], color: colours.docComment },
    { tag: [t.operator, t.derefOperator, t.arithmeticOperator, t.logicOperator, t.bitwiseOperator, t.compareOperator, t.updateOperator, t.definitionOperator, t.typeOperator, t.controlOperator], color: colours.operator, fontWeight: "bold" },
    { tag: [t.meta, t.documentMeta, t.annotation, t.processingInstruction, t.macroName], color: colours.preprocessor },
    { tag: [t.tagName], color: colours.tag },
    { tag: [t.angleBracket], color: colours.tag },
    { tag: [t.attributeName], color: colours.attribute },
    { tag: [t.propertyName, t.definition(t.propertyName)], color: colours.property },
    { tag: [t.escape], color: colours.escape, fontWeight: "bold" },
    { tag: [t.regexp], color: colours.regexp, fontWeight: "bold" },
    { tag: [t.invalid], color: colours.error },
    { tag: [t.inserted], color: colours.added },
    { tag: [t.deleted], color: colours.removed },
    { tag: [t.heading, t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], color: colours.heading, fontWeight: "bold" },
    { tag: [t.strong], color: colours.strong, fontWeight: "bold" },
    { tag: [t.emphasis], color: colours.emphasis, fontStyle: "italic" },
    { tag: [t.monospace], color: colours.code, fontWeight: "bold", fontStyle: "italic" },
    { tag: [t.link, t.url], color: colours.link },
    { tag: [t.strikethrough], color: colours.strikethrough, fontWeight: "bold" },
    { tag: [t.list, t.quote, t.contentSeparator, t.punctuation, t.separator, t.bracket, t.squareBracket, t.paren, t.brace, t.variableName, t.function(t.variableName), t.function(t.propertyName)], color: null },
  ]);
}

/**
 * The extension `notepadpp-config.ts` installs, for whichever theme is in force. A function,
 * not a constant, because the token palette follows the theme (Task 10) and the grammar itself
 * must not change when it does.
 */
export function nppHighlighting(colours: TokenColours = NPP_TOKEN_COLORS): Extension {
  return syntaxHighlighting(nppHighlightStyle(colours));
}
