import { parseHTML } from "linkedom";

/** Automatically fetch only feed bodies below this readable-text length. */
export const AUTOMATIC_FULL_CONTENT_TEXT_LIMIT = 500;

export function shouldAutomaticallyFetchContent(html: string): boolean {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  for (const node of document.querySelectorAll(
    "script, style, noscript, template",
  )) {
    node.remove();
  }
  // Block boundaries separate words even when the feed omits whitespace.
  for (const node of document.querySelectorAll(
    "p, div, br, hr, li, h1, h2, h3, h4, h5, h6, blockquote, section, article, tr, td, th, pre",
  )) {
    node.appendChild(document.createTextNode(" "));
  }
  const text = (document.body.textContent ?? "").replace(/\s+/gu, " ").trim();
  return Array.from(text).length < AUTOMATIC_FULL_CONTENT_TEXT_LIMIT;
}
