import {
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Modal,
  NativeSelect,
  NavLink,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { api } from '../lib/api';
import { logout } from '../lib/auth';
import { qk, streamPath } from '../lib/keys';
import { useSubscribe } from '../lib/mutations';
import type { Folder, Subscription } from '../lib/types';

function unreadBadge(count: number): ReactElement | null {
  if (count <= 0) return null;
  return (
    <Badge size="sm" variant="light" color="accent" ff="monospace" radius="sm">
      {count > 999 ? '999+' : count}
    </Badge>
  );
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
  const starredCount = (subsQ.data?.subscriptions ?? []).length; // placeholder; starred stream count comes from entries

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
    <Box p="xs" h="100%">
      <Group justify="space-between" mb="xs" px={4}>
        <Text size="xs" c="dimmed" tt="uppercase" style={{ letterSpacing: 2 }}>
          streams
        </Text>
        <Button
          size="compact-xs"
          variant="subtle"
          onClick={() => setSubscribeOpen(true)}
          title="subscribe to a feed"
        >
          + add
        </Button>
      </Group>

      <NavLink
        component={Link}
        href="/all"
        active={location === '/all' || location === '/'}
        label={
          <Group justify="space-between" w="100%">
            <Text size="sm">All items</Text>
            {unreadBadge(totalUnread)}
          </Group>
        }
        onClick={() => nav('/all')}
      />
      <NavLink
        component={Link}
        href="/starred"
        active={location === '/starred'}
        label={<Text size="sm">Starred</Text>}
        onClick={() => nav('/starred')}
      />

      <Divider my="xs" label="folders" labelPosition="center" c="dimmed" />

      <ScrollArea offsetScrollbars style={{ height: 'calc(100vh - 220px)' }} type="hover">
        <Stack gap={2}>
          {folders.map((folder: Folder) => {
            const folderSubs = byFolder.get(folder.id) ?? [];
            return (
              <div key={folder.id}>
                <NavLink
                  component={Link}
                  href={`/folder/${folder.id}`}
                  active={location === `/folder/${folder.id}`}
                  label={
                    <Group justify="space-between" w="100%">
                      <Text size="sm">{folder.name}</Text>
                      {unreadBadge(folder.unreadCount)}
                    </Group>
                  }
                  onClick={() => nav(`/folder/${folder.id}`)}
                />
                {folderSubs.map((sub) => (
                  <FeedRow
                    key={sub.feedId}
                    sub={sub}
                    unread={feedUnread.get(sub.feedId) ?? 0}
                    indent
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            );
          })}
          {loose.length > 0 && (
            <>
              <Divider my="xs" labelPosition="center" c="dimmed" />
              {loose.map((sub) => (
                <FeedRow
                  key={sub.feedId}
                  sub={sub}
                  unread={feedUnread.get(sub.feedId) ?? 0}
                  onNavigate={onNavigate}
                />
              ))}
            </>
          )}
          {subs.length === 0 && (
            <Text size="xs" c="dimmed" ta="center" py="md">
              no subscriptions yet — add one above or import OPML in settings.
            </Text>
          )}
        </Stack>
      </ScrollArea>

      <Divider my="xs" />
      <Stack gap={2}>
        <UnstyledButton
          component={Link}
          href="/settings"
          onClick={() => nav('/settings')}
          px="xs"
          py={6}
          display="block"
        >
          <Text size="sm" c="dimmed">
            ⚙ settings
          </Text>
        </UnstyledButton>
        <UnstyledButton
          px="xs"
          py={6}
          display="block"
          onClick={() => {
            void logout();
          }}
        >
          <Text size="sm" c="dimmed">
            ⏻ sign out ({starredCount > 0 ? '' : ''}
            {''})
          </Text>
        </UnstyledButton>
      </Stack>

      <SubscribeModal
        opened={subscribeOpen}
        onClose={() => setSubscribeOpen(false)}
        folders={folders}
      />
    </Box>
  );
}

function FeedRow({
  sub,
  unread,
  indent,
  onNavigate,
}: {
  sub: Subscription;
  unread: number;
  indent?: boolean;
  onNavigate?: () => void;
}) {
  const [location] = useLocation();
  const target = streamPath({ kind: 'feed', id: sub.feedId });
  return (
    <NavLink
      component={Link}
      href={target}
      active={location === target}
      label={
        <Group justify="space-between" w="100%" wrap="nowrap" gap={4}>
          <Text size="sm" truncate={true} style={indent ? { paddingLeft: 14 } : undefined}>
            {sub.displayTitle}
          </Text>
          {unreadBadge(unread)}
        </Group>
      }
      onClick={() => onNavigate?.()}
    />
  );
}

function SubscribeModal({
  opened,
  onClose,
  folders,
}: {
  opened: boolean;
  onClose: () => void;
  folders: Folder[];
}): ReactElement {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [folderId, setFolderId] = useState<string>('');
  const subscribe = useSubscribe();

  async function submit(): Promise<void> {
    if (!url.trim()) return;
    await subscribe.mutateAsync({
      url: url.trim(),
      folderId: folderId === '' ? null : Number(folderId),
    });
    setUrl('');
    setTitle('');
    onClose();
  }

  return (
    <Modal opened={opened} onClose={onClose} title="subscribe" size="md">
      <Stack gap="sm">
        <TextInput
          label="feed or site URL"
          placeholder="https://example.com/blog"
          value={url}
          onChange={(e) => setUrl(e.currentTarget.value)}
          data-autofocus
          error={
            !url.startsWith('http') && url.length > 0 ? 'must start with http(s)://' : undefined
          }
        />
        <TextInput
          label="custom title (optional)"
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
        />
        <NativeSelect
          label="folder"
          description="feeds can be moved between folders later"
          value={folderId}
          onChange={(e) => setFolderId(e.currentTarget.value)}
          data={[
            { value: '', label: '— none —' },
            ...folders.map((f) => ({ value: f.id, label: f.name })),
          ]}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            cancel
          </Button>
          <Button onClick={() => void submit()} loading={subscribe.isPending}>
            subscribe
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
