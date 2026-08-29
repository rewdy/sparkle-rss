import { Alert, Button, Center, Stack, Text } from '@mantine/core';
import type { ReactElement } from 'react';
import { useCallback, useState } from 'react';
import { PageTitle } from '../components/PageTitle';
import { FullscreenLoader, useAuthGuard } from './guard';

/** Kicks off the redirect to the Cognito hosted UI, keyed by the retry count so
 * re-mounting after a failure starts the login flow again. */
function LoginBlade({ onFail }: { onFail: (error: Error) => void }): ReactElement {
  useAuthGuard(onFail);
  return <FullscreenLoader label="redirecting to sign-in…" />;
}

export function Login(): ReactElement {
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const onFail = useCallback((e: Error) => setError(e), []);

  return (
    <>
      <PageTitle title="Sign in · Sparkle RSS" />
      {error ? (
        <Center mih="100vh" p="md">
          <Stack align="center" gap="md">
            <Alert title="redirect to sign-in failed" color="red" w={420}>
              {error.message}. Your browser may be blocking the redirect on auth.sparklerss.com; try
              again or check your network connection.
            </Alert>
            <Button
              onClick={() => {
                setError(null);
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </Button>
            <Text size="xs" c="dimmed">
              Still stuck? Clear your browser cookies for this site and retry.
            </Text>
          </Stack>
        </Center>
      ) : (
        <LoginBlade key={attempt} onFail={onFail} />
      )}
    </>
  );
}
