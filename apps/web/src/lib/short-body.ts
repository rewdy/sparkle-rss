/** Keep aligned with core/article/content-policy.ts; parity is covered by tests. */
export const SHORT_BODY_TEXT_LIMIT = 500;

export function isShortBody(html: string): boolean {
  // Detached template parsing does not load resources or execute publisher scripts.
  const template = document.createElement("template");
  template.innerHTML = html;
  const body = template.content;
  for (const node of body.querySelectorAll("script, style, noscript, template"))
    node.remove();
  for (const node of body.querySelectorAll(
    "p, div, br, hr, li, h1, h2, h3, h4, h5, h6, blockquote, section, article, tr, td, th, pre",
  )) {
    node.appendChild(document.createTextNode(" "));
  }
  return (
    Array.from((body.textContent ?? "").replace(/\s+/gu, " ").trim()).length <
    SHORT_BODY_TEXT_LIMIT
  );
}

export function validArticleUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
