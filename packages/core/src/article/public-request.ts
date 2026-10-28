import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { AppError } from "../services/errors";
import { isBlockedAddress, type ResolveHost } from "./fetch-article";
export function isPublicImageAddress(address: string): boolean {
  if (!isIP(address) || isBlockedAddress(address)) return false;
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      (a === 192 && b === 0 && c === 2) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  // Permit global unicast only. Canonical URL parsing turns dotted mapped
  // IPv6 into hexadecimal; neither form is allowed through this range check.
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  return (
    /^[23][0-9a-f]{3}:/i.test(canonical) && !canonical.startsWith("2001:db8:")
  );
}

export type ImageRequest = (url: URL, signal: AbortSignal) => Promise<Response>;

export async function beforeDeadline<T>(
  pending: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    pending
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

/** DNS results used here are the results used by the socket, closing the
 * check-then-resolve gap of checking DNS before a separate fetch call. */
export function publicRequest(
  resolve: ResolveHost = async (hostname) =>
    (await lookup(hostname, { all: true })).map((row) => row.address),
  maxBytes = 5 * 1024 * 1024,
  accept = "image/jpeg,image/png,image/webp,image/gif,image/avif",
): ImageRequest {
  return async (url, signal) => {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(host)
      ? [host]
      : await beforeDeadline(resolve(host), signal);
    if (
      !addresses.length ||
      addresses.some((address) => !isPublicImageAddress(address))
    )
      throw new AppError(400, "image address must be public");
    signal.throwIfAborted();
    return new Promise<Response>((resolveResponse, reject) => {
      const request = url.protocol === "https:" ? httpsRequest : httpRequest;
      const req = request(
        url,
        {
          signal,
          agent: false,
          headers: {
            Accept: accept,
            "User-Agent": "sparkle-rss/0.1",
          },
          lookup: (_hostname, options, callback) => {
            const family = options.family;
            const candidates = addresses.filter(
              (address) => !family || isIP(address) === family,
            );
            const address = candidates[0];
            if (!address) {
              callback(new Error("no public address for requested family"), []);
              return;
            }
            if (options.all)
              callback(
                null,
                candidates.map((address) => ({
                  address,
                  family: isIP(address),
                })),
              );
            else callback(null, address, isIP(address));
          },
        },
        (response) => {
          const status = response.statusCode ?? 502;
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (value !== undefined)
              headers.set(name, Array.isArray(value) ? value.join(",") : value);
          }
          if (status >= 300 && status < 400) {
            response.destroy();
            resolveResponse(new Response(null, { status, headers }));
            return;
          }
          if (Number(headers.get("content-length")) > maxBytes) {
            response.destroy();
            reject(new AppError(413, "response exceeds byte limit"));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
              response.destroy();
              reject(new AppError(413, "response exceeds byte limit"));
            } else chunks.push(chunk);
          });
          response.on("error", reject);
          response.on("end", () =>
            resolveResponse(
              new Response(Buffer.concat(chunks), { status, headers }),
            ),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
  };
}
