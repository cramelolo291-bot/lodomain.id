// Turning stored text into a real PDF.
//
// The database holds `project_files.content` as text — a PDF is bytes, so it
// cannot live there. It is rendered on demand, at download time, from whatever
// text the agent wrote. That also means the PDF is never stale: edit the
// markdown, the PDF says something new.
//
// No dependency. A PDF is a small, well-specified text format: an object table,
// a cross-reference table, and a content stream. Everything below is written
// by hand because pulling in a PDF library to typeset a heading and a
// paragraph is a lot of supply chain for very little result. What this cannot
// do is embed images or use a real font — it lays out Helvetica, which every
// reader has, and that is the whole trick.
//
// What it does handle is the thing the agent actually produces: headings,
// paragraphs, bullet lists, and `code` blocks, all of which come out of a
// model reply as plain text.

/** Escapes a string for a PDF literal, including the non-ASCII forms. */
function pdfString(s: string): string {
  // PDFDocEncoding covers Latin-1. Anything above it is not representable in
  // a base-14 font, so it becomes a question mark rather than a broken file.
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === "(" || ch === ")" || ch === "\\") out += `\\${ch}`;
    else if (code < 32) out += " ";
    else if (code < 256) out += ch;
    else out += "?";
  }
  return out;
}

/** One laid-out line, already measured. */
type Line = { text: string; size: number; font: Font; indent: number; gapAfter: number };

type Font = "F1" | "F2" | "F3";

/**
 * Helvetica widths for the printable ASCII range, in 1/1000 em. Needed to
 * wrap and to right-align page numbers — a PDF viewer will not tell us where
 * the text ends.
 */
const WIDTHS =
  "278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584";

const FONT_KEYS = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";

const widthCache = new Map<string, number>();
function charWidth(ch: string): number {
  const cached = widthCache.get(ch);
  if (cached !== undefined) return cached;
  const i = FONT_KEYS.indexOf(ch);
  const w = i >= 0 ? Number(WIDTHS.split(" ")[i]) || 556 : 556;
  widthCache.set(ch, w);
  return w;
}

/** Text width in points at a given size. */
function textWidth(text: string, size: number): number {
  let total = 0;
  for (const ch of text) total += charWidth(ch);
  return (total * size) / 1000;
}

/** Wraps to a width, breaking on spaces and never mid-word. */
function wrap(text: string, size: number, maxWidth: number): string[] {
  if (!text) return [""];
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate, size) <= maxWidth || !current) {
      // A single word wider than the line has to be cut, or it runs off the
      // page and the file looks broken.
      if (!current && textWidth(word, size) > maxWidth) {
        let chunk = "";
        for (const ch of word) {
          if (textWidth(chunk + ch, size) > maxWidth && chunk) {
            lines.push(chunk);
            chunk = ch;
          } else chunk += ch;
        }
        current = chunk;
        continue;
      }
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

type Block =
  | { kind: "title"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "sub"; text: string }
  | { kind: "para"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "code"; text: string }
  | { kind: "rule" };

/**
 * Reads the small subset of markdown a model actually emits. Anything it does
 * not recognise becomes a paragraph, which is the right default: a stray `##`
 * must not swallow the sentence after it.
 */
function parseBlocks(md: string): Block[] {
  const out: Block[] = [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let inCode = false;
  let code: string[] = [];

  const flushCode = () => {
    if (code.length) out.push({ kind: "code", text: code.join("\n") });
    code = [];
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");

    if (/^```/.test(line.trim())) {
      if (inCode) flushCode();
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      code.push(raw);
      continue;
    }

    if (!line.trim()) continue;

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      out.push({ kind: "rule" });
      continue;
    }
    // Fenced blockquote, or a line starting with `>`.
    if (/^>\s?/.test(line)) {
      out.push({ kind: "para", text: line.replace(/^>\s?/, "") });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1]!.length;
      const text = h[2]!.replace(/[*_`]/g, "").trim();
      if (level <= 1) out.push({ kind: "title", text });
      else if (level === 2) out.push({ kind: "heading", text });
      else out.push({ kind: "sub", text });
      continue;
    }
    // Bullet: -, *, +, or an ordered marker.
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      out.push({ kind: "bullet", text: li[3]!.replace(/[*_`]/g, "").trim() });
      continue;
    }

    out.push({ kind: "para", text: line });
  }
  flushCode();
  return out;
}

// Page geometry, in points. US Letter.
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 64;
const MARGIN_TOP = 68;
const MARGIN_BOTTOM = 64;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

const SIZE = { title: 22, heading: 15, sub: 12.5, para: 10.5, code: 9.5 };

/** Lays a block out into positioned lines. */
function layout(blocks: Block[]): Line[] {
  const lines: Line[] = [];

  for (const b of blocks) {
    switch (b.kind) {
      case "title": {
        const wrapped = wrap(b.text, SIZE.title, CONTENT_W);
        wrapped.forEach((t, i) => {
          lines.push({
            text: t,
            size: SIZE.title,
            font: "F2",
            indent: 0,
            gapAfter: i === wrapped.length - 1 ? 10 : 2,
          });
        });
        lines.push({ text: "", size: 4, font: "F1", indent: 0, gapAfter: 6 });
        break;
      }
      case "heading": {
        lines.push({ text: "", size: 6, font: "F1", indent: 0, gapAfter: 2 });
        const wrapped = wrap(b.text, SIZE.heading, CONTENT_W);
        wrapped.forEach((t, i) => {
          lines.push({
            text: t,
            size: SIZE.heading,
            font: "F2",
            indent: 0,
            gapAfter: i === wrapped.length - 1 ? 7 : 2,
          });
        });
        break;
      }
      case "sub": {
        const wrapped = wrap(b.text, SIZE.sub, CONTENT_W);
        wrapped.forEach((t, i) => {
          lines.push({
            text: t,
            size: SIZE.sub,
            font: "F2",
            indent: 0,
            gapAfter: i === wrapped.length - 1 ? 6 : 2,
          });
        });
        break;
      }
      case "para": {
        const wrapped = wrap(b.text, SIZE.para, CONTENT_W);
        wrapped.forEach((t, i) => {
          lines.push({
            text: t,
            size: SIZE.para,
            font: "F1",
            indent: 0,
            gapAfter: i === wrapped.length - 1 ? 7 : 0,
          });
        });
        break;
      }
      case "bullet": {
        const wrapped = wrap(b.text, SIZE.para, CONTENT_W - 14);
        wrapped.forEach((t, i) => {
          lines.push({
            text: i === 0 ? `•  ${t}` : `   ${t}`,
            size: SIZE.para,
            font: "F1",
            indent: 0,
            gapAfter: i === wrapped.length - 1 ? 3 : 0,
          });
        });
        break;
      }
      case "code": {
        const raw = b.text.split("\n");
        // A long pasted stack trace would otherwise run for pages.
        const trimmed = raw.length > 40 ? [...raw.slice(0, 40), "… truncated"] : raw;
        trimmed.forEach((t) => {
          const oneLine = t.replace(/\t/g, "    ").slice(0, 200);
          lines.push({
            text: oneLine,
            size: SIZE.code,
            font: "F3",
            indent: 0,
            gapAfter: 0,
          });
        });
        lines.push({ text: "", size: 6, font: "F1", indent: 0, gapAfter: 4 });
        break;
      }
      case "rule": {
        lines.push({ text: "", size: 5, font: "F1", indent: 0, gapAfter: 4 });
        lines.push({ text: "─".repeat(48), size: 7, font: "F1", indent: 0, gapAfter: 4 });
        lines.push({ text: "", size: 5, font: "F1", indent: 0, gapAfter: 4 });
        break;
      }
    }
  }
  return lines;
}

/** Greedy page fill. Returns pages of lines, each already fitting its page. */
function paginate(lines: Line[]): Line[][] {
  const usable = PAGE_H - MARGIN_TOP - MARGIN_BOTTOM;
  const pages: Line[][] = [];
  let current: Line[] = [];
  let used = 0;

  for (const line of lines) {
    const step = line.size * 1.42 + line.gapAfter;
    if (used + step > usable && current.length) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(line);
    used += step;
  }
  if (current.length) pages.push(current);
  // An empty document still has to produce one valid page.
  return pages.length ? pages : [[]];
}

/**
 * Renders markdown to a PDF.
 *
 * Returns a Buffer starting with `%PDF-`, which is the only thing a reader
 * checks before deciding whether to open the file.
 */
export function markdownToPdf(markdown: string, opts: { title?: string } = {}): Buffer {
  const blocks = parseBlocks(markdown);
  const pages = paginate(layout(blocks));

  // Every object in the file, in the order they will be numbered.
  const objects: string[] = [];
  const add = (body: string): number => {
    objects.push(body);
    return objects.length; // 1-based object number
  };

  // Reserve 1 = Catalog, 2 = Pages. Filled in once the tree is known.
  objects.push("", "");
  const fontRegular = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const fontBold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const fontMono = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");

  const fontRes = add(
    `<< /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R /F3 ${fontMono} 0 R >> >>`,
  );
  const pagesObj = objects.length + 1; // filled next
  add(""); // placeholder for /Pages

  const pageIds: number[] = [];
  const footers = opts.title?.trim() || "";

  for (const lines of pages) {
    let content = "BT\n";
    let y = PAGE_H - MARGIN_TOP;

    for (const line of lines) {
      y -= line.size * 1.42;
      if (!line.text.trim()) {
        y -= line.gapAfter;
        continue;
      }
      const x = MARGIN_X + line.indent;
      content += `/F${line.font.slice(1)} ${line.size} Tf\n`;
      content += `1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm\n`;
      content += `(${pdfString(line.text)}) Tj\n`;
      y -= line.gapAfter;
    }

    // Footer: title on the left, page number on the right.
    const pageNo = pageIds.length + 1;
    const pageTotal = pages.length;
    if (footers || pageTotal > 1) {
      content += "/F1 8.5 Tf\n";
      if (footers) {
        content += `1 0 0 1 ${MARGIN_X} ${MARGIN_BOTTOM - 18} Tm\n`;
        content += `(${pdfString(footers.slice(0, 90))}) Tj\n`;
      }
      if (pageTotal > 1) {
        const label = `${pageNo} / ${pageTotal}`;
        const w = textWidth(label, 8.5);
        content += `1 0 0 1 ${(PAGE_W - MARGIN_X - w).toFixed(2)} ${MARGIN_BOTTOM - 18} Tm\n`;
        content += `(${pdfString(label)}) Tj\n`;
      }
    }
    content += "ET\n";

    const streamId = add(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}endstream`);
    const pageId = add(
      `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /Font ${fontRes} 0 R >> /Contents ${streamId} 0 R >>`,
    );
    pageIds.push(pageId);
  }

  objects[pagesObj - 1] =
    `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  // Object 1 is the catalog, reserved at the top and filled in now that the
  // page tree has a number.
  objects[0] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;

  // Serialise: header, objects, xref, trailer.
  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefStart = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n`;
  out += "0000000000 65535 f \n";
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(out, "latin1");
}

/**
 * Filename a download should use. A title with a slash in it would either
 * break the header or let a caller pick the name, so it is reduced to
 * something inert.
 */
export function pdfFilename(title: string): string {
  const base = title
    .replace(/[^\p{L}\p{N}\s._-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    // Dots are allowed inside a name but not as a run at the front: a
    // filename of `...` or `..` in a Content-Disposition is a path, not a
    // name, and some clients will act on it.
    .replace(/^[.\s]+/, "")
    .replace(/\.{2,}/g, ".")
    .slice(0, 60)
    .replace(/[.\s]+$/, "");
  return `${base || "dokumen"}.pdf`;
}
