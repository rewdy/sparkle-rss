import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from './api';
import { qk } from './keys';
import type { Subscription } from './types';

/**
 * Live view of the cached subscription list, memoized at the cache layer so
 * many memoized rows subscribing to it don't each re-derive the map.
 */
export function useSubscriptions(): Subscription[] {
  return (
    useQuery({
      queryKey: qk.subscriptions,
      queryFn: api.subscriptions.list,
      select: (data: { subscriptions: Subscription[] }) => data.subscriptions,
      staleTime: 60_000,
    }).data ?? []
  );
}

export function useFeedTitles(): Map<string, string> {
  const subs = useSubscriptions();
  return useMemo(() => new Map(subs.map((s) => [s.feedId, s.displayTitle] as const)), [subs]);
}
