import { AppShell, Center, Loader } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useAtomValue, useSetAtom } from 'jotai';
import type { ReactElement } from 'react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { ReaderPane } from '../components/ReaderPane';
import { Sidebar } from '../components/Sidebar';
import { StreamInner } from '../components/StreamInner';
import { Topbar } from '../components/Topbar';
import { ApiError, api } from '../lib/api';
import { parseRoute, qk, streamPath } from '../lib/keys';
import type { Entry, StreamDescriptor } from '../lib/types';
import {
  applySettings,
  densityAtom,
  filterAtom,
  loadLocalUi,
  markReadOnOpenAtom,
  shortcutsOpenAtom,
} from '../lib/ui-state';
import { FullscreenLoader, useAuthGuard } from './guard';

// Settings drags the heaviest non-essential Mantine components (forms, copy
// button, switches); keep them off the first-paint critical path.
const SettingsPage = lazy(() => import('./Settings').then((m) => ({ default: m.SettingsPage })));
// Shortcut sheet + its Modal/Table are only needed when opened with `?`.
const ShortcutsModal = lazy(() =>
  import('../components/ShortcutsModal').then((m) => ({ default: m.ShortcutsModal })),
);

function streamTitle(
  d: StreamDescriptor,
  subs: Array<{ feedId: string; displayTitle: string }>,
  folders: Array<{ id: string; name: string }>,
): string {
  switch (d.kind) {
    case 'all':
      return 'all items';
    case 'starred':
      return 'starred';
    case 'today':
      return 'today';
    case 'unread':
      return 'all unread';
    case 'feed':
      return subs.find((s) => s.feedId === d.id)?.displayTitle ?? `feed ${d.id}`;
    case 'folder':
      return folders.find((f) => f.id === d.id)?.name ?? `folder ${d.id}`;
  }
}

export function Shell(): ReactElement {
  const authState = useAuthGuard();
  const [location, navigate] = useLocation();

  const density = useAtomValue(densityAtom);
  const filter = useAtomValue(filterAtom);
  const setFilter = useSetAtom(filterAtom);
  const setShortcutsOpen = useSetAtom(shortcutsOpenAtom);
  const shortcutsOpen = useAtomValue(shortcutsOpenAtom);
  const markReadOnOpen = useAtomValue(markReadOnOpenAtom);

  const route = useMemo(() => parseRoute(location), [location]);
  const descriptor = route?.stream ?? null;
  const routeEntryId = route?.entryId ?? null;

  const subsQ = useQuery({ queryKey: qk.subscriptions, queryFn: api.subscriptions.list });
  const foldersQ = useQuery({ queryKey: qk.folders, queryFn: api.folders.list });

  useEffect(() => {
    let cancelled = false;
    void api.settings.get().then((res) => {
      if (!cancelled) applySettings({ ...loadLocalUi(), ...res.data });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // flat entry cache for keyboard navigation
  const [entriesCache, setEntriesCache] = useState<Entry[]>([]);
  const onEntriesChange = useCallback((entries: Entry[]) => setEntriesCache(entries), []);

  const cachedEntry = useMemo(
    () => (routeEntryId ? (entriesCache.find((e) => e.id === routeEntryId) ?? null) : null),
    [entriesCache, routeEntryId],
  );

  // Deep link with an entry not in the loaded list: fetch it by id.
  const entryQ = useQuery({
    queryKey: routeEntryId ? qk.entry(routeEntryId) : ['entry', null],
    queryFn: () => api.entries.get(routeEntryId as string),
    enabled: routeEntryId !== null && !entriesCache.some((e) => e.id === routeEntryId),
    retry: (_count, error) => !(error instanceof ApiError && error.status === 404),
  });
  const activeEntry = cachedEntry ?? entryQ.data?.entry ?? null;
  const entryLoading =
    routeEntryId !== null && !cachedEntry && entryQ.isPending && entryQ.isFetching;

  // 404 on a deep-linked entry: close back to the bare stream route.
  useEffect(() => {
    if (
      descriptor &&
      routeEntryId !== null &&
      entryQ.error instanceof ApiError &&
      entryQ.error.status === 404
    ) {
      navigate(streamPath(descriptor), { replace: true });
    }
  }, [descriptor, routeEntryId, entryQ.error, navigate]);

  // Stable callback: rows in the virtualized list are memoized on it.
  const openEntry = useCallback(
    (entry: Entry) => {
      if (!descriptor) return;
      if (markReadOnOpen && !entry.isRead) {
        entry.isRead = true;
        void api.entries.setRead([entry.id], true);
      }
      navigate(`${streamPath(descriptor)}/e/${entry.id}`);
    },
    [descriptor, markReadOnOpen, navigate],
  );

  function closeReader(): void {
    if (!descriptor) return;
    navigate(streamPath(descriptor), { replace: true });
  }

  function move(delta: 1 | -1): void {
    if (!descriptor || entriesCache.length === 0) return;
    const idx = routeEntryId ? entriesCache.findIndex((e) => e.id === routeEntryId) : -1;
    const next =
      idx === -1
        ? delta === 1
          ? 0
          : entriesCache.length - 1
        : Math.min(Math.max(idx + delta, 0), entriesCache.length - 1);
    const target = entriesCache[next];
    if (!target) return;
    if (markReadOnOpen && !target.isRead) {
      target.isRead = true;
      void api.entries.setRead([target.id], true);
    }
    navigate(`${streamPath(descriptor)}/e/${target.id}`);
  }

  function onFilterChange(next: 'all' | 'unread'): void {
    setFilter(next);
    if (routeEntryId !== null && descriptor) navigate(streamPath(descriptor), { replace: true });
  }

  // global hotkeys
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      if (e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        // 'today' would mark ALL of today's API stream read — skip it
        if (descriptor?.kind === 'today') return;
        const apiStream: StreamDescriptor =
          descriptor && descriptor.kind === 'unread'
            ? { kind: 'all' }
            : (descriptor ?? { kind: 'all' });
        void api.entries.markAllRead(apiStream);
        return;
      }
      switch (e.key) {
        case '?':
          setShortcutsOpen((open) => !open);
          break;
        case 'Escape':
          if (routeEntryId !== null) closeReader();
          break;
        case 'j':
          e.preventDefault();
          move(1);
          break;
        case 'k':
          e.preventDefault();
          move(-1);
          break;
        case 'm':
          if (activeEntry) void api.entries.setRead([activeEntry.id], !activeEntry.isRead);
          break;
        case 's':
          if (activeEntry) void api.entries.setStarred([activeEntry.id], !activeEntry.isStarred);
          break;
        default:
          break;
      }
    },
    [descriptor, routeEntryId, activeEntry, move, closeReader, setShortcutsOpen],
  );

  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  if (authState !== 'authed') {
    return <FullscreenLoader label="checking session…" />;
  }

  return (
    <AppShell
      header={{ height: 44 }}
      navbar={{ width: 260, breakpoint: 'sm', collapsed: { mobile: true } }}
      padding={0}
    >
      <AppShell.Header>
        <Topbar
          stream={descriptor ?? { kind: 'all' }}
          title={
            location === '/settings'
              ? 'settings'
              : descriptor
                ? streamTitle(
                    descriptor,
                    subsQ.data?.subscriptions ?? [],
                    foldersQ.data?.folders ?? [],
                  )
                : ''
          }
          filter={filter}
          onFilterChange={onFilterChange}
        />
      </AppShell.Header>

      <AppShell.Navbar p={0} style={{ overflow: 'hidden' }}>
        <Sidebar />
      </AppShell.Navbar>

      <AppShell.Main style={{ position: 'relative' }} data-density={density}>
        {location === '/settings' ? (
          <Suspense
            fallback={
              <Center mih="100%">
                <Loader size="sm" type="dots" />
              </Center>
            }
          >
            <SettingsPage />
          </Suspense>
        ) : descriptor ? (
          routeEntryId !== null ? (
            entryLoading ? (
              <Center h="calc(100dvh - var(--app-shell-header-offset, 0rem))">
                <Loader size="sm" type="dots" />
              </Center>
            ) : activeEntry ? (
              <ReaderPane
                entry={activeEntry}
                onClose={closeReader}
                onNext={() => move(1)}
                onPrev={() => move(-1)}
              />
            ) : null
          ) : (
            <StreamInner
              stream={descriptor}
              filter={filter}
              sort="desc"
              activeEntryId={routeEntryId}
              onSelect={openEntry}
              onEntriesChange={onEntriesChange}
            />
          )
        ) : (
          <div />
        )}
      </AppShell.Main>

      {shortcutsOpen && (
        <Suspense fallback={null}>
          <ShortcutsModal />
        </Suspense>
      )}
    </AppShell>
  );
}
