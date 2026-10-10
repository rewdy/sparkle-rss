import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "./api";
import { qk } from "./keys";

export function useSavedLibrary(sort: "asc" | "desc", enabled = true) {
  return useInfiniteQuery({
    queryKey: qk.saved(sort),
    queryFn: ({ pageParam }) =>
      api.saved.list({ sort, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 30_000,
    gcTime: 240_000,
    enabled,
  });
}

export function useMediaRefresh(
  expiresAtMs: number | undefined,
  refresh: () => unknown,
) {
  useEffect(() => {
    if (expiresAtMs === undefined) return;
    const timer = window.setTimeout(
      () => {
        refresh();
      },
      Math.max(1000, expiresAtMs - Date.now() - 30_000),
    );
    return () => window.clearTimeout(timer);
  }, [expiresAtMs, refresh]);
}
