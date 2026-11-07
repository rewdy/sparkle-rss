import { AppError } from "../services/errors";
import { discoverFeed, type FetchLike, USER_AGENT } from "./discover";

const DISCOVERY_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 10_000;

function httpUrl(value: string): URL {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return url;
  } catch {
    // Report the same validation error for malformed and unsupported URLs.
  }
  throw new AppError(400, "only valid http(s) URLs are supported");
}

function requestKey(value: string): string {
  const url = httpUrl(value);
  url.hash = "";
  return url.href;
}

/** Web-only discovery. No persistence, and no change to native-client discovery. */
export async function discoverWebFeed(
  inputUrl: string,
  fetchImpl: FetchLike = fetch,
) {
  const input = httpUrl(inputUrl);
  const root = `${input.origin}/`;
  const visited = new Set<string>();
  const deadline = Date.now() + DISCOVERY_TIMEOUT_MS;
  let inspectedPage = false;
  let rejectedUrl: AppError | undefined;

  // Buffer inside the request deadline: response headers alone are not completion.
  const boundedFetch: FetchLike = async (url, init) => {
    let key: string;
    try {
      key = requestKey(url);
    } catch (error) {
      rejectedUrl = error as AppError;
      throw error;
    }
    if (visited.has(key)) return new Response(null, { status: 404 });
    visited.add(key);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new AppError(502, "feed discovery timed out");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetchImpl(url, {
            ...init,
            redirect: "follow",
            headers: { "User-Agent": USER_AGENT, ...init?.headers },
            signal: controller.signal,
          });
          if (response.url) {
            try {
              visited.add(requestKey(response.url));
            } catch (error) {
              rejectedUrl = error as AppError;
              throw error;
            }
          }
          const body = await response.text();
          const buffered = new Response(body, {
            status: response.status,
            headers: response.headers,
          });
          Object.defineProperty(buffered, "url", { value: response.url });
          return buffered;
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => {
              controller.abort();
              reject(new AppError(502, "feed discovery timed out"));
            },
            Math.min(REQUEST_TIMEOUT_MS, remaining),
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };

  for (const page of [input.href, root]) {
    if (visited.has(requestKey(page))) continue;
    try {
      const feed = await discoverFeed(page, boundedFetch);
      if (rejectedUrl) throw rejectedUrl;
      httpUrl(feed.feedUrl);
      return {
        feedUrl: feed.feedUrl,
        siteUrl: feed.siteUrl,
        title: feed.title,
      };
    } catch (error) {
      if (rejectedUrl) throw rejectedUrl;
      if (!(error instanceof AppError) || ![422, 502].includes(error.status))
        throw error;
      if (error.status === 422) inspectedPage = true;
      if (Date.now() >= deadline)
        throw new AppError(502, "feed discovery timed out");
    }
  }
  throw new AppError(
    inspectedPage ? 422 : 502,
    inspectedPage
      ? "no feed found at this page or site"
      : "could not reach this page or site",
  );
}
