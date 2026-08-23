import { Badge, Button, Card, Code, Group, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { me, ping } from '../lib/api';
import { useColorScheme } from '../lib/ui-state';

export function Home() {
  const [scheme, setScheme] = useColorScheme();
  const pingQuery = useQuery({ queryKey: ['ping'], queryFn: ping });
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => me('dev-user'),
    enabled: pingQuery.isSuccess,
  });

  return (
    <Stack p="xl" gap="md" maw={720} mx="auto">
      <Group justify="space-between">
        <Title order={1}>Sparkle RSS</Title>
        <Button variant="default" onClick={() => setScheme(scheme === 'dark' ? 'light' : 'dark')}>
          {scheme === 'dark' ? 'Light mode' : 'Dark mode'}
        </Button>
      </Group>

      <Card withBorder shadow="sm" radius="md" padding="lg">
        <Stack gap="sm">
          <Group justify="space-between">
            <Text fw={600}>API connectivity</Text>
            {pingQuery.isPending && <Badge color="gray">checking…</Badge>}
            {pingQuery.isError && <Badge color="red">offline</Badge>}
            {pingQuery.isSuccess && <Badge color="green">online</Badge>}
          </Group>
          <Text size="sm" c="dimmed">
            Phase 0 shell: the web app reaches <Code>/api/v1/ping</Code> through Vite&apos;s dev
            proxy locally and CloudFront in production. Reader UI lands in Phase 5.
          </Text>
          {pingQuery.data && (
            <Text size="xs" c="dimmed">
              server ts: <Code>{new Date(pingQuery.data.ts).toISOString()}</Code>
            </Text>
          )}
        </Stack>
      </Card>

      <Card withBorder shadow="sm" radius="md" padding="lg">
        <Stack gap="sm">
          <Text fw={600}>Dev identity (insecure header auth)</Text>
          {meQuery.isSuccess ? (
            <Text size="sm">
              signed in as <Code>{meQuery.data.userId}</Code>
            </Text>
          ) : (
            <Text size="sm" c="dimmed">
              requires ALLOW_INSECURE_DEV_AUTH on the api
            </Text>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}
