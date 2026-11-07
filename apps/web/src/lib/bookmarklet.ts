/**
 * Builds the "save to read later" bookmarklet for the current deployment.
 *
 * The bookmarklet runs in the article's own origin, where it cannot read the
 * app's session, so it only gathers the URL, title, and selected text, then
 * opens the app's save form in a small window and lets the app do the work.
 * `popup=1` tells the form to confirm in place instead of navigating away.
 */
export function buildBookmarklet(origin: string): string {
  const target = `${origin}/read-later/new`;
  return [
    "javascript:(function(){",
    "var q=new URLSearchParams({",
    "url:location.href,",
    "title:document.title,",
    "excerpt:(window.getSelection()?String(window.getSelection()):'').slice(0,500),",
    "popup:'1'",
    `});window.open('${target}?'+q,'sparkle-read-later','width=530,height=460');`,
    "})()",
  ].join("");
}

/** Captures only the page address/title; discovery and writes run in Sparkle. */
export function buildSubscribeBookmarklet(origin: string): string {
  const target = JSON.stringify(`${new URL(origin).origin}/subscribe?`);
  return (
    "javascript:(function(){if(!/^https?:$/.test(location.protocol))return;" +
    "var q=new URLSearchParams({url:location.href,title:document.title,popup:'1'});" +
    `window.open(${target}+q,'sparkle-subscribe','width=530,height=560');})()`
  );
}
