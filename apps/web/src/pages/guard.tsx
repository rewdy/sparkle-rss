import { Alert, Button, Center, Loader, Stack, Text } from "@mantine/core";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { accessToken, devAuthBypassed, SessionExpiredError } from "../lib/auth";

/** Guards the app by restoring a first-party session from its HttpOnly cookie. */
export function useAuthGuard(): "checking" | "authed" | "anon" | "error" {
  // Dev bypass: auth is structurally disabled, so the shell renders on the
  // first paint (no loader flash / layout shift).
  const [state, setState] = useState<"checking" | "authed" | "anon" | "error">(
    devAuthBypassed ? "authed" : "checking",
  );
  const [, navigate] = useLocation();

  useEffect(() => {
    if (devAuthBypassed) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      try {
        await accessToken();
        if (!cancelled) setState("authed");
      } catch (error) {
        if (!cancelled)
          setState(error instanceof SessionExpiredError ? "anon" : "error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state === "anon") navigate("/login", { replace: true });
  }, [state, navigate]);

  return state;
}

export function SessionRestoreError(): ReactElement {
  return (
    <Center mih="100vh" p="md">
      <Stack align="center" gap="md" maw={420}>
        <Alert color="yellow" title="Could not check your session">
          The authentication service did not respond. Your sign-in may still be
          valid; try again in a moment.
        </Alert>
        <Button onClick={() => window.location.reload()}>Try again</Button>
      </Stack>
    </Center>
  );
}

export function FullscreenLoader({
  label = "loading…",
}: {
  label?: string;
}): ReactElement {
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
