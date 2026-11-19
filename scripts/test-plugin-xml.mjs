/**
 * Unit tests for plugins/examples/xml-format.js — no browser, no framework.
 *
 *     node scripts/test-plugin-xml.mjs
 *
 * The formatter is the risky half of that plugin: a formatter that rewrites text
 * nodes is a data-corruption tool with nice indentation. So the cases below pin
 * both sides — what it must reformat, and what it must leave exactly alone.
 */
import { formatXml } from "../plugins/examples/xml-format.js";

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`FAIL  ${name}${detail ? `  [${detail}]` : ""}`);
  }
}

function eq(name, actual, expected) {
  check(name, actual === expected, JSON.stringify(actual));
}

function throws(name, fn, includes) {
  try {
    fn();
    check(name, false, "did not throw");
  } catch (error) {
    const text = String(error.message ?? error);
    check(name, text.includes(includes), text);
  }
}

/* ------------------------------------------------------------ happy paths */

{
  const result = formatXml("<root><a>1</a><b><c>2</c></b></root>");
  eq(
    "element-only content is re-indented",
    result.text,
    "<root>\n  <a>1</a>\n  <b>\n    <c>2</c>\n  </b>\n</root>\n",
  );
  eq("nothing was preserved", result.preserved, 0);
}

{
  const source = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE note SYSTEM "note.dtd">
<note><!-- a comment --><to>Tove</to><body><p>hi</p></body></note>`;
  const result = formatXml(source);
  eq(
    "declaration, DOCTYPE and comments keep their place",
    result.text,
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE note SYSTEM "note.dtd">\n<note>\n  <!-- a comment -->\n  <to>Tove</to>\n  <body>\n    <p>hi</p>\n  </body>\n</note>\n`,
  );
}

{
  const result = formatXml('<a title="a > b" href=\'x &amp; y\'><b/></a>');
  eq(
    "an attribute containing “>” does not split the tag",
    result.text,
    '<a title="a > b" href=\'x &amp; y\'>\n  <b/>\n</a>\n',
  );
}

{
  const result = formatXml("<a><b></b><c> </c><d>x</d></a>");
  eq(
    "empty and whitespace-only elements stay simple",
    result.text,
    "<a>\n  <b></b>\n  <c></c>\n  <d>x</d>\n</a>\n",
  );
}

{
  const result = formatXml("<a><b>one <c>x</c> two</b></a>");
  eq(
    "mixed content is left exactly as written",
    result.text,
    "<a>\n  <b>one <c>x</c> two</b>\n</a>\n",
  );
  eq("mixed content is counted", result.preserved, 1);
}

{
  const source = "<a><b>line one\nline two</b></a>";
  const result = formatXml(source);
  check(
    "text that spans lines is preserved, not re-indented",
    result.text.includes("<b>line one\nline two</b>"),
    JSON.stringify(result.text),
  );
}

{
  const result = formatXml("<a><![CDATA[ if (a < b) { } ]]></a>");
  eq(
    "CDATA survives untouched",
    result.text,
    "<a>\n  <![CDATA[ if (a < b) { } ]]>\n</a>\n",
  );
}

{
  const result = formatXml("<a><b>&#233; &amp; &lt;</b></a>");
  eq(
    "entities are not decoded or re-escaped",
    result.text,
    "<a>\n  <b>&#233; &amp; &lt;</b>\n</a>\n",
  );
}

{
  const crlf = "<a>\r\n<b>1</b>\r\n</a>\r\n";
  const result = formatXml(crlf);
  check(
    "CRLF input is emitted with LF (the editor's own line ending)",
    !result.text.includes("\r"),
    JSON.stringify(result.text),
  );
}

{
  const once = formatXml("<a><b><c>1</c></b><d/></a>").text;
  const twice = formatXml(once).text;
  eq("formatting is idempotent", twice, once);
}

{
  const result = formatXml("<one/><two>x</two>", { fragment: true });
  eq("fragment mode allows several roots", result.text, "<one/>\n<two>x</two>\n");
}

{
  const result = formatXml("<a><b><c>1</c></b></a>", { indent: "\t" });
  eq("the indent string is configurable", result.text, "<a>\n\t<b>\n\t\t<c>1</c>\n\t</b>\n</a>\n");
}

/* --------------------------------------------------------------- refusals */

throws(
  "a mismatched close tag names both tags",
  () => formatXml("<a><b></a></b>"),
  "</a> does not close <b>",
);

throws("an unclosed element is reported", () => formatXml("<a><b></b>"), "<a> is never closed");

throws(
  "a second root is refused",
  () => formatXml("<a/><b/>"),
  "a second root element <b>",
);

throws(
  "text before the root is refused",
  () => formatXml("hello <a/>"),
  "text appears outside the root element",
);

throws(
  "an unclosed comment is refused",
  () => formatXml("<a><!-- oops</a>"),
  "comment is never closed",
);

throws("a document with no element is refused", () => formatXml("   "), "there is no root element");

throws(
  "the line number is in the message",
  () => formatXml("<a>\n  <b>\n</a>"),
  "line 3",
);

/* ------------------------------------------------------------------ summary */

console.log(`\n${"=".repeat(58)}`);
console.log(
  `TEST-PLUGIN-XML: ${failures.length === 0 ? "PASS" : "FAIL"}  (${passed}/${passed + failures.length} checks)`,
);
if (failures.length > 0) console.log(`failed: ${failures.join("; ")}`);
console.log("=".repeat(58));
process.exit(failures.length === 0 ? 0 : 1);
