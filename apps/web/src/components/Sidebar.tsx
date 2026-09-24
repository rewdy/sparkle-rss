import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Menu,
  NavLink,
  ScrollArea,
  Stack,
  Switch,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtom } from "jotai";
import type { ReactElement } from "react";
import { lazy, Suspense, useState } from "react";
import {
  LuBookmark,
  LuCalendarDays,
  LuClock,
  LuEllipsisVertical,
  LuFolder,
  LuFolderOpen,
  LuFolderPlus,
  LuInbox,
  LuLogOut,
  LuMailOpen,
  LuPlus,
  LuRss,
  LuSettings,
} from "react-icons/lu";
import { Link, useLocation } from "wouter";
import { api } from "../lib/api";
import { logout } from "../lib/auth";
import { parseRoute, qk, streamPath } from "../lib/keys";
import type { Folder, StreamDescriptor, Subscription } from "../lib/types";
import { collapsedFoldersAtom, sidebarUnreadOnlyAtom } from "../lib/ui-state";
import { FeedIcon } from "./FeedIcon";
import { FeedMenu, FolderCreateModal, FolderMenu } from "./ManageMenus";

// The subscribe dialog drags Modal + form components; load it on first open.
const SubscribeModal = lazy(() =>
  import("./SubscribeModal").then((m) => ({ default: m.SubscribeModal })),
);

function unreadBadge(count: number): ReactElement | null {
  if (count <= 0) return null;
  return (
    <Badge size="sm" variant="light" color="accent" ff="monospace" radius="sm">
      {count > 999 ? "999+" : count}
    </Badge>
  );
}

function isActive(
  stream: StreamDescriptor | undefined,
  test: (s: StreamDescriptor) => boolean,
) {
  return stream !== undefined && test(stream);
}

export function Sidebar({
  onNavigate,
}: {
  onNavigate?: () => void;
}): ReactElement {
  const [location] = useLocation();
  const foldersQ = useQuery({
    queryKey: qk.folders,
    queryFn: api.folders.list,
  });
  const subsQ = useQuery({
    queryKey: qk.subscriptions,
    queryFn: api.subscriptions.list,
  });
  const countsQ = useQuery({
    queryKey: qk.unreadCounts,
    queryFn: api.unreadCounts,
  });
  const readLaterQ = useQuery({
    queryKey: qk.readLaterCount,
    queryFn: api.readLater.count,
  });

  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const qc = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useAtom(sidebarUnreadOnlyAtom);
  const [collapsedFolders, setCollapsedFolders] = useAtom(collapsedFoldersAtom);

  const folders = foldersQ.data?.folders ?? [];
  const subs = subsQ.data?.subscriptions ?? [];
  const feedUnread = new Map(
    (countsQ.data?.feeds ?? []).map((f) => [f.feedId, f.count]),
  );

  const unreadFor = (feedId: string): number => feedUnread.get(feedId) ?? 0;
  const visibleSubs = unreadOnly
    ? subs.filter((sub) => unreadFor(sub.feedId) > 0)
    : subs;
  const visibleFolders = unreadOnly
    ? folders.filter((folder) => folder.unreadCount > 0)
    : folders;

  function updateUnreadOnly(next: boolean): void {
    setUnreadOnly(next);
    void api.settings
      .put({ sidebarUnreadOnly: next })
      .then(() => qc.invalidateQueries({ queryKey: qk.settings }));
  }

  function toggleFolder(id: string): void {
    setCollapsedFolders(
      collapsedFolders.includes(id)
        ? collapsedFolders.filter((folderId) => folderId !== id)
        : [...collapsedFolders, id],
    );
  }

  const totalUnread = countsQ.data?.total ?? 0;
  const readLaterUnread = readLaterQ.data?.unread ?? 0;

  const route = parseRoute(location);
  const activeStream = route?.stream;

  const byFolder = new Map<string, Subscription[]>();
  const loose: Subscription[] = [];
  for (const sub of visibleSubs) {
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
    <Box p="xs" h="100%" style={{ display: "flex", flexDirection: "column" }}>
      {/* The add menu sits with the Streams header: adding a feed, folder, or
          article is a global action, not a property of one section. */}
      <Group justify="space-between" mb="xs" px={4} flex="none">
        <Text size="xs" c="dimmed" tt="uppercase" style={{ letterSpacing: 2 }}>
          streams
        </Text>
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <Button
              size="compact-xs"
              variant="subtle"
              leftSection={<LuPlus size={13} />}
              title="add feed, folder, or article"
            >
              add
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              leftSection={<LuRss size={14} />}
              onClick={() => setSubscribeOpen(true)}
            >
              add feed…
            </Menu.Item>
            <Menu.Item
              leftSection={<LuFolderPlus size={14} />}
              onClick={() => setFolderModalOpen(true)}
            >
              add folder…
            </Menu.Item>
            <Menu.Item
              leftSection={<LuClock size={14} />}
              component={Link}
              href="/read-later/new"
            >
              add article…
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>

      <NavLink
        component={Link}
        href="/today"
        active={isActive(activeStream, (s) => s.kind === "today")}
        label={
          <Group gap="xs" wrap="nowrap">
            <LuCalendarDays size={15} style={{ flexShrink: 0 }} />
            <Text size="sm">Today</Text>
          </Group>
        }
        onClick={() => nav("/today")}
      />
      <NavLink
        component={Link}
        href="/unread"
        active={isActive(activeStream, (s) => s.kind === "unread")}
        label={
          <Group justify="space-between" w="100%">
            <Group gap="xs" wrap="nowrap">
              <LuMailOpen size={15} style={{ flexShrink: 0 }} />
              <Text size="sm">All unread</Text>
            </Group>
            {unreadBadge(totalUnread)}
          </Group>
        }
        onClick={() => nav("/unread")}
      />
      <NavLink
        component={Link}
        href="/starred"
        active={isActive(activeStream, (s) => s.kind === "starred")}
        label={
          <Group gap="xs" wrap="nowrap">
            <LuBookmark size={15} style={{ flexShrink: 0 }} />
            <Text size="sm">Saved</Text>
          </Group>
        }
        onClick={() => nav("/starred")}
      />
      <NavLink
        component={Link}
        href="/read-later"
        active={isActive(activeStream, (s) => s.kind === "readLater")}
        label={
          <Group justify="space-between" w="100%">
            <Group gap="xs" wrap="nowrap">
              <LuClock size={15} style={{ flexShrink: 0 }} />
              <Text size="sm">Read later</Text>
            </Group>
            {unreadBadge(readLaterUnread)}
          </Group>
        }
        onClick={() => nav("/read-later")}
      />
      <NavLink
        component={Link}
        href="/all"
        active={isActive(activeStream, (s) => s.kind === "all")}
        label={
          <Group justify="space-between" w="100%">
            <Group gap="xs" wrap="nowrap">
              <LuInbox size={15} style={{ flexShrink: 0 }} />
              <Text size="sm">All items</Text>
            </Group>
            {unreadBadge(totalUnread)}
          </Group>
        }
        onClick={() => nav("/all")}
      />

      <Divider my="xs" c="dimmed" flex="none" />

      {/* Folders get their own section; the heading (and section) disappears
          entirely when the user has none. */}
      {visibleFolders.length > 0 && (
        <>
          <Group mb="xs" px={4} flex="none">
            <Text
              size="xs"
              c="dimmed"
              tt="uppercase"
              style={{ letterSpacing: 2 }}
            >
              folders
            </Text>
          </Group>
          <Stack gap={2} flex="none">
            {visibleFolders.map((folder: Folder) => {
              const folderSubs = byFolder.get(folder.id) ?? [];
              const collapsed = collapsedFolders.includes(folder.id);
              return (
                <div key={folder.id}>
                  <NavLink
                    component={Link}
                    href={`/folder/${folder.id}`}
                    active={isActive(
                      activeStream,
                      (s) => s.kind === "folder" && s.id === folder.id,
                    )}
                    leftSection={
                      <ActionIcon
                        variant="subtle"
                        color="dimmed"
                        size="compact-sm"
                        aria-label={
                          collapsed
                            ? `expand folder ${folder.name}`
                            : `collapse folder ${folder.name}`
                        }
                        title={collapsed ? "expand folder" : "collapse folder"}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleFolder(folder.id);
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        {collapsed ? (
                          <LuFolder size={14} />
                        ) : (
                          <LuFolderOpen size={14} />
                        )}
                      </ActionIcon>
                    }
                    label={
                      <Group justify="space-between" w="100%">
                        <Text size="sm" fw={700} truncate={true}>
                          {folder.name}
                        </Text>
                        <Group gap={2} wrap="nowrap" style={{ flexShrink: 0 }}>
                          {unreadBadge(folder.unreadCount)}
                          <FolderMenu folder={folder} />
                        </Group>
                      </Group>
                    }
                    onClick={() => nav(`/folder/${folder.id}`)}
                  />
                  {!collapsed &&
                    folderSubs.map((sub) => (
                      <FeedRow
                        key={sub.feedId}
                        sub={sub}
                        unread={feedUnread.get(sub.feedId) ?? 0}
                        active={isActive(
                          activeStream,
                          (s) => s.kind === "feed" && s.id === sub.feedId,
                        )}
                        onNavigate={onNavigate}
                        folders={folders}
                        indent
                      />
                    ))}
                </div>
              );
            })}
          </Stack>
          {/* One divider per section boundary: closing the folders block here
              keeps the streams/folders/feeds separators from doubling up when
              folders are hidden. */}
          <Divider my="xs" c="dimmed" flex="none" />
        </>
      )}

      <Group justify="space-between" mb="xs" px={4} flex="none">
        <Text size="xs" c="dimmed" tt="uppercase" style={{ letterSpacing: 2 }}>
          feeds
        </Text>
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              color="dimmed"
              size="compact-xs"
              aria-label="feed list options"
              title="feed list options"
            >
              <LuEllipsisVertical size={14} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Group
              gap="lg"
              px="sm"
              py="xs"
              wrap="nowrap"
              justify="space-between"
              onClick={(e) => e.stopPropagation()}
            >
              <Text size="sm">unread only</Text>
              <Switch
                size="xs"
                aria-label="unread only"
                checked={unreadOnly}
                onChange={(e) => updateUnreadOnly(e.currentTarget.checked)}
              />
            </Group>
          </Menu.Dropdown>
        </Menu>
      </Group>

      <ScrollArea type="hover" style={{ flex: 1, minHeight: 0 }}>
        <Stack gap={2}>
          {loose.length > 0 &&
            loose.map((sub) => (
              <FeedRow
                key={sub.feedId}
                sub={sub}
                unread={feedUnread.get(sub.feedId) ?? 0}
                active={isActive(
                  activeStream,
                  (s) => s.kind === "feed" && s.id === sub.feedId,
                )}
                onNavigate={onNavigate}
                folders={folders}
              />
            ))}
          {subs.length === 0 && (
            <Text size="xs" c="dimmed" ta="center" py="md">
              no subscriptions yet — add one above or import OPML in settings.
            </Text>
          )}
          {subs.length > 0 && unreadOnly && visibleSubs.length === 0 && (
            <Text size="xs" c="dimmed" ta="center" py="md">
              no unread items.
            </Text>
          )}
        </Stack>
      </ScrollArea>

      <Divider my="xs" flex="none" />
      <Stack gap={2} flex="none">
        <UnstyledButton
          component={Link}
          href="/settings"
          onClick={() => nav("/settings")}
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

      <FolderCreateModal
        opened={folderModalOpen}
        onClose={() => setFolderModalOpen(false)}
      />
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
  const target = streamPath({ kind: "feed", id: sub.feedId });
  return (
    <NavLink
      component={Link}
      href={target}
      active={active}
      label={
        <Group justify="space-between" w="100%" wrap="nowrap" gap={4}>
          <Group
            gap="xs"
            wrap="nowrap"
            miw={0}
            style={indent ? { paddingLeft: 14 } : undefined}
          >
            <FeedIcon iconUrl={sub.iconUrl} />
            <Text size="sm" truncate={true}>
              {sub.displayTitle}
            </Text>
          </Group>
          <Group gap={2} wrap="nowrap" style={{ flexShrink: 0 }}>
            {unreadBadge(unread)}
            <FeedMenu sub={sub} folders={folders} />
          </Group>
        </Group>
      }
      onClick={() => onNavigate?.()}
    />
  );
}
