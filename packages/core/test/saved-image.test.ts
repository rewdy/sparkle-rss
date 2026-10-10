import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  fetchSavedImage,
  type ImageRequest,
  isPublicImageAddress,
  MAX_SAVED_IMAGE_BYTES,
  publicImageRequest,
} from "../src/article/fetch-image";
import { articleImages, normalizeImageUrl } from "../src/article/image-source";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
const gif = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);
const webp = Buffer.from(
  "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA",
  "base64",
);
const respond = (bytes = png, type = "image/png") =>
  new Response(bytes, { headers: { "content-type": type } });

const jpeg = readFileSync(
  new URL("./fixtures/saved-images/tiny.jpg", import.meta.url),
);
const avif = readFileSync(
  new URL("./fixtures/saved-images/tiny.avif", import.meta.url),
);

describe("explicit image sources", () => {
  it("extracts linked, relative and protocol-relative images with decoded attributes", () => {
    expect([
      ...articleImages(
        '<a href="x"><img src="../a.png?q=1&amp;x=2" alt="a &amp; b"></a><img src="//cdn.example/b.png"><img src="data:image/png,x">',
        "https://example.com/posts/article",
      ),
    ]).toEqual([
      ["https://example.com/a.png?q=1&x=2", "a & b"],
      ["https://cdn.example/b.png", ""],
    ]);
  });
  it("preserves image selectors and removes fragments", () => {
    expect(normalizeImageUrl("/a.png?size=2#x", "https://example.com")).toBe(
      "https://example.com/a.png?size=2",
    );
    expect(() =>
      normalizeImageUrl(
        "https://user:password@example.com/x",
        "https://example.com",
      ),
    ).toThrow();
  });
});

describe("bounded saved image fetch", () => {
  it.each([
    [png, "image/png", 1],
    [gif, "image/gif", 1],
    [webp, "image/webp", 1],
    [jpeg, "image/jpeg", 64],
    [avif, "image/avif", 64],
  ] as const)(
    "saves an explicitly selected small image ($1)",
    async (bytes, mime, size) => {
      const image = await fetchSavedImage(
        "https://example.com/avatar",
        "profile",
        async () => respond(bytes, mime),
      );
      expect(image).toMatchObject({
        width: size,
        height: size,
        mimeType: mime,
        candidate: { alt: "profile" },
      });
      expect(image.bytes).toEqual(bytes);
    },
  );
  it("rejects MIME mismatch and SVG", async () => {
    await expect(
      fetchSavedImage("https://example.com/x", "", async () =>
        respond(png, "image/jpeg"),
      ),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      fetchSavedImage("https://example.com/x", "", async () =>
        respond(Buffer.from("<svg/>"), "image/svg+xml"),
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
  it("rejects zero-length AVIF properties and truncated containers", async () => {
    for (const corrupt of [
      Buffer.from(avif),
      avif.subarray(0, avif.length - 1),
    ]) {
      if (corrupt.length === avif.length)
        corrupt.writeUInt32BE(0, corrupt.indexOf("ispe") - 4);
      await expect(
        fetchSavedImage("https://example.com/x", "", async () =>
          respond(corrupt, "image/avif"),
        ),
      ).rejects.toMatchObject({ status: 422 });
    }
  });
  it("rejects truncated PNG content", async () => {
    await expect(
      fetchSavedImage("https://example.com/x", "", async () =>
        respond(png.subarray(0, 40)),
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
  it("enforces dimensions", async () => {
    const huge = Buffer.from(png);
    huge.writeUInt32BE(20_000, 16);
    await expect(
      fetchSavedImage("https://example.com/x", "", async () => respond(huge)),
    ).rejects.toMatchObject({ status: 422 });
  });
  it("bounds a streaming response without Content-Length", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_SAVED_IMAGE_BYTES + 1));
      },
      cancel,
    });
    await expect(
      fetchSavedImage(
        "https://example.com/x",
        "",
        async () =>
          new Response(body, { headers: { "content-type": "image/png" } }),
      ),
    ).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalled();
  });
  it("rejects oversize declared length without reading", async () => {
    await expect(
      fetchSavedImage(
        "https://example.com/x",
        "",
        async () =>
          new Response(null, {
            headers: { "content-length": String(MAX_SAVED_IMAGE_BYTES + 1) },
          }),
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
  it("uses a single deadline and resolves relative redirects", async () => {
    const signals: AbortSignal[] = [];
    const urls: string[] = [];
    const request: ImageRequest = async (url, signal) => {
      signals.push(signal);
      urls.push(url.toString());
      return urls.length === 1
        ? new Response(null, { status: 302, headers: { location: "/image" } })
        : respond();
    };
    await fetchSavedImage("https://example.com/start", "", request);
    expect(urls).toEqual([
      "https://example.com/start",
      "https://example.com/image",
    ]);
    expect(signals[0]).toBe(signals[1]);
  });
  it("caps redirects and rejects redirect credentials", async () => {
    await expect(
      fetchSavedImage(
        "https://example.com/x",
        "",
        async () =>
          new Response(null, { status: 302, headers: { location: "/next" } }),
      ),
    ).rejects.toMatchObject({ status: 502 });
    await expect(
      fetchSavedImage(
        "https://example.com/x",
        "",
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://user:pass@example.com/x" },
          }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("checks redirect destination with the public transport", async () => {
    const resolve = vi.fn(async () => ["127.0.0.1"]);
    const transport = publicImageRequest(resolve);
    let first = true;
    await expect(
      fetchSavedImage("https://example.com/x", "", async (url, signal) => {
        if (first) {
          first = false;
          return new Response(null, {
            status: 302,
            headers: { location: "http://private.example/x" },
          });
        }
        return transport(url, signal);
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(resolve).toHaveBeenCalledWith("private.example");
  });
  it("fails closed for mixed public/private DNS results before connecting", async () => {
    await expect(
      publicImageRequest(async () => ["8.8.8.8", "10.1.2.3"])(
        new URL("https://example.com"),
        AbortSignal.timeout(1000),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "192.0.2.1",
    "::1",
    "fc00::1",
    "::ffff:7f00:1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
  ])("blocks nonpublic %s", (address) =>
    expect(isPublicImageAddress(address)).toBe(false),
  );
  it("bounds stalled DNS resolution by the same abort signal", async () => {
    const controller = new AbortController();
    const pending = publicImageRequest(() => new Promise(() => {}))(
      new URL("https://example.com"),
      controller.signal,
    );
    controller.abort(new Error("deadline"));
    await expect(pending).rejects.toThrow("deadline");
  });
  it("accepts global unicast addresses", () => {
    expect(isPublicImageAddress("8.8.8.8")).toBe(true);
    expect(isPublicImageAddress("2606:4700:4700::1111")).toBe(true);
  });
});
