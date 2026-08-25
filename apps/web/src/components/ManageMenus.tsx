import {
  ActionIcon,
  Button,
  Group,
  Menu,
  Modal,
  NativeSelect,
  Stack,
  TextInput,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { LuEllipsisVertical, LuFolderPlus, LuPencil, LuTrash2 } from 'react-icons/lu';
import {
  useFolderCreate,
  useFolderRemove,
  useFolderRename,
  useSubscriptionEdit,
  useUnsubscribe,
} from '../lib/mutations';
import type { Folder, Subscription } from '../lib/types';

function stop(e: { stopPropagation: () => void; preventDefault: () => void }): void {
  e.stopPropagation();
  e.preventDefault();
}

export function AddFolderButton(): ReactElement {
  const create = useFolderCreate();
  const [opened, { open, close }] = useDisclosure(false);
  const [name, setName] = useState('');

  function submit(): void {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    create.mutate(trimmed, {
      onSuccess: () => {
        setName('');
        close();
      },
    });
  }

  return (
    <>
      <ActionIcon
        variant="subtle"
        size="compact-xs"
        aria-label="add folder"
        title="add folder"
        onClick={open}
      >
        <LuFolderPlus size={13} />
      </ActionIcon>
      <Modal opened={opened} onClose={close} title="new folder" size="xs" centered>
        <Stack gap="sm">
          <TextInput
            label="name"
            data-autofocus
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <Button onClick={submit} loading={create.isPending} disabled={!name.trim()}>
            create
          </Button>
        </Stack>
      </Modal>
    </>
  );
}

export function FolderMenu({ folder }: { folder: Folder }): ReactElement {
  const rename = useFolderRename();
  const remove = useFolderRemove();
  const [renameOpened, { open: openRename, close: closeRename }] = useDisclosure(false);
  const [name, setName] = useState(folder.name);

  function submitRename(): void {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed === folder.name) {
      closeRename();
      return;
    }
    rename.mutate({ id: folder.id, name: trimmed }, { onSuccess: closeRename });
  }

  return (
    <>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon
            variant="subtle"
            color="dimmed"
            size="compact-sm"
            aria-label={`manage folder ${folder.name}`}
            onClick={stop}
            onMouseDown={stop}
          >
            <LuEllipsisVertical size={14} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            leftSection={<LuPencil size={14} />}
            onClick={() => {
              setName(folder.name);
              openRename();
            }}
          >
            rename
          </Menu.Item>
          <Menu.Item
            leftSection={<LuTrash2 size={14} />}
            color="red"
            onClick={() => {
              if (
                window.confirm(
                  `Delete folder "${folder.name}"? Its ${folder.feedCount} feed(s) move to no folder.`,
                )
              ) {
                remove.mutate(folder.id);
              }
            }}
          >
            delete folder
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <Modal opened={renameOpened} onClose={closeRename} title="rename folder" size="xs" centered>
        <Stack gap="sm">
          <TextInput
            label="name"
            data-autofocus
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitRename()}
          />
          <Button onClick={submitRename} loading={rename.isPending} disabled={!name.trim()}>
            save
          </Button>
        </Stack>
      </Modal>
    </>
  );
}

export function FeedMenu({ sub, folders }: { sub: Subscription; folders: Folder[] }): ReactElement {
  const edit = useSubscriptionEdit();
  const unsub = useUnsubscribe();
  const createFolder = useFolderCreate();
  const [renameOpened, { open: openRename, close: closeRename }] = useDisclosure(false);
  const [moveOpened, { open: openMove, close: closeMove }] = useDisclosure(false);
  const [title, setTitle] = useState(sub.displayTitle);
  const [folderChoice, setFolderChoice] = useState(sub.categoryId ?? '');
  const [newFolderName, setNewFolderName] = useState('');

  function submitRename(): void {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      closeRename();
      return;
    }
    edit.mutate({ feedId: sub.feedId, changes: { title: trimmed } }, { onSuccess: closeRename });
  }

  function submitMove(): void {
    const folderId = folderChoice === '' ? null : Number(folderChoice);
    if ((sub.categoryId ?? '') === folderChoice) {
      closeMove();
      return;
    }
    edit.mutate({ feedId: sub.feedId, changes: { folderId } }, { onSuccess: closeMove });
  }

  function createAndSelectFolder(): void {
    const trimmed = newFolderName.trim();
    if (trimmed.length === 0) return;
    createFolder.mutate(trimmed, {
      onSuccess: (res) => {
        setFolderChoice(res.folder.id);
        setNewFolderName('');
      },
    });
  }

  const folderOptions = [
    { value: '', label: '(no folder)' },
    ...folders.map((f) => ({ value: f.id, label: f.name })),
  ];

  return (
    <>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon
            variant="subtle"
            color="dimmed"
            size="compact-sm"
            aria-label={`manage feed ${sub.displayTitle}`}
            onClick={stop}
            onMouseDown={stop}
          >
            <LuEllipsisVertical size={14} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            leftSection={<LuPencil size={14} />}
            onClick={() => {
              setTitle(sub.customTitle ?? sub.feedTitle);
              openRename();
            }}
          >
            rename
          </Menu.Item>
          <Menu.Item
            leftSection={<LuFolderPlus size={14} />}
            onClick={() => {
              setFolderChoice(sub.categoryId ?? '');
              setNewFolderName('');
              openMove();
            }}
          >
            move to folder…
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item
            leftSection={<LuTrash2 size={14} />}
            color="red"
            onClick={() => {
              if (window.confirm(`Unsubscribe from "${sub.displayTitle}"?`)) {
                unsub.mutate(sub.feedId);
              }
            }}
          >
            unsubscribe
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <Modal opened={renameOpened} onClose={closeRename} title="rename feed" size="xs" centered>
        <Stack gap="sm">
          <TextInput
            label="title"
            data-autofocus
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitRename()}
          />
          <Button onClick={submitRename} loading={edit.isPending} disabled={!title.trim()}>
            save
          </Button>
        </Stack>
      </Modal>

      <Modal opened={moveOpened} onClose={closeMove} title="move to folder" size="xs" centered>
        <Stack gap="sm">
          <NativeSelect
            label="folder"
            data={folderOptions}
            value={folderChoice}
            onChange={(e) => setFolderChoice(e.currentTarget.value)}
          />
          <Group gap="xs" wrap="nowrap">
            <TextInput
              placeholder="new folder name"
              style={{ flex: 1 }}
              value={newFolderName}
              onChange={(e) => {
                setNewFolderName(e.currentTarget.value);
                if (folderChoice === '__new__') setFolderChoice(sub.categoryId ?? '');
              }}
              onKeyDown={(e) => e.key === 'Enter' && createAndSelectFolder()}
            />
            <Button
              variant="default"
              onClick={createAndSelectFolder}
              loading={createFolder.isPending}
              disabled={!newFolderName.trim()}
            >
              create
            </Button>
          </Group>
          <Button onClick={submitMove} loading={edit.isPending}>
            save
          </Button>
        </Stack>
      </Modal>
    </>
  );
}
