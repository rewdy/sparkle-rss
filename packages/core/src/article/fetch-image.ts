import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { imageSize } from "image-size";
import type { SelectedArticleImage } from "../feed/article-image";
import { AppError } from "../services/errors";
import { isBlockedAddress, type ResolveHost } from "./fetch-article";
import { normalizeImageUrl } from "./image-source";

export const MAX_SAVED_IMAGE_BYTES = 5 * 1024 * 1024;
const formats: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

/** Validate every box boundary before handing AVIF to the header parser.
 * In particular, zero-length property boxes must never stall its scan. */
function validateAvifBoxes(
  bytes: Buffer,
  start = 0,
  end = bytes.length,
  depth = 0,
): void {
  if (depth > 4) throw new AppError(422, "invalid AVIF container");
  for (let offset = start; offset < end; ) {
    if (end - offset < 8) throw new AppError(422, "truncated AVIF container");
    const size = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const header = size === 1 ? 16 : 8;
    if (end - offset < header)
      throw new AppError(422, "truncated AVIF container");
    const length =
      size === 1 ? Number(bytes.readBigUInt64BE(offset + 8)) : size;
    if (
      !Number.isSafeInteger(length) ||
      length < header ||
      length > end - offset
    )
      throw new AppError(422, "invalid AVIF box size");
    if (type === "ispe" && length < header + 12)
      throw new AppError(422, "truncated AVIF dimensions");
    if (["meta", "iprp", "ipco"].includes(type)) {
      const childStart = offset + header + (type === "meta" ? 4 : 0);
      if (childStart > offset + length)
        throw new AppError(422, "truncated AVIF container");
      validateAvifBoxes(bytes, childStart, offset + length, depth + 1);
    }
    offset += length;
  }
}

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

async function beforeDeadline<T>(
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
export function publicImageRequest(
  resolve: ResolveHost = async (hostname) =>
    (await lookup(hostname, { all: true })).map((row) => row.address),
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
            Accept: Object.values(formats).join(","),
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
          if (Number(headers.get("content-length")) > MAX_SAVED_IMAGE_BYTES) {
            response.destroy();
            reject(new AppError(413, "image exceeds 5 MiB"));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_SAVED_IMAGE_BYTES) {
              response.destroy();
              reject(new AppError(413, "image exceeds 5 MiB"));
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

export async function fetchSavedImage(
  rawUrl: string,
  alt = "",
  request: ImageRequest = publicImageRequest(),
): Promise<SelectedArticleImage> {
  const signal = AbortSignal.timeout(10_000);
  let url = new URL(normalizeImageUrl(rawUrl, rawUrl));
  try {
    for (let hop = 0; hop <= 5; hop++) {
      const response = await beforeDeadline(request(url, signal), signal);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || hop === 5)
          throw new AppError(502, "too many or invalid image redirects");
        url = new URL(normalizeImageUrl(location, url.toString()));
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new AppError(502, "image could not be downloaded");
      }
      if (
        Number(response.headers.get("content-length")) > MAX_SAVED_IMAGE_BYTES
      ) {
        await response.body?.cancel();
        throw new AppError(413, "image exceeds 5 MiB");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new AppError(422, "empty image");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          signal.throwIfAborted();
          const { value, done } = await beforeDeadline(reader.read(), signal);
          if (done) break;
          size += value.byteLength;
          if (size > MAX_SAVED_IMAGE_BYTES)
            throw new AppError(413, "image exceeds 5 MiB");
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      const bytes = Buffer.concat(chunks);
      const declaredType = response.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase();
      if (!declaredType || !Object.values(formats).includes(declaredType))
        throw new AppError(422, "unsupported image format");
      if (bytes.toString("ascii", 4, 8) === "ftyp") {
        if (
          declaredType !== "image/avif" ||
          bytes.toString("ascii", 8, 12) !== "avif"
        )
          throw new AppError(422, "unsupported image format");
        validateAvifBoxes(bytes);
      }
      const recognized =
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ||
        ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6)) ||
        (bytes.toString("ascii", 0, 4) === "RIFF" &&
          bytes.toString("ascii", 8, 12) === "WEBP") ||
        bytes.toString("ascii", 4, 8) === "ftyp";
      if (!recognized) throw new AppError(422, "unsupported image format");
      const dimensions = imageSize(bytes);
      const mimeType = formats[dimensions.type ?? ""];
      const declared = response.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase();
      const { width, height } = dimensions;
      if (
        !mimeType ||
        declared !== mimeType ||
        !width ||
        !height ||
        width > 16_384 ||
        height > 16_384 ||
        width * height > 40_000_000
      )
        throw new AppError(422, "unsupported or invalid image");
      // Reject clearly truncated containers as well as invalid headers.
      if (
        (dimensions.type === "png" &&
          bytes.subarray(-8, -4).toString() !== "IEND") ||
        (dimensions.type === "jpg" &&
          bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) ||
        (dimensions.type === "gif" && bytes.at(-1) !== 0x3b) ||
        (dimensions.type === "webp" &&
          bytes.readUInt32LE(4) + 8 !== bytes.length)
      )
        throw new AppError(422, "truncated image");
      return {
        bytes,
        width,
        height,
        mimeType,
        candidate: { url: rawUrl, alt, order: 0, source: "content" },
      };
    }
    throw new AppError(502, "too many image redirects");
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(502, "image could not be saved; please retry");
  }
}
