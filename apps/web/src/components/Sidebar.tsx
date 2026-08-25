import {
  Badge,
  Box,
  Button,
  Divider,
  Group,
  NavLink,
  ScrollArea,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { lazy, Suspense, useState } from 'react';
import {
  LuCalendarDays,
  LuInbox,
  LuLogOut,
  LuMailOpen,
  LuPlus,
  LuSettings,
  LuStar,
} from 'react-icons/lu';
import { Link, useLocation } from 'wouter';
import { api } from '../lib/api';
import { logout } from '../lib/auth';
import { parseRoute, qk, streamPath } from '../lib/keys';
import type { Folder, StreamDescriptor, Subscription } from '../lib/types';
import { AddFolderButton, FeedMenu, FolderMenu } from './ManageMenus';

// The subscribe dialog drags Modal + form components; load it on first open.
const SubscribeModal = lazy(() =>
  import('./SubscribeModal').then((m) => ({ default: m.SubscribeModal })),
);

function unreadBadge(count: number): ReactElement | null {
  if (count <= 0) return null;
  return (
    <Badge size="sm" variant="light" color="accent" ff="monospace" radius="sm">
      {count > 999 ? '999+' : count}
    </Badge>
  );
}

function isActive(stream: StreamDescriptor | undefined, test: (s: StreamDescriptor) => boolean) {
  return stream !== undefined && test(stream);
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }): ReactElement {
  const [location] = useLocation();
  const foldersQ = useQuery({ queryKey: qk.folders, queryFn: api.folders.list });
  const subsQ = useQuery({ queryKey: qk.subscriptions, queryFn: api.subscriptions.list });
  const countsQ = useQuery({ queryKey: qk.unreadCounts, queryFn: api.unreadCounts });

  const [subscribeOpen, setSubscribeOpen] = useState(false);

  const folders = foldersQ.data?.folders ?? [];
  const subs = subsQ.data?.subscriptions ?? [];
  const feedUnread = new Map((countsQ.data?.feeds ?? []).map((f) => [f.feedId, f.count]));

  const totalUnread = countsQ.data?.total ?? 0;

  const route = parseRoute(location);
  const activeStream = route?.stream;

  const byFolder = new Map<string, Subscription[]>();
  const loose: Subscription[] = [];
  for (const sub of subs) {
    if (sub.categoryId) {
      const list = byFolder.get(sub.categoryId) ?? [];
      list.push(sub);
      byFolder.set(sub.categoryId, list);
    } else {
      loose.push(sub);
    }
  }

  function nav(target: string) {
    onNavigate?.();
    void target;
  }

  return (
    <Box p="xs" h="100%" style={{ display: 'flex', flexDirection: 'column' }}>
      <Group justify="space-between" mb="xs" px={4} flex="none">
        <Text size="xs" c="dimmed" tt="uppercase" style={{ letterSpacing: 2 }}>
          streams
        </Text>
        <Button
          size="compact-xs"
          variant="subtle"
          leftSection={<LuPlus size={13} />}
          onClick={() => setSubscribeOpen(true)}
          title="subscribe to a feed"
        >
          add
        </Button>
      </Group>

      <NavLink
        component={Link}
        href="/today"
        active={isActive(activeStream, (s) => s.kind === 'today')}
        label={
          <Group gap="xs" wrap="nowrap">
            <LuCalendarDays size={15} style={{ flexShrink: 0 }} />
            <Text size="sm">Today</Text>
          </Group>
        }
        onClick={() => nav('/today')}
      />
      <NavLink
        component={Link}
        href="/unread"
        active={isActive(activeStream, (s) => s.kind === 'unread')}
        label={
          <Group justify="space-between" w="100%">
            <Group gap="xs" wrap="nowrap">
              <LuMailOpen size={15} style={{ flexShrink: 0 }} />
              <Text size="sm">All unread</Text>
            </Group>
            {unreadBadge(totalUnread)}
          </Group>
        }
        onClick={() => nav('/unread')}
      />
      <NavLink
        component={Link}
        href="/starred"
        active={isActive(activeStream, (s) => s.kind === 'starred')}
        label={
          <Group gap="xs" wrap="nowrap">
            <LuStar size={15} style={{ flexShrink: 0 }} />
            <Text size="sm">Starred</Text>
          </Group>
        }
        onClick={() => nav('/starred')}
      />
      <NavLink
        component={Link}
        href="/all"
        active={isActive(activeStream, (s) => s.kind === 'all')}
        label={
          <Group justify="space-between" w="100%">
            <Group gap="xs" wrap="nowrap">
              <LuInbox size={15} style={{ flexShrink: 0 }} />
              <Text size="sm">All items</Text>
            </Group>
            {unreadBadge(totalUnread)}
          </Group>
        }
        onClick={() => nav('/all')}
      />

      <Box my="xs" flex="none">
        <Group gap="xs" wrap="nowrap">
          <Text size="xs" c="dimmed" tt="uppercase" style={{ letterSpacing: 2 }}>
            folders
          </Text>
          <Divider c="dimmed" style={{ flex: 1 }} />
          <AddFolderButton />
        </Group>
      </Box>

      <ScrollArea type="hover" style={{ flex: 1, minHeight: 0 }}>
        <Stack gap={2}>
          {folders.map((folder: Folder) => {
            const folderSubs = byFolder.get(folder.id) ?? [];
            return (
              <div key={folder.id}>
                <NavLink
                  component={Link}
                  href={`/folder/${folder.id}`}
                  active={isActive(activeStream, (s) => s.kind === 'folder' && s.id === folder.id)}
                  label={
                    <Group justify="space-between" w="100%">
                      <Text size="sm">{folder.name}</Text>
                      <Group gap="xxs" wrap="nowrap">
                        {unreadBadge(folder.unreadCount)}
                        <FolderMenu folder={folder} />
                      </Group>
                    </Group>
                  }
                  onClick={() => nav(`/folder/${folder.id}`)}
                />
                {folderSubs.map((sub) => (
                  <FeedRow
                    key={sub.feedId}
                    sub={sub}
                    unread={feedUnread.get(sub.feedId) ?? 0}
                    active={isActive(activeStream, (s) => s.kind === 'feed' && s.id === sub.feedId)}
                    onNavigate={onNavigate}
                    folders={folders}
                    indent
                  />
                ))}
              </div>
            );
          })}
          {folders.length > 0 && loose.length > 0 && <Divider my="xs" c="dimmed" />}
          {loose.length > 0 &&
            loose.map((sub) => (
              <FeedRow
                key={sub.feedId}
                sub={sub}
                unread={feedUnread.get(sub.feedId) ?? 0}
                active={isActive(activeStream, (s) => s.kind === 'feed' && s.id === sub.feedId)}
                onNavigate={onNavigate}
                folders={folders}
              />
            ))}
          {subs.length === 0 && (
            <Text size="xs" c="dimmed" ta="center" py="md">
              no subscriptions yet — add one above or import OPML in settings.
            </Text>
          )}
        </Stack>
      </ScrollArea>

      <Divider my="xs" flex="none" />
      <Stack gap={2} flex="none">
        <UnstyledButton
          component={Link}
          href="/settings"
          onClick={() => nav('/settings')}
          px="xs"
          py="xs"
          display="block"
        >
          <Group gap="xs" wrap="nowrap">
            <LuSettings size={15} style={{ flexShrink: 0 }} />
            <Text size="sm" c="dimmed">
              settings
            </Text>
          </Group>
        </UnstyledButton>
        <UnstyledButton
          px="xs"
          py="xs"
          display="block"
          onClick={() => {
            void logout();
          }}
        >
          <Group gap="xs" wrap="nowrap">
            <LuLogOut size={15} style={{ flexShrink: 0 }} />
            <Text size="sm" c="dimmed">
              sign out
            </Text>
          </Group>
        </UnstyledButton>
      </Stack>

      {subscribeOpen && (
        <Suspense fallback={null}>
          <SubscribeModal
            opened={subscribeOpen}
            onClose={() => setSubscribeOpen(false)}
            folders={folders}
          />
        </Suspense>
      )}
    </Box>
  );
}

function FeedRow({
  sub,
  unread,
  active,
  indent,
  onNavigate,
  folders,
}: {
  sub: Subscription;
  unread: number;
  active: boolean;
  indent?: boolean;
  onNavigate?: () => void;
  folders: Folder[];
}) {
  const target = streamPath({ kind: 'feed', id: sub.feedId });
  return (
    <NavLink
      component={Link}
      href={target}
      active={active}
      label={
        <Group justify="space-between" w="100%" wrap="nowrap" gap={4}>
          <Text size="sm" truncate={true} style={indent ? { paddingLeft: 14 } : undefined}>
            {sub.displayTitle}
          </Text>
          <Group gap="xxs" wrap="nowrap">
            {unreadBadge(unread)}
            <FeedMenu sub={sub} folders={folders} />
          </Group>
        </Group>
      }
      onClick={() => onNavigate?.()}
    />
  );
}
