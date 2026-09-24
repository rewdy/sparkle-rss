/**
 * Builds the "save to read later" bookmarklet for the current deployment.
 *
 * The bookmarklet runs in the article's own origin, where it cannot read the
 * app's session, so it only gathers the URL, title, and selected text, then
 * opens the app's save form in a small window and lets the app do the work.
 */
export function buildBookmarklet(origin: string): string {
  const target = `${origin}/read-later/new`;
  return [
    "javascript:(function(){",
    "var q=new URLSearchParams({",
    "url:location.href,",
    "title:document.title,",
    "excerpt:(window.getSelection()?String(window.getSelection()):'').slice(0,500),",
    "auto:'1'",
    `});window.open('${target}?'+q,'sparkle-read-later','width=460,height=560');`,
    "})()",
  ].join("");
}
