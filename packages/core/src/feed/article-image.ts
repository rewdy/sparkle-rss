import { imageSize } from "image-size";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_CANDIDATES = 5;
const MIN_DIMENSION = 256;
const BAD_TOKENS =
  /(?:avatar|profile|userpic|gravatar|favicon|icon|logo|emoji)/i;

export interface ImageCandidate {
  url: string;
  alt: string;
  order: number;
  source: "media" | "content";
}

export interface SelectedArticleImage {
  candidate: ImageCandidate;
  bytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
}

function attrs(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of raw.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)) {
    const key = match[1];
    const value = match[3];
    if (key && value !== undefined) result[key.toLowerCase()] = value;
  }
  return result;
}

function absoluteUrl(raw: string, baseUrl: string): string | null {
  try {
    const url = new URL(raw, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function imageCandidates(
  html: string,
  baseUrl: string,
  mediaUrls: string[] = [],
): ImageCandidate[] {
  const result: ImageCandidate[] = [];
  for (const rawUrl of mediaUrls) {
    const url = absoluteUrl(rawUrl, baseUrl);
    if (url)
      result.push({ url, alt: "", order: result.length, source: "media" });
  }
  for (const match of html.matchAll(/<img\b([^>]*)>/gis)) {
    const a = attrs(match[1] ?? "");
    const rawUrl = a.src ?? a["data-src"];
    const url = rawUrl ? absoluteUrl(rawUrl, baseUrl) : null;
    if (url)
      result.push({
        url,
        alt: a.alt ?? "",
        order: result.length,
        source: "content",
      });
  }
  return result;
}

function obviousNonArticleImage(candidate: ImageCandidate): boolean {
  return BAD_TOKENS.test(`${candidate.url} ${candidate.alt}`);
}

export async function findArticleImage(
  html: string,
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  mediaUrls: string[] = [],
): Promise<SelectedArticleImage | null> {
  let inspected = 0;
  for (const candidate of imageCandidates(html, baseUrl, mediaUrls)) {
    if (inspected++ >= MAX_CANDIDATES || obviousNonArticleImage(candidate))
      continue;
    try {
      const response = await fetchImpl(candidate.url, {
        signal: AbortSignal.timeout(10_000),
        redirect: "manual",
        headers: {
          Accept: "image/avif,image/webp,image/jpeg,image/png,image/gif",
        },
      });
      if (!response.ok) continue;
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (contentLength > MAX_IMAGE_BYTES) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_IMAGE_BYTES) continue;
      const mimeType = (
        (response.headers.get("content-type") ?? "").split(";")[0] ?? ""
      ).toLowerCase();
      if (
        !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(
          mimeType,
        )
      )
        continue;
      const dimensions = imageSize(Buffer.from(bytes));
      const { width, height } = dimensions;
      if (
        !width ||
        !height ||
        width <= MIN_DIMENSION ||
        height <= MIN_DIMENSION
      )
        continue;
      return {
        candidate,
        bytes,
        mimeType,
        width,
        height,
      };
    } catch {
      // Image failure is deliberately best effort and must not fail feed ingestion.
    }
  }
  return null;
}
