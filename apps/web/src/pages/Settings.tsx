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
  useComputedColorScheme,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtom } from "jotai";
import type { ReactElement } from "react";
import { useId, useState } from "react";
import { LuDownload, LuUpload } from "react-icons/lu";
import { BookmarkletLink } from "../components/BookmarkletLink";
import { api } from "../lib/api";
import { logout } from "../lib/auth";
import { homeViewFromSettings } from "../lib/home-view";
import { qk } from "../lib/keys";
import {
  markReadOnOpenAtom,
  sidebarUnreadOnlyAtom,
  useColorSchemeValue,
  useThemeValue,
} from "../lib/ui-state";
import { fonts, presetEmphasisColor, THEME_DEFS } from "../themes";

export function SettingsPage(): ReactElement {
  const settingsQ = useQuery({
    queryKey: qk.settings,
    queryFn: api.settings.get,
  });
  const queryClient = useQueryClient();
  const homeViewId = useId();
  const homeViewSave = useMutation({
    mutationFn: (homeView: string) => api.settings.put({ homeView }),
    onSuccess: async (settings) => {
      await queryClient.cancelQueries({ queryKey: qk.settings, exact: true });
      queryClient.setQueryData(qk.settings, settings);
    },
  });
  const [scheme, setScheme] = useColorSchemeValue();
  const [themeId, setThemeId] = useThemeValue();
  const computedScheme = useComputedColorScheme(
    scheme === "system" ? "light" : scheme,
  );
  const [markOnOpen, setMarkOnOpen] = useMarkOnOpen();
  const [unreadOnly, setUnreadOnly] = useAtom(sidebarUnreadOnlyAtom);

  // Persists account-level preferences to `user_settings`; the atom setters
  // already keep the local first-paint cache in sync.
  async function saveSetting(patch: Record<string, unknown>): Promise<void> {
    await api.settings.put(patch);
    void settingsQ.refetch();
  }

  return (
    <Stack gap="lg" p="lg" maw={720} mx="auto" ff={fonts.sans}>
      <Title order={2}>Settings</Title>

      <Card withBorder padding="lg">
        <Stack gap="sm">
          <Title order={3} size="md">
            Appearance
          </Title>
          <Text size="sm" fw={600}>
            Color scheme
          </Text>
          <SegmentedControl
            value={scheme}
            onChange={(next) => {
              // Light/dark is device-local: the atom setter persists it to
              // localStorage and nothing is sent to the server.
              setScheme(next as "light" | "dark" | "system");
            }}
            data={[
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
              { value: "system", label: "System" },
            ]}
            w={300}
            maw="100%"
          />
          <Text size="sm" fw={600}>
            Theme
          </Text>
          <Group gap="sm">
            {Object.values(THEME_DEFS).map((def) => (
              <Stack key={def.id} gap={4} align="center">
                <ColorSwatch
                  component="button"
                  color={presetEmphasisColor(def, computedScheme)}
                  radius="sm"
                  size={38}
                  aria-label={`${def.label} theme`}
                  onClick={() => {
                    const next = def.id;
                    setThemeId(next);
                    void saveSetting({ themeId: next });
                  }}
                  style={{
                    cursor: "pointer",
                    color: presetEmphasisColor(def, "dark"),
                    boxShadow:
                      themeId === def.id
                        ? "0 0 0 3px var(--mantine-color-body), 0 0 0 5px var(--sparkle-accent-strong)"
                        : undefined,
                  }}
                >
                  {themeId === def.id && <CheckIcon size={16} />}
                </ColorSwatch>
                <Text size="xs" c={themeId === def.id ? undefined : "dimmed"}>
                  {def.label}
                </Text>
              </Stack>
            ))}
          </Group>
          <Switch
            label="Mark items read when opened"
            checked={markOnOpen}
            onChange={(e) => {
              setMarkOnOpen(e.currentTarget.checked);
              void saveSetting({ markReadOnOpen: e.currentTarget.checked });
            }}
          />
          <Switch
            label="Sidebar: show only feeds with unread items"
            checked={unreadOnly}
            onChange={(e) => {
              setUnreadOnly(e.currentTarget.checked);
              void saveSetting({ sidebarUnreadOnly: e.currentTarget.checked });
            }}
          />
        </Stack>
      </Card>

      <Card withBorder padding="lg">
        <Stack gap="xs" align="flex-start">
          <Title id={homeViewId} order={3} size="md">
            Home view
          </Title>
          <Text id={`${homeViewId}-description`} size="xs" c="dimmed">
            The view that opens by default when you go home.
          </Text>
          <SegmentedControl
            aria-labelledby={homeViewId}
            aria-describedby={`${homeViewId}-description`}
            value={homeViewFromSettings(settingsQ.data?.data.homeView)}
            data={[
              { value: "all", label: "All" },
              { value: "unread", label: "Unread" },
              { value: "today", label: "Today" },
            ]}
            disabled={settingsQ.isPending || homeViewSave.isPending}
            onChange={(value) => homeViewSave.mutate(value)}
          />
          {homeViewSave.isError && (
            <Text role="alert" size="sm" c="red">
              Could not save home view. Try again.
            </Text>
          )}
        </Stack>
      </Card>

      <ApiTokensCard />

      <BookmarkletCard />

      <OpmlCard />

      <Divider my="xs" />
      <Group justify="space-between">
        <Title order={3} size="md">
          Session
        </Title>
        <Button variant="default" size="sm" onClick={() => void logout()}>
          Sign out
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

  const [label, setLabel] = useState("");
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<{
    id: string;
    label: string;
  } | null>(null);

  async function confirmRevoke(): Promise<void> {
    if (!pendingRevoke) return;
    await revoke.mutateAsync(pendingRevoke.id);
    setPendingRevoke(null);
  }

  return (
    <Card withBorder padding="lg">
      <Stack gap="sm">
        <Title order={3} size="md">
          API tokens
        </Title>
        <Text size="xs" c="dimmed">
          Used by native clients (NetNewsWire etc.) — password field in the
          client, not your login.
        </Text>

        {mintedTokenBanner(freshToken)}

        <Group gap="xs">
          <TextInput
            placeholder="Label (e.g. netnewswire-mac)"
            value={label}
            onChange={(e) => setLabel(e.currentTarget.value)}
            w={260}
          />
          <Button
            size="sm"
            onClick={() =>
              void mint.mutateAsync(label.trim()).then((r) => {
                setFreshToken(r.token);
                setLabel("");
              })
            }
            loading={mint.isPending}
          >
            Generate token
          </Button>
        </Group>

        <Stack gap={4}>
          {(tokensQ.data?.tokens ?? []).map((t) => (
            <Group key={t.id} justify="space-between">
              <Group gap="xs">
                <Badge
                  variant="light"
                  color="accent"
                  radius="sm"
                  ff="monospace"
                >
                  {t.id.slice(0, 8)}
                </Badge>
                <Text size="sm">{t.label || "(Unlabeled)"}</Text>
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
                Revoke
              </Button>
            </Group>
          ))}
        </Stack>

        <Modal
          opened={pendingRevoke !== null}
          onClose={() => setPendingRevoke(null)}
          title="Revoke token"
          size="sm"
        >
          {pendingRevoke && (
            <Stack gap="sm">
              <Text size="sm">
                Revoke{" "}
                <Text component="span" ff="monospace">
                  {pendingRevoke.label || "(Unlabeled)"}
                </Text>
                ? Any client using it (e.g. NetNewsWire) is disconnected
                immediately.
              </Text>
              <Group justify="flex-end">
                <Button
                  variant="default"
                  onClick={() => setPendingRevoke(null)}
                >
                  Cancel
                </Button>
                <Button
                  color="red"
                  loading={revoke.isPending}
                  onClick={() => void confirmRevoke()}
                >
                  Revoke
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
        <Code style={{ whiteSpace: "nowrap", overflowX: "auto" }}>{token}</Code>
        <CopyButton value={token}>
          {(props) => (
            <Button size="compact-xs" variant="light" {...props}>
              Copy
            </Button>
          )}
        </CopyButton>
      </Group>
      <Text size="xs" c="dimmed" mt={4}>
        Shown once — store it now
      </Text>
    </Box>
  );
}

function BookmarkletCard(): ReactElement {
  return (
    <Card withBorder padding="lg">
      <Stack gap="lg">
        <Stack gap="sm">
          <Title order={3} size="md">
            Read later bookmarklet
          </Title>
          <BookmarkletLink showCode={true} />
        </Stack>
        <Stack gap="sm">
          <Title order={3} size="md">
            Subscribe bookmarklet
          </Title>
          <BookmarkletLink kind="subscribe" showCode={true} />
        </Stack>
      </Stack>
    </Card>
  );
}

function OpmlCard(): ReactElement {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>("");

  async function doExport(): Promise<void> {
    const blob = await api.opml.exportBlob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "sparkle-subscriptions.opml";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function doImport(file: File): Promise<void> {
    setStatus("Importing…");
    const xml = await file.text();
    try {
      const result = await api.opml.importText(xml);
      setStatus(`Imported ${result.imported}/${result.found}`);
      void qc.invalidateQueries({ queryKey: qk.subscriptions });
      void qc.invalidateQueries({ queryKey: qk.folders });
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  return (
    <Card withBorder padding="lg">
      <Stack gap="sm">
        <Title order={3} size="md">
          OPML subscriptions
        </Title>
        <Group gap="xs">
          <Button
            size="sm"
            variant="default"
            leftSection={<LuDownload size={14} aria-hidden="true" />}
            onClick={() => void doExport()}
          >
            Export .opml
          </Button>
          <input
            type="file"
            accept=".opml,.xml,text/xml,application/xml"
            style={{ display: "none" }}
            id="opml-file-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void doImport(file);
            }}
          />
          <Button
            size="sm"
            variant="default"
            leftSection={<LuUpload size={14} aria-hidden="true" />}
            component="label"
            htmlFor="opml-file-input"
          >
            Import .opml
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
