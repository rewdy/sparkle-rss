import { Center, Loader, Stack, Text } from '@mantine/core';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { accessToken, devAuthBypassed, getUser, login } from '../lib/auth';

/** Guards the app: redirects to Cognito when no session, renders children when authed. */
export function useAuthGuard(
  onLoginError?: (error: Error) => void,
): 'checking' | 'authed' | 'anon' {
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
        // Warm the access token (renews if needed). Only treat the session as
        // authed if the renewal actually succeeded — never mount the app with a
        // dead token just because one happened to be stored.
        const token = await accessToken().catch(() => null);
        if (cancelled) return;
        if (token) {
          setState('authed');
          return;
        }
      }
      if (!cancelled) setState('anon');
      login().catch((e) => onLoginError?.(e instanceof Error ? e : new Error(String(e))));
    })();
    return () => {
      cancelled = true;
    };
  }, [onLoginError]);

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
