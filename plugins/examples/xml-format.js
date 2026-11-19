/**
 * XML format — prettify the whole document, or just the selections.
 *
 * Every formatter is a trade with someone's data, so this one is explicit about
 * what it will and will not touch:
 *
 *   - element-only content is re-indented;
 *   - an element whose only child is text stays on one line, and if that text
 *     itself spans lines the element is left exactly as written — re-indenting it
 *     would change the text node's own whitespace;
 *   - **mixed content** (text and elements together) is left exactly as written.
 *     Reflowing it would insert whitespace into text that a reader may care about,
 *     which is corruption dressed as tidiness. The plugin says how many subtrees
 *     it left alone rather than doing it silently.
 *   - invalid XML changes nothing and names the line.
 *
 * The parser is a small one on purpose: a plugin is one module with no imports,
 * so there is no dependency to lean on, and the subset here (elements, attributes
 * kept verbatim, comments, CDATA, processing instructions, DOCTYPE) is what
 * configuration files actually contain.
 */
export default {
  id: "npp.xmlformat",
  name: "XML Format",
  version: "1.0.0",
  apiVersion: 1,

  activate(ctx) {
    ctx.commands.register({
      id: "format",
      label: "XML: Format Document or Selection",
      run() {
        const selections = ctx.editor.selections();
        const text = ctx.editor.text() ?? "";
        const withSelection = selections.some((range) => range.from !== range.to);

        if (withSelection) {
          let preserved = 0;
          const changed = ctx.editor.replaceSelections((selected) => {
            try {
              const result = formatXml(selected, { fragment: true });
              preserved += result.preserved;
              return result.text;
            } catch (error) {
              ctx.ui.notice("Not XML", `The selection was left alone: ${message(error)}`, {
                kind: "xml",
              });
              return selected;
            }
          });
          if (changed && preserved > 0) mixedNotice(ctx, preserved);
          return changed;
        }

        try {
          const result = formatXml(text);
          if (result.text === text) return false;
          ctx.editor.setText(result.text);
          if (result.preserved > 0) mixedNotice(ctx, result.preserved);
          return true;
        } catch (error) {
          ctx.ui.notice("Not XML", `The document was left alone: ${message(error)}`, { kind: "xml" });
          return false;
        }
      },
    });
  },
};

function mixedNotice(ctx, count) {
  ctx.ui.notice(
    "XML",
    `${count} element${count === 1 ? " has" : "s have"} mixed content and ${
      count === 1 ? "was" : "were"
    } left exactly as written — re-indenting them would change their text.`,
    { kind: "xml" },
  );
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

/* ------------------------------------------------------------------ public */

/**
 * Format an XML string.
 *
 * @param {string} source
 * @param {{ fragment?: boolean, indent?: string }} [options]
 * @returns {{ text: string, preserved: number }}
 */
export function formatXml(source, options = {}) {
  const fragment = options.fragment === true;
  const indentUnit = options.indent ?? "  ";
  const parsed = parse(source, fragment);
  const lines = serialize(parsed.nodes, source, indentUnit, 0);
  return { text: lines.join("\n") + (lines.length ? "\n" : ""), preserved: parsed.preserved };
}

/* --------------------------------------------------------------- tokenizer */

function tokenize(source) {
  const tokens = [];
  let at = 0;

  while (at < source.length) {
    if (source[at] !== "<") {
      const next = source.indexOf("<", at);
      const end = next === -1 ? source.length : next;
      tokens.push({ type: "text", raw: source.slice(at, end), start: at, end });
      at = end;
      continue;
    }

    if (source.startsWith("<!--", at)) {
      const end = source.indexOf("-->", at + 4);
      if (end === -1) throw new XmlError("a comment is never closed (<!-- without -->)", at, source);
      tokens.push({ type: "comment", raw: source.slice(at, end + 3), start: at, end: end + 3 });
      at = end + 3;
      continue;
    }

    if (source.startsWith("<![CDATA[", at)) {
      const end = source.indexOf("]]>", at + 9);
      if (end === -1) throw new XmlError("a CDATA section is never closed", at, source);
      tokens.push({ type: "cdata", raw: source.slice(at, end + 3), start: at, end: end + 3 });
      at = end + 3;
      continue;
    }

    if (source.startsWith("<?", at)) {
      const end = source.indexOf("?>", at + 2);
      if (end === -1) throw new XmlError("a processing instruction is never closed", at, source);
      tokens.push({ type: "pi", raw: source.slice(at, end + 2), start: at, end: end + 2 });
      at = end + 2;
      continue;
    }

    if (source.startsWith("<!", at)) {
      // DOCTYPE (possibly with an internal subset in square brackets).
      let i = at + 2;
      let brackets = 0;
      let quote = null;
      while (i < source.length) {
        const c = source[i];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
          quote = c;
        } else if (c === "[") {
          brackets += 1;
        } else if (c === "]") {
          brackets -= 1;
        } else if (c === ">" && brackets <= 0) {
          break;
        }
        i += 1;
      }
      if (i >= source.length) throw new XmlError("a <!DOCTYPE> declaration is never closed", at, source);
      tokens.push({ type: "doctype", raw: source.slice(at, i + 1), start: at, end: i + 1 });
      at = i + 1;
      continue;
    }

    if (source.startsWith("</", at)) {
      const end = source.indexOf(">", at + 2);
      if (end === -1) throw new XmlError("a closing tag is never closed", at, source);
      const name = source.slice(at + 2, end).trim();
      if (!/^[A-Za-z_:][-A-Za-z0-9_:.]*$/.test(name)) {
        throw new XmlError(`“</${name}>” is not a tag name`, at, source);
      }
      tokens.push({ type: "close", name, raw: source.slice(at, end + 1), start: at, end: end + 1 });
      at = end + 1;
      continue;
    }

    // An opening tag: scan to its '>' while respecting quoted attribute values,
    // which is what lets <a title="a > b"> stay one tag.
    let i = at + 1;
    let quote = null;
    while (i < source.length) {
      const c = source[i];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === "<") {
        throw new XmlError("a tag is never closed before the next “<”", at, source);
      } else if (c === ">") {
        break;
      }
      i += 1;
    }
    if (i >= source.length) throw new XmlError("a tag is never closed", at, source);

    const inner = source.slice(at + 1, i);
    const selfClosing = inner.endsWith("/");
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const nameMatch = /^([A-Za-z_:][-A-Za-z0-9_:.]*)(\s|$)/.exec(body + " ");
    if (!nameMatch) throw new XmlError(`“<${body.trim().slice(0, 20)}>” has no tag name`, at, source);
    const name = nameMatch[1];

    tokens.push({
      type: "open",
      name,
      selfClosing,
      raw: source.slice(at, i + 1),
      start: at,
      end: i + 1,
    });
    at = i + 1;
  }

  return tokens;
}

/* ------------------------------------------------------------------ parser */

function parse(source, fragment) {
  const tokens = tokenize(source);
  const nodes = [];
  const stack = [];
  let preserved = 0;
  let rootSeen = false;

  const append = (node) => {
    if (stack.length > 0) stack[stack.length - 1].children.push(node);
    else nodes.push(node);
  };

  for (const token of tokens) {
    if (token.type === "text") {
      if (stack.length === 0) {
        if (token.raw.trim() === "") continue;
        if (!fragment) {
          throw new XmlError("text appears outside the root element", token.start, source);
        }
        nodes.push({ type: "text", text: token.raw });
        continue;
      }
      append({ type: "text", text: token.raw });
      continue;
    }

    if (token.type === "open") {
      if (stack.length === 0) {
        if (!fragment && rootSeen) {
          throw new XmlError(`a second root element <${token.name}> starts here`, token.start, source);
        }
        rootSeen = true;
      }
      const node = {
        type: "element",
        name: token.name,
        startTag: token.raw,
        selfClosing: token.selfClosing,
        start: token.start,
        rawEnd: token.end,
        children: [],
      };
      append(node);
      if (!token.selfClosing) stack.push(node);
      continue;
    }

    if (token.type === "close") {
      const top = stack.pop();
      if (!top) throw new XmlError(`</${token.name}> closes nothing`, token.start, source);
      if (top.name !== token.name) {
        throw new XmlError(`</${token.name}> does not close <${top.name}>`, token.start, source);
      }
      top.rawEnd = token.end;
      continue;
    }

    if (token.type === "cdata" && stack.length === 0 && !fragment) {
      throw new XmlError("a CDATA section appears outside the root element", token.start, source);
    }
    append({ type: token.type, text: token.raw });
  }

  if (stack.length > 0) {
    const open = stack[stack.length - 1];
    throw new XmlError(`<${open.name}> is never closed`, open.start, source);
  }

  if (!fragment) {
    const roots = nodes.filter((node) => node.type === "element");
    if (roots.length === 0) throw new XmlError("there is no root element", 0, source);
  }

  // Count mixed-content elements once, while the tree is in hand.
  const walk = (list) => {
    for (const node of list) {
      if (node.type !== "element") continue;
      const hasElement = node.children.some((child) => child.type === "element");
      const hasText = node.children.some(
        (child) => child.type === "text" && child.text.trim() !== "",
      );
      if (hasElement && hasText) preserved += 1;
      walk(node.children);
    }
  };
  walk(nodes);

  return { nodes, preserved };
}

/* -------------------------------------------------------------- serializer */

function serialize(nodes, source, indentUnit, depth) {
  const lines = [];
  const pad = indentUnit.repeat(depth);

  for (const node of nodes) {
    if (node.type === "text") {
      const value = node.text.trim();
      if (value !== "") lines.push(pad + value);
      continue;
    }

    if (node.type !== "element") {
      // comment, CDATA, processing instruction, DOCTYPE
      lines.push(pad + node.text.trim());
      continue;
    }

    if (node.selfClosing) {
      lines.push(pad + node.startTag);
      continue;
    }

    const elementChildren = node.children.filter((child) => child.type === "element");
    const textChildren = node.children.filter(
      (child) => child.type === "text" && child.text.trim() !== "",
    );
    const otherChildren = node.children.filter(
      (child) => child.type !== "element" && child.type !== "text",
    );

    // Mixed content: leave the subtree byte-for-byte as the author wrote it.
    if (elementChildren.length > 0 && textChildren.length > 0) {
      lines.push(pad + source.slice(node.start, node.rawEnd));
      continue;
    }

    if (elementChildren.length === 0) {
      const inner = node.children
        .map((child) => (child.type === "text" ? child.text : child.text))
        .join("");
      const flat = inner.trim();
      const multilineText = textChildren.some((child) => child.text.includes("\n"));

      // Text that itself spans lines keeps its own whitespace: the element is
      // written out unchanged rather than re-indented around it.
      if (otherChildren.length === 0 && !multilineText) {
        lines.push(pad + node.startTag + flat + `</${node.name}>`);
        continue;
      }
      if (multilineText) {
        lines.push(pad + source.slice(node.start, node.rawEnd));
        continue;
      }
    }

    lines.push(pad + node.startTag);
    const kept = node.children.filter(
      (child) => child.type !== "text" || child.text.trim() !== "",
    );
    lines.push(...serialize(kept, source, indentUnit, depth + 1));
    lines.push(pad + `</${node.name}>`);
  }

  return lines;
}

/* ------------------------------------------------------------------ errors */

class XmlError extends Error {
  constructor(message, offset, source) {
    super(`line ${lineAt(source, offset)}: ${message}`);
    this.name = "XmlError";
  }
}

function lineAt(source, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i += 1) {
    if (source[i] === "\n") line += 1;
  }
  return line;
}
