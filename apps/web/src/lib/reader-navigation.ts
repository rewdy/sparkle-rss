import { legacyStoryStream, parseRoute, streamPath } from "./keys";

type Navigate = (
  to: string,
  options?: { replace?: boolean; state?: unknown },
) => void;
const KEY = "sparkle.readerNavigation";
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function currentUrl(): string {
  return window.location.pathname + window.location.search;
}
function surface(url: string, allowLegacy = false): string | null {
  if (!url.startsWith("/") || url.startsWith("//")) return null;
  let parsed: URL;
  try {
    parsed = new URL(url, window.location.origin);
  } catch {
    return null;
  }
  if (parsed.origin !== window.location.origin || parsed.hash) return null;
  const route = parseRoute(parsed.pathname);
  if (route && route.entryId === null && !route.imageId && !route.endAfterId) {
    return streamPath(route.stream);
  }
  const legacy = allowLegacy ? legacyStoryStream(parsed.pathname) : null;
  return legacy ? streamPath(legacy) : null;
}
function origin(state: unknown, url: string): string | null {
  const data = record(record(state)[KEY]);
  const route = parseRoute(url.split("?")[0] ?? "");
  return data.version === 1 &&
    data.kind === "reader" &&
    typeof data.surfaceId === "string" &&
    data.surfaceId.length > 0 &&
    typeof data.origin === "string" &&
    route &&
    (route.entryId !== null || route.imageId || route.endAfterId) &&
    surface(data.origin, true) === streamPath(route.stream)
    ? data.origin
    : null;
}

/** History entry metadata survives reload; URL remains the selection authority. */
export function readerNavigation(navigate: Navigate) {
  return {
    open(to: string): void {
      const from = currentUrl();
      const state = record(window.history.state);
      if (surface(from) !== null) {
        // This is a history correlation ID, not a credential. getRandomValues
        // remains available on HTTP LAN dev origins where randomUUID is absent.
        const surfaceId = Array.from(
          crypto.getRandomValues(new Uint32Array(4)),
          (part) => part.toString(16).padStart(8, "0"),
        ).join("-");
        navigate(from, {
          replace: true,
          state: {
            ...state,
            [KEY]: { version: 1, kind: "surface", surfaceId },
          },
        });
        navigate(to, {
          state: {
            ...state,
            [KEY]: { version: 1, kind: "reader", surfaceId, origin: from },
          },
        });
      } else {
        // Stepping within a reader keeps its original surface.
        navigate(to, { replace: true, state });
      }
    },
    close(fallback: string): void {
      if (origin(window.history.state, currentUrl())) window.history.back();
      else {
        const state = { ...record(window.history.state) };
        delete state[KEY];
        navigate(fallback, { replace: true, state });
      }
    },
  };
}
