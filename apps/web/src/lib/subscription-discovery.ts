import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { SessionExpiredError } from "./auth";

export function isHttpUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function rssFinderUrl(sourceUrl: string): string {
  const url = new URL("https://rssfinder.app/");
  url.searchParams.set("q", sourceUrl);
  return url.href;
}

export function canOfferRssFinder(error: unknown): boolean {
  return (
    !(error instanceof SessionExpiredError) &&
    ![400, 401, 403, 409].includes(
      (error as { status?: number } | null)?.status ?? 0,
    )
  );
}

export function useFeedDiscovery(sourceUrl: string) {
  return useQuery({
    queryKey: ["feed-discovery", sourceUrl],
    queryFn: ({ signal }) => api.subscriptions.discover(sourceUrl, signal),
    enabled: isHttpUrl(sourceUrl),
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/** The manual dialog keeps discovery and creation in one pending operation. */
export function useDiscoverFeed() {
  return useMutation({
    mutationFn: (url: string) => api.subscriptions.discover(url),
  });
}
