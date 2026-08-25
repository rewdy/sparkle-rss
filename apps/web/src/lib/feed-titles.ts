import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from './api';
import { qk } from './keys';

export function useFeedTitles(): Map<string, string> {
  const subsQ = useQuery({ queryKey: qk.subscriptions, queryFn: api.subscriptions.list });
  return useMemo(
    () =>
      new Map((subsQ.data?.subscriptions ?? []).map((s) => [s.feedId, s.displayTitle] as const)),
    [subsQ.data],
  );
}
