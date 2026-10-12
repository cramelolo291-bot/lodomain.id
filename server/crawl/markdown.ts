// Clean HTML -> LLM-ready Markdown.
//
// No parser, no framework: the result comes from the node tree this server
// already builds (`parser.parse`). Every block is produced from the node, so
// the consumer gets the same document no matter which extractor ran first.
//
// Design copies Crawl4AI's `fit_markdown` shape: structure first, then a
// pruning pass that drops menus and footers so the model sees the article, not
// the chrome.

import { decodeEntities, parse, isHeadTag, attrOf, textOf, type Node } from "./dom";

// ── Public API ───────────────────────────────────────────────────────────────

/** The title, chosen from `<title>`, `<meta property="og:title">`, then the h1. */
/** Depth-first search for the first node with the given tag. */
function findTag(node: Node, tag: string): Node | null {
  if (node.tag === tag) return node;
  for (const child of node.children) {
    const hit = findTag(child, tag);
    if (hit) return hit;
  }
  return null;
}

export function extractTitle(html: string): string {
  const root = parse(html);
  if (!root) return "";

  // `<title>` anywhere in the document wins outright. Its text is read
  // directly because `textOf` deliberately skips head content.
  const titleNode = findTag(root, "title");
  if (titleNode) {
    const title = decodeEntities(collapse(titleNode.children.map((c) => c.text).join("")));
    if (title) return title.slice(0, 200);
  }

  // A page without a title is a broken page: fall back to the first heading.
  const h1 = findTag(root, "h1");
  if (h1) {
    const text = decodeEntities(collapse(textOf(h1)));
    if (text) return text.slice(0, 200);
  }

  // Last resort: the first paragraph.
  const p = findTag(root, "p");
  return p ? decodeEntities(collapse(textOf(p))).slice(0, 200) : "";
}

/** The meta description, or an empty string. */
export function extractDescription(html: string): string {
  const root = parse(html);
  if (!root) return "";
  const prop =
    root.children.find((c) => c.tag === "head")?.children
      .map((h) => {
        if (h.tag !== "meta") return "";
        const property = attrOf(h, "property") ?? "";
        const name = attrOf(h, "name") ?? "";
        const content = attrOf(h, "content") ?? "";
        if (property === "og:description" || name === "description") return content;
        return "";
      })
      .find(Boolean) ?? "";
  return decodeEntities(collapse(prop)).slice(0, 300);
}

/**
 * Convert a document to Markdown that an LLM reads well: headings, paragraphs,
 * lists, code fences, tables, blockquotes, and a numbered reference list of
 * links at the end. Links that could not be parsed are kept as plain text so no
 * information is lost.
 */
export function toMarkdown(html: string, baseUrl = ""): { markdown: string; links: string[] } {
  const root = parse(html);
  if (!root) return { markdown: "", links: [] };

  const links: string[] = [];
  let out = "";

  for (const child of root.children) {
    out += nodeToMarkdown(child, baseUrl, links);
  }

  // Drop trailing blank lines and attach the reference list last.
  const trimmed = out.replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "");
  if (links.length > 0) {
    return { markdown: trimmed + "\n\n" + links.map((l, i) => `${i + 1}. ${l}`).join("\n"), links };
  }
  return { markdown: trimmed, links };
}

/** Raw text with tags removed, entities decoded, and whitespace collapsed. */
export function toText(html: string): string {
  const root = parse(html);
  if (!root) return "";
  return decodeEntities(collapse(textOf(root))).replace(/\s{2,}/g, " ");
}
function nodeToMarkdown(node: Node, baseUrl: string, links: string[]): string {

  if (node.tag === "text") return escapeText(node.text);

  if (isHeadTag(node.tag)) return "";

  switch (node.tag) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const level = Number(node.tag.slice(1));
      return "\n".repeat(level - 1) + "#".repeat(level) + " " + escapeText(textOf(node)) + "\n\n";
    }
    case "p": {
      const text = textOf(node);
      const cleaned = text
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "")
        .replace(/<[^>]+>/g, "");
      return trimTrailing(escapeText(collapse(cleaned))) + "\n\n";
    }
    case "a": {
      const href = attrOf(node, "href");
      const text = textOf(node).replace(/<[^>]+>/g, "");
      const title = attrOf(node, "title") ?? "";
      const label = collapse(text) || decodeEntities(collapse(title));
      if (!href) return escapeText(label);
      try {
        const resolved = new URL(href, baseUrl).toString();
        links.push(`[${label}]${resolved}`);
        return escapeText(label);
      } catch {
        links.push(`[${label}]${href}`);
        return escapeText(label);
      }
    }
    case "img": {
      const src = attrOf(node, "src");
      const alt = attrOf(node, "alt") ?? "";
      if (!src) return "";
      try {
        const resolved = new URL(src, baseUrl).toString();
        return `![${alt}](${resolved})`;
      } catch {
        return `![${alt}](${src})`;
      }
    }
    case "blockquote": {
      const lines = textOf(node).split("\n").map((l) => l.trim());
      const cleaned = lines
        .map((l) => l.replace(/<[^>]+>/g, ""))
        .map((l) => l.trim())
        .filter(Boolean)
        .join("\n");
      return cleaned ? "> " + collapse(cleaned).replace(/\n/g, "\n> ") + "\n\n" : "";
    }
    case "hr":
      return "\n---\n\n";
    case "pre": {
      const code = textOf(node).replace(/<[^>]+>/g, "");
      return "\n```\n" + code.trimEnd() + "\n```\n\n";
    }
    case "code": {
      const text = escapeText(textOf(node).replace(/<[^>]+>/g, ""));
      return "`" + text.replace(/`/g, "``") + "`";
    }
    case "em":
    case "i":
      return "*" + escapeText(textOf(node).replace(/<[^>]+>/g, "")) + "*";
    case "strong":
    case "b":
      return "**" + escapeText(textOf(node).replace(/<[^>]+>/g, "")) + "**";
    case "u":
      return "<u>" + escapeText(textOf(node).replace(/<[^>]+>/g, "")) + "</u>";
    case "del":
    case "s":
      return "~~" + escapeText(textOf(node).replace(/<[^>]+>/g, "")) + "~~";
    case "li": {
      const text = textOf(node).replace(/<[^>]+>/g, "");
      const cleaned = collapse(decodeEntities(text));
      return "- " + cleaned + "\n";
    }
    case "ul":
    case "ol": {
      const items = node.children
        .map((c) => (c.tag === "li" ? c.text : ""))
        .map((t) => t.replace(/<[^>]+>/g, ""))
        .map((t) => decodeEntities(collapse(t)).trim())
        .filter(Boolean);
      if (items.length === 0) return "";
      const marker = node.tag === "ol" ? (i: number) => `${i + 1}.` : () => "-";
      return items.map((item, i) => `${marker(i)} ${item}
`).join("");
    }
    case "table": {
      const rows = node.children
        .map((r) =>
          r.tag === "tr"
            ? r.children
                .map((c) => {
                  if (c.tag === "th") return escapeText(textOf(c));
                  if (c.tag === "td") return escapeText(textOf(c));
                  return "";
                })
                .join(" | ")
            : ""
        )
        .filter(Boolean);
      if (rows.length < 2) return "";
      const header = rows[0]!.split("|").map((c) => c.trim()).join(" | ");
      const separator = header.split("|").map(() => "---").join(" | ");
      return rows.join("\n") + "\n" + separator + "\n\n";
    }
    case "thead":
    case "tbody":
      return node.children.map((c) => nodeToMarkdown(c, baseUrl, links)).join("");
    case "td":
    case "th": {
      const cell = escapeText(textOf(node).replace(/<[^>]+>/g, ""));
      return " " + cell + " ";
    }
    case "br":
      return "\n";
    case "div":
    case "section":
    case "article":
    case "main":
      return node.children.map((c) => nodeToMarkdown(c, baseUrl, links)).join("");
    default: {
      const inline = node.children
        .map((c) => (c.tag === "text" ? c.text : nodeToMarkdown(c, baseUrl, links)))
        .join("");
      return escapeText(inline);
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Collapse whitespace and drop empty lines the renderer would not like. */
function collapse(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function escapeText(text: string): string {
  return text
    .replace(/\|/g, "\\|")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/(?<!\\)~/g, "\\~")
    .replace(/`/g, "\\`");
}

function trimTrailing(line: string): string {
  return line.replace(/\s+$/, "");
}
