import { Center, Loader, Stack, Text } from '@mantine/core';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { accessToken, devAuthBypassed, getUser, login } from '../lib/auth';

/** Guards the app: redirects to Cognito when no session, renders children when authed. */
export function useAuthGuard(): 'checking' | 'authed' | 'anon' {
  // Dev bypass: auth is structurally disabled, so the shell renders on the
  // first paint (no loader flash / layout shift).
  const [state, setState] = useState<'checking' | 'authed' | 'anon'>(
    devAuthBypassed ? 'authed' : 'checking',
  );
  const [, navigate] = useLocation();

  useEffect(() => {
    if (devAuthBypassed) return;
    let cancelled = false;
    (async () => {
      const user = await getUser().catch(() => null);
      if (cancelled) return;
      if (user && !user.expired) {
        // warm the access token (triggers silent renew if needed)
        await accessToken().catch(() => null);
        if (!cancelled) setState('authed');
        return;
      }
      if (!cancelled) setState('anon');
      void login();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state === 'anon') navigate('/login', { replace: true });
  }, [state, navigate]);

  return state;
}

export function FullscreenLoader({ label = 'loading…' }: { label?: string }): ReactElement {
  return (
    <Center mih="100vh">
      <Stack align="center" gap="xs">
        <Loader size="sm" type="dots" />
        <Text size="sm" c="dimmed" ff="monospace">
          {label}
        </Text>
      </Stack>
    </Center>
  );
}
