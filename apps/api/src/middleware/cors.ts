import type { MiddlewareHandler } from "hono";
import { env } from "../env";

const allowedOrigins = new Set(env.webOrigins);

/**
 * Single CORS authority for both mounted apps. Allow-listed web origins get an
 * exact-origin echo; everything else (native clients, third-party web readers)
 * gets `*` — safe because we never use cookie credentials.
 */
export function corsMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header("Origin");
    c.header(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, X-Dev-User",
    );
    c.header(
      "Access-Control-Allow-Methods",
      "GET, POST, PATCH, DELETE, OPTIONS",
    );
    c.header("Access-Control-Max-Age", "600");
    if (origin) {
      c.header(
        "Access-Control-Allow-Origin",
        allowedOrigins.has(origin) ? origin : "*",
      );
      c.header("Vary", "Origin");
    }
    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }
    await next();
  };
}
