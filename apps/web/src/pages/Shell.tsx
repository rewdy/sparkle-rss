import { AppShell, Box } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { ReaderPane } from '../components/ReaderPane';
import { ShortcutsModal } from '../components/ShortcutsModal';
import { Sidebar } from '../components/Sidebar';
import { StreamInner } from '../components/StreamInner';
import { Topbar } from '../components/Topbar';
import { api } from '../lib/api';
import { parseStreamPath } from '../lib/keys';
import type { Entry } from '../lib/types';
import {
  activeEntryIdAtom,
  densityAtom,
  filterAtom,
  hydrateFromSettings,
  loadLocalUi,
  markReadOnOpenAtom,
  shortcutsOpenAtom,
} from '../lib/ui-state';
import { FullscreenLoader, useAuthGuard } from './guard';
import { SettingsPage } from './Settings';

function streamTitle(
  path: string,
  subs: Array<{ feedId: string; displayTitle: string }>,
  folders: Array<{ id: string; name: string }>,
): string {
  if (path === '/' || path === '/all') return 'all items';
  if (path === '/starred') return 'starred';
  const feed = /^\/feed\/(\d+)$/.exec(path);
  if (feed) return subs.find((s) => s.feedId === feed[1])?.displayTitle ?? `feed ${feed[1]}`;
  const folder = /^\/folder\/(\d+)$/.exec(path);
  if (folder) return folders.find((f) => f.id === folder[1])?.name ?? `folder ${folder[1]}`;
  return path;
}

export function Shell(): ReactElement {
  const authState = useAuthGuard();
  const [location] = useLocation();

  const [activeEntryId, setActiveEntryId] = useAtom(activeEntryIdAtom);
  const density = useAtomValue(densityAtom);
  const filter = useAtomValue(filterAtom);
  const setFilter = useSetAtom(filterAtom);
  const setShortcutsOpen = useSetAtom(shortcutsOpenAtom);
  const markReadOnOpen = useAtomValue(markReadOnOpenAtom);

  const subsQ = useQuery({ queryKey: ['subscriptions'], queryFn: api.subscriptions.list });
  const foldersQ = useQuery({ queryKey: ['folders'], queryFn: api.folders.list });

  useEffect(() => {
    let cancelled = false;
    void api.settings.get().then((res) => {
      if (!cancelled) hydrateFromSettings({ ...loadLocalUi(), ...res.data });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const descriptor = useMemo(() => parseStreamPath(location), [location]);

  // flat entry cache for keyboard navigation
  const [entriesCache, setEntriesCache] = useState<Entry[]>([]);
  const onEntriesChange = useCallback((entries: Entry[]) => setEntriesCache(entries), []);

  function move(delta: 1 | -1): void {
    if (entriesCache.length === 0) return;
    const idx = entriesCache.findIndex((e) => e.id === activeEntryId);
    const next =
      idx === -1
        ? delta === 1
          ? 0
          : entriesCache.length - 1
        : Math.min(Math.max(idx + delta, 0), entriesCache.length - 1);
    setActiveEntryId(entriesCache[next]?.id ?? null);
  }

  const activeEntry = useMemo(
    () => entriesCache.find((e) => e.id === activeEntryId),
    [entriesCache, activeEntryId],
  );

  // global hotkeys
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      if (e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        void api.entries.markAllRead(descriptor ?? { kind: 'all' });
        return;
      }
      switch (e.key) {
        case '?':
          setShortcutsOpen((open) => !open);
          break;
        case 'Escape':
          setActiveEntryId(null);
          break;
        case 'j':
          e.preventDefault();
          move(1);
          break;
        case 'k':
          e.preventDefault();
          move(-1);
          break;
        case 'm': {
          const current = entriesCache.find((en) => en.id === activeEntryId);
          if (current) void api.entries.setRead([current.id], !current.isRead);
          break;
        }
        case 's': {
          const current = entriesCache.find((en) => en.id === activeEntryId);
          if (current) void api.entries.setStarred([current.id], !current.isStarred);
          break;
        }
        default:
          break;
      }
    },
    [descriptor, entriesCache, activeEntryId, move, setActiveEntryId, setShortcutsOpen],
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
              : streamTitle(location, subsQ.data?.subscriptions ?? [], foldersQ.data?.folders ?? [])
          }
          filter={filter}
          onFilterChange={setFilter}
        />
      </AppShell.Header>

      <AppShell.Navbar p={0} style={{ overflowY: 'auto' }}>
        <Sidebar />
      </AppShell.Navbar>

      <AppShell.Main style={{ position: 'relative' }} data-density={density}>
        {location === '/settings' ? (
          <SettingsPage />
        ) : descriptor ? (
          <StreamInner
            stream={descriptor}
            filter={filter}
            sort="desc"
            activeEntryId={activeEntryId}
            markReadOnOpen={markReadOnOpen}
            onSelect={(entry) => {
              if (markReadOnOpen && !entry.isRead) {
                entry.isRead = true;
                void api.entries.setRead([entry.id], true);
              }
              setActiveEntryId(entry.id);
            }}
            onEntriesChange={onEntriesChange}
          />
        ) : (
          <div />
        )}

        {activeEntry && (
          <Box pos="absolute" inset={0} style={{ zIndex: 5 }}>
            <ReaderPane
              entry={activeEntry}
              onClose={() => setActiveEntryId(null)}
              onNext={() => move(1)}
              onPrev={() => move(-1)}
            />
          </Box>
        )}
      </AppShell.Main>

      <ShortcutsModal />
    </AppShell>
  );
}
