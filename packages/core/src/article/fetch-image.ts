import { imageSize } from "image-size";
import type { SelectedArticleImage } from "../feed/article-image";
import { AppError } from "../services/errors";
import {
  beforeDeadline,
  type ImageRequest,
  publicRequest as publicImageRequest,
} from "./public-request";

export {
  type ImageRequest,
  isPublicImageAddress,
  publicRequest as publicImageRequest,
} from "./public-request";

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
