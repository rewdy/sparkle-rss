import { parseHTML } from "linkedom";
import { AppError } from "../services/errors";

export function normalizeImageUrl(raw: string, base: string): string {
  try {
    const url = new URL(raw, base || undefined);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("unsupported image address");
    url.hash = "";
    return url.toString();
  } catch {
    throw new AppError(400, "unsupported image address");
  }
}

export function articleImages(html: string, base: string) {
  const { document } = parseHTML(html);
  const images = new Map<string, string>();
  for (const img of document.querySelectorAll("img[src]")) {
    try {
      const url = normalizeImageUrl(img.getAttribute("src") ?? "", base);
      images.set(url, img.getAttribute("alt") ?? "");
    } catch {
      // Unsupported source URLs do not become save candidates.
    }
  }
  return images;
}
