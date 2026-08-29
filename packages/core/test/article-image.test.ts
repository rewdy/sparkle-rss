import { describe, expect, it } from "vitest";
import { findArticleImage, imageCandidates } from "../src/feed/article-image";

function response(bytes: Uint8Array, type = "image/png"): Response {
  return new Response(bytes, {
    status: 200,
    headers: { "content-type": type },
  });
}

// Minimal PNG header with a 512x300 IHDR; enough for image-size to inspect.
const png512x300 = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 2, 0, 0,
  0, 1, 44, 8, 2, 0, 0, 0, 0,
]);

describe("article image selection", () => {
  it("keeps source order and resolves relative URLs", () => {
    expect(
      imageCandidates(
        '<img src="avatar.png" alt="avatar"><img src="/hero.png" alt="hero">',
        "https://example.com/posts/1",
      ).map((c) => c.url),
    ).toEqual([
      "https://example.com/posts/avatar.png",
      "https://example.com/hero.png",
    ]);
  });

  it("skips avatars and selects the first qualifying image", async () => {
    const fetcher = async (url: string) =>
      response(url.endsWith("hero.png") ? png512x300 : new Uint8Array([1]));
    const selected = await findArticleImage(
      '<img src="avatar.png" alt="profile avatar"><img src="hero.png" alt="hero">',
      "https://example.com/",
      fetcher as typeof fetch,
    );
    expect(selected?.candidate.url).toBe("https://example.com/hero.png");
    expect(selected).toMatchObject({ width: 512, height: 300 });
  });
});
