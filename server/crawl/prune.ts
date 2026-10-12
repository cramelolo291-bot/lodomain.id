// Boilerplate pruning for crawled pages.
//
// Crawl4AI's `fit_markdown` is the difference between "the article" and "the
// web page": it strips menus, footers and advertisement chrome so the model
// only sees content. This module re-implements the two cheap stages with no
// DOM dependency, by removing whole elements by tag and by class/id name, then
// dropping blocks whose link density is absurdly high.
//
// This is deliberately aggressive: a newsletter sign-up buried inside a
// `<div class="widget">` is removed, not hidden. The alternative (keeping the
// UI chrome) fills context windows with repetition, and for a multi-user
// server the cost is paid by every account, not just the crawler's user.

import { isHeadTag, textOf, type Node } from "./dom";

// Elements that exist to structure a page, not to say something. Removed
// wholesale — a page without a footer is a page that lost its soul, and that
// is fine for an LLM.
const LAYOUT_TAGS = new Set([
  "nav",
  "footer",
  "aside",
  "header",
  "form",
  "figure",
  "dialog",
  "audio",
  "video",
  "canvas",
  "details",
  "svg",
  "math",
  "noscript",
  "template",
]);

// Class and id tokens that almost never carry article content. The list is
// deliberately long: a site that puts `newsletter` on a div is telling us the
// div is not the article, and a site that puts `footer` on a span is teasing
// us with a broken tag.
const BOILERPLATE_MARKERS = new Set([
  "ad",
  "advert",
  "advertiser",
  "analytics",
  "banner",
  "cookie",
  "comment",
  "container",
  "credits",
  "cookie",
  "social",
  "share",
  "related",
  "menu",
  "pagination",
  "poll",
  "popup",
  "promo",
  "recommendation",
  "reply",
  "sidebar",
  "subscribe",
  "table-of-contents",
  "widget",
]);

// Only the top-level children of the document are pruned: we do not recurse
// into `body` (which is the consumer's own section) further than one level.
export function prune(node: Node): void {
  if (node.tag === "text") return;

  if (LAYOUT_TAGS.has(node.tag) || isHeadTag(node.tag)) {
    node.children = [];
    return;
  }

  // Elements that carry no content of their own (and no child content worth
  // keeping either) are emptied out instead of recursed into.
  if (BOILERPLATE_MARKERS.has(node.tag)) {
    node.children = [];
    return;
  }

  const classTokens = (node.attrs.get("class") ?? "").split(/\s+/).filter(Boolean);
  const idTokens = (node.attrs.get("id") ?? "").split(/[_-]/).filter(Boolean);
  if (
    classTokens.some((t) => BOILERPLATE_MARKERS.has(t)) ||
    idTokens.some((t) => BOILERPLATE_MARKERS.has(t))
  ) {
    node.children = [];
    return;
  }

  const children = node.children;
  node.children = [];
  for (const child of children) {
    prune(child);
    if (child.children.length > 0 || child.tag === "text" && child.text.trim().length > 0) {
      node.children.push(child);
    }
  }
}

/** Drop any block whose ratio of link text to total text is above the cap. */
export function pruneByLinkDensity(node: Node, cap = 0.55, minLength = 40): void {
  if (node.tag === "text") return;

  const children = node.children;
  node.children = [];

  for (const child of children) {
    pruneByLinkDensity(child, cap, minLength);
    if (child.children.length === 0 && child.tag !== "text") continue;
    if (child.tag === "text" && child.text.trim().length === 0) continue;

    if (child.tag === "p" || child.tag === "div" || child.tag === "li" || child.tag === "td" || child.tag === "th") {
      const visibleLength = textOf(child).trim().length;
      const linkLength = linkTextLength(child);
      if (linkLength / Math.max(1, visibleLength) > cap && visibleLength >= minLength) {
        // The parent is rebuilding its children array, so skipping this child
        // removes it without a second tree traversal.
        continue;
      }
    }

    if (child.children.length > 0 || child.tag === "text" && child.text.trim().length > 0) {
      node.children.push(child);
    }
  }
}

/** Count visible characters that belong to links, including nested elements. */
function linkTextLength(node: Node, insideLink = false): number {
  if (node.tag === "text") return insideLink ? node.text.length : 0;
  const inLink = insideLink || node.tag === "a";
  return node.children.reduce((sum, child) => sum + linkTextLength(child, inLink), 0);
}
