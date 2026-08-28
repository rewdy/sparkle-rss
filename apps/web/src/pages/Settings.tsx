import {
  Badge,
  Box,
  Button,
  Card,
  CheckIcon,
  Code,
  ColorSwatch,
  CopyButton,
  Divider,
  Group,
  Modal,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAtom } from 'jotai';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { api } from '../lib/api';
import { logout } from '../lib/auth';
import { qk } from '../lib/keys';
import {
  markReadOnOpenAtom,
  persistUiPatch,
  useColorSchemeValue,
  useThemeValue,
} from '../lib/ui-state';
import { THEME_DEFS } from '../themes';

export function SettingsPage(): ReactElement {
  const settingsQ = useQuery({ queryKey: qk.settings, queryFn: api.settings.get });
  const [scheme, setScheme] = useColorSchemeValue();
  const [themeId, setThemeId] = useThemeValue();
  const [markOnOpen, setMarkOnOpen] = useMarkOnOpen();

  async function saveSetting(patch: Record<string, unknown>): Promise<void> {
    persistUiPatch(patch);
    await api.settings.put(patch);
    void settingsQ.refetch();
  }

  return (
    <Stack gap="md" p="lg" maw={720} mx="auto">
      <Title order={2}>settings</Title>

      <Card withBorder padding="lg">
        <Stack gap="sm">
          <Text fw={700} size="sm">
            appearance
          </Text>
          <Text size="sm" fw={600}>
            light / dark
          </Text>
          <SegmentedControl
            value={scheme}
            onChange={(next) => {
              const v = next as 'light' | 'dark';
              setScheme(v);
              void saveSetting({ colorScheme: v });
            }}
            data={[
              { value: 'dark', label: 'dark' },
              { value: 'light', label: 'light' },
            ]}
            w={220}
          />
          <Text size="sm" fw={600}>
            theme
          </Text>
          <Group gap="sm">
            {Object.values(THEME_DEFS).map((def) => (
              <Stack key={def.id} gap={4} align="center">
                <ColorSwatch
                  component="button"
                  color={def.accent[6]}
                  radius="sm"
                  size={38}
                  aria-label={`${def.label} theme`}
                  onClick={() => {
                    const next = def.id;
                    setThemeId(next);
                    void saveSetting({ themeId: next });
                  }}
                  style={{
                    cursor: 'pointer',
                    color: '#fff',
                    boxShadow:
                      themeId === def.id
                        ? '0 0 0 3px var(--mantine-color-body), 0 0 0 5px var(--mantine-color-accent-5)'
                        : undefined,
                  }}
                >
                  {themeId === def.id && <CheckIcon size={16} />}
                </ColorSwatch>
                <Text size="xs" c={themeId === def.id ? undefined : 'dimmed'}>
                  {def.label}
                </Text>
              </Stack>
            ))}
          </Group>
          <Switch
            label="mark items read when opened"
            checked={markOnOpen}
            onChange={(e) => {
              setMarkOnOpen(e.currentTarget.checked);
              void saveSetting({ markReadOnOpen: e.currentTarget.checked });
            }}
          />
        </Stack>
      </Card>

      <ApiTokensCard />

      <OpmlCard />

      <Divider my="xs" />
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          session
        </Text>
        <Button variant="default" size="sm" onClick={() => void logout()}>
          sign out
        </Button>
      </Group>
    </Stack>
  );
}

function useMarkOnOpen() {
  return useAtom(markReadOnOpenAtom);
}

function ApiTokensCard(): ReactElement {
  const qc = useQueryClient();
  const tokensQ = useQuery({ queryKey: qk.tokens, queryFn: api.tokens.list });
  const mint = useMutation({
    mutationFn: (label: string) => api.tokens.mint(label),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.tokens }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.tokens.revoke(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.tokens }),
  });

  const [label, setLabel] = useState('');
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<{ id: string; label: string } | null>(null);

  async function confirmRevoke(): Promise<void> {
    if (!pendingRevoke) return;
    await revoke.mutateAsync(pendingRevoke.id);
    setPendingRevoke(null);
  }

  return (
    <Card withBorder padding="lg">
      <Stack gap="sm">
        <Text fw={700} size="sm">
          API tokens
        </Text>
        <Text size="xs" c="dimmed">
          used by native clients (NetNewsWire etc.) — password field in the client, not your login.
        </Text>

        {mintedTokenBanner(freshToken)}

        <Group gap="xs">
          <TextInput
            placeholder="label (e.g. netnewswire-mac)"
            value={label}
            onChange={(e) => setLabel(e.currentTarget.value)}
            w={260}
          />
          <Button
            size="sm"
            onClick={() =>
              void mint.mutateAsync(label.trim()).then((r) => {
                setFreshToken(r.token);
                setLabel('');
              })
            }
            loading={mint.isPending}
          >
            generate token
          </Button>
        </Group>

        <Stack gap={4}>
          {(tokensQ.data?.tokens ?? []).map((t) => (
            <Group key={t.id} justify="space-between">
              <Group gap="xs">
                <Badge variant="light" color="accent" radius="sm" ff="monospace">
                  {t.id.slice(0, 8)}
                </Badge>
                <Text size="sm">{t.label || '(unlabeled)'}</Text>
                <Text size="xs" c="dimmed">
                  {new Date(t.createdAtMs).toLocaleDateString()}
                </Text>
              </Group>
              <Button
                size="compact-xs"
                variant="subtle"
                color="red"
                onClick={() => setPendingRevoke({ id: t.id, label: t.label })}
              >
                revoke
              </Button>
            </Group>
          ))}
        </Stack>

        <Modal
          opened={pendingRevoke !== null}
          onClose={() => setPendingRevoke(null)}
          title="revoke token"
          size="sm"
        >
          {pendingRevoke && (
            <Stack gap="sm">
              <Text size="sm">
                Revoke{' '}
                <Text component="span" ff="monospace">
                  {pendingRevoke.label || '(unlabeled)'}
                </Text>
                ? Any client using it (e.g. NetNewsWire) is disconnected immediately.
              </Text>
              <Group justify="flex-end">
                <Button variant="default" onClick={() => setPendingRevoke(null)}>
                  cancel
                </Button>
                <Button color="red" loading={revoke.isPending} onClick={() => void confirmRevoke()}>
                  revoke
                </Button>
              </Group>
            </Stack>
          )}
        </Modal>
      </Stack>
    </Card>
  );
}

function mintedTokenBanner(token: string | null): ReactElement | null {
  if (!token) return null;
  return (
    <Box p="xs" bg="var(--mantine-color-accent-9)">
      <Group justify="space-between" wrap="nowrap">
        <Code style={{ whiteSpace: 'nowrap', overflowX: 'auto' }}>{token}</Code>
        <CopyButton value={token}>
          {(props) => (
            <Button size="compact-xs" variant="light" {...props}>
              copy
            </Button>
          )}
        </CopyButton>
      </Group>
      <Text size="xs" c="dimmed" mt={4}>
        shown once — store it now
      </Text>
    </Box>
  );
}

function OpmlCard(): ReactElement {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>('');

  async function doExport(): Promise<void> {
    const blob = await api.opml.exportBlob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'sparkle-subscriptions.opml';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function doImport(file: File): Promise<void> {
    setStatus('importing…');
    const xml = await file.text();
    try {
      const result = await api.opml.importText(xml);
      setStatus(`imported ${result.imported}/${result.found}`);
      void qc.invalidateQueries({ queryKey: qk.subscriptions });
      void qc.invalidateQueries({ queryKey: qk.folders });
    } catch (e) {
      setStatus(`error: ${(e as Error).message}`);
    }
  }

  return (
    <Card withBorder padding="lg">
      <Stack gap="sm">
        <Text fw={700} size="sm">
          OPML subscriptions
        </Text>
        <Group gap="xs">
          <Button size="sm" variant="default" onClick={() => void doExport()}>
            export .opml
          </Button>
          <input
            type="file"
            accept=".opml,.xml,text/xml,application/xml"
            style={{ display: 'none' }}
            id="opml-file-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void doImport(file);
            }}
          />
          <Button size="sm" variant="default" component="label" htmlFor="opml-file-input">
            import .opml
          </Button>
          {status && (
            <Text size="xs" ff="monospace" c="dimmed">
              {status}
            </Text>
          )}
        </Group>
      </Stack>
    </Card>
  );
}
