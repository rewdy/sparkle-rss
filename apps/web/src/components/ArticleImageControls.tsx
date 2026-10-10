import { ActionIcon, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { type RefObject, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LuBookmark, LuCheck, LuRotateCw } from "react-icons/lu";
import { api } from "../lib/api";
import { qk } from "../lib/keys";
import { useSaveImage } from "../lib/mutations";
import type { ImageSource } from "../lib/types";

function imageUrl(raw: string, base: string): string | null {
  try {
    const url = new URL(raw, base || undefined);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function ImageSaveButton({
  source,
  url,
  alt,
  saved,
}: {
  source: ImageSource;
  url: string;
  alt: string;
  saved: boolean;
}) {
  const mutation = useSaveImage();
  const done = saved || mutation.isSuccess;
  const label = done
    ? "image saved"
    : mutation.isError
      ? "retry saving image"
      : "save image";
  return (
    <span className="image-save-controls">
      <ActionIcon
        variant="filled"
        color="accent"
        size="lg"
        aria-label={`${label}${alt ? `: ${alt}` : ""}`}
        title={label}
        loading={mutation.isPending}
        disabled={done || mutation.isPending}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!done && !mutation.isPending)
            mutation.mutate({ source, imageUrl: url });
        }}
      >
        {done ? (
          <LuCheck />
        ) : mutation.isError ? (
          <LuRotateCw />
        ) : (
          <LuBookmark />
        )}
      </ActionIcon>
      {mutation.isError && (
        <Text
          component="span"
          role="alert"
          size="xs"
          className="image-save-error"
        >
          {mutation.error instanceof Error
            ? mutation.error.message
            : "Could not save image. Try again."}
        </Text>
      )}
      {done && (
        <span className="sr-only" role="status">
          Image saved
        </span>
      )}
    </span>
  );
}

export function ArticleImageControls({
  contentRef,
  html,
  articleUrl,
  source,
}: {
  contentRef: RefObject<HTMLDivElement | null>;
  html: string;
  articleUrl: string;
  source: ImageSource;
}) {
  const [targets, setTargets] = useState<
    Array<{ host: HTMLElement; url: string; alt: string }>
  >([]);
  const query = useQuery({
    queryKey: qk.sourceImages(source),
    queryFn: () => api.savedImages.listForSource(source),
    retry: false,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: DOM enhancement must be rebuilt when source identity or sanitized HTML changes, even if the ref stays stable.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const wrappers: Array<{ wrapper: HTMLElement; original: HTMLElement }> = [];
    const links: Array<{
      original: HTMLAnchorElement;
      parts: HTMLAnchorElement[];
    }> = [];
    for (const anchor of content.querySelectorAll("a")) {
      if (!anchor.querySelector("img")) continue;
      const parts = Array.from(anchor.childNodes).map((child) => {
        const part = anchor.cloneNode(false) as HTMLAnchorElement;
        // Avoid repeating HTML IDs across the split links.
        part.removeAttribute("id");
        part.append(child);
        return part;
      });
      anchor.replaceWith(...parts);
      links.push({ original: anchor, parts });
    }
    const next: typeof targets = [];
    for (const img of content.querySelectorAll("img")) {
      const url = imageUrl(img.getAttribute("src") ?? "", articleUrl);
      if (!url) continue;
      img.loading = "lazy";
      img.decoding = "async";
      // The app-owned control is a sibling of the publisher link, never a
      // button nested inside it. Each image keeps its original link behavior.
      const anchor = img.closest("a");
      let original: HTMLElement = img;
      if (anchor && content.contains(anchor)) original = anchor;
      const wrapper = document.createElement("span");
      wrapper.className = "article-image-save";
      original.replaceWith(wrapper);
      wrapper.append(original);
      const host = document.createElement("span");
      wrapper.append(host);
      next.push({ host, url, alt: img.alt });
      wrappers.push({ wrapper, original });
    }
    setTargets(next);
    return () => {
      for (const { wrapper, original } of wrappers)
        if (wrapper.isConnected) wrapper.replaceWith(original);
      for (const { original, parts } of links) {
        const first = parts[0];
        if (!first?.isConnected) continue;
        first.before(original);
        for (const part of parts) {
          original.append(...Array.from(part.childNodes));
          part.remove();
        }
      }
    };
  }, [contentRef, html, articleUrl, source.kind, source.id]);
  const saved = new Set(query.data?.items.map((item) => item.imageSourceUrl));
  return targets.map(({ host, url, alt }, index) =>
    createPortal(
      <ImageSaveButton
        source={source}
        url={url}
        alt={alt}
        saved={saved.has(url)}
      />,
      host,
      `${source.kind}:${source.id}:${url}:${index}`,
    ),
  );
}
