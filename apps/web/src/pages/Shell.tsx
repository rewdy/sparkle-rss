import { AppShell, Center, Loader } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { useAtomValue, useSetAtom } from 'jotai';
import type { ReactElement } from 'react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { PageTitle } from '../components/PageTitle';
import { ReaderPane } from '../components/ReaderPane';
import { Sidebar } from '../components/Sidebar';
import { StreamInner } from '../components/StreamInner';
import { Topbar } from '../components/Topbar';
import { ApiError, api } from '../lib/api';
import { parseRoute, qk, streamPath } from '../lib/keys';
import { useMarkRead, useToggleStar } from '../lib/mutations';
import type { Entry, StreamDescriptor } from '../lib/types';
import {
  applySettings,
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
      return 'All items';
    case 'starred':
      return 'Starred';
    case 'today':
      return 'Today';
    case 'unread':
      return 'All unread';
    case 'feed':
      return subs.find((s) => s.feedId === d.id)?.displayTitle ?? `feed ${d.id}`;
    case 'folder':
      return folders.find((f) => f.id === d.id)?.name ?? `folder ${d.id}`;
  }
}

export function Shell(): ReactElement {
  const authState = useAuthGuard();
  const [location, navigate] = useLocation();
  // Mobile navbar drawer: collapsed.mobile is ignored at/above `sm`, so this
  // state only affects phones where the sidebar is hidden until the Burger opens it.
  const [navOpened, { toggle: toggleNav, close: closeNav }] = useDisclosure(false);

  const filter = useAtomValue(filterAtom);
  const setFilter = useSetAtom(filterAtom);
  const setShortcutsOpen = useSetAtom(shortcutsOpenAtom);
  const shortcutsOpen = useAtomValue(shortcutsOpenAtom);
  const markReadOnOpen = useAtomValue(markReadOnOpenAtom);
  const markRead = useMarkRead();
  const toggleStar = useToggleStar();

  const route = useMemo(() => parseRoute(location), [location]);
  const descriptor = route?.stream ?? null;
  const routeEntryId = route?.entryId ?? null;

  const subsQ = useQuery({ queryKey: qk.subscriptions, queryFn: api.subscriptions.list });
  const foldersQ = useQuery({ queryKey: qk.folders, queryFn: api.folders.list });

  useEffect(() => {
    let cancelled = false;
    void api.settings
      .get()
      .then((res) => {
        if (!cancelled) applySettings({ ...loadLocalUi(), ...res.data });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // flat entry cache for keyboard navigation
  const [entriesCache, setEntriesCache] = useState<Entry[]>([]);
  const onEntriesChange = useCallback((entries: Entry[]) => setEntriesCache(entries), []);

  // Source of truth for the open entry is the react-query cache (mutations
  // patch it optimistically); seed it from the stream cache to avoid a flash.
  const cachedEntry = useMemo(
    () => (routeEntryId ? (entriesCache.find((e) => e.id === routeEntryId) ?? null) : null),
    [entriesCache, routeEntryId],
  );
  const entryQ = useQuery({
    queryKey: routeEntryId ? qk.entry(routeEntryId) : ['entry', null],
    queryFn: () => api.entries.get(routeEntryId as string),
    enabled: routeEntryId !== null,
    initialData: cachedEntry ? { entry: cachedEntry } : undefined,
    retry: (_count, error) => !(error instanceof ApiError && error.status === 404),
  });
  const activeEntry = entryQ.data?.entry ?? null;
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
      if (markReadOnOpen) markRead.mutate({ ids: [entry.id], read: true });
      navigate(`${streamPath(descriptor)}/e/${entry.id}`);
    },
    [descriptor, markRead, markReadOnOpen, navigate],
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
    if (markReadOnOpen) markRead.mutate({ ids: [target.id], read: true });
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
        void api.entries.markAllRead(apiStream).catch(() => undefined);
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
          if (activeEntry) markRead.mutate({ ids: [activeEntry.id], read: !activeEntry.isRead });
          break;
        case 's':
          if (activeEntry)
            toggleStar.mutate({ ids: [activeEntry.id], starred: !activeEntry.isStarred });
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

  const APP_NAME = 'Sparkle RSS';
  const pageTitle = location.startsWith('/settings')
    ? `Settings · ${APP_NAME}`
    : descriptor
      ? `${streamTitle(
          descriptor,
          subsQ.data?.subscriptions ?? [],
          foldersQ.data?.folders ?? [],
        )} · ${APP_NAME}`
      : APP_NAME;

  return (
    <AppShell
      header={{ height: 44 }}
      navbar={{ width: 260, breakpoint: 'sm', collapsed: { mobile: !navOpened } }}
      padding={0}
    >
      <PageTitle title={pageTitle} />
      <AppShell.Header data-app-header="true">
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
          navOpened={navOpened}
          onToggleNav={toggleNav}
        />
      </AppShell.Header>

      <AppShell.Navbar p={0} style={{ overflow: 'hidden' }}>
        <Sidebar onNavigate={closeNav} />
      </AppShell.Navbar>

      <AppShell.Main style={{ position: 'relative' }}>
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
