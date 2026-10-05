import {
  Alert,
  Anchor,
  Button,
  Center,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import type { FormEvent, ReactElement } from "react";
import { useState } from "react";
import { useLocation } from "wouter";
import { PageTitle } from "../components/PageTitle";
import {
  completeNewPassword,
  confirmPasswordReset,
  requestPasswordReset,
  signIn,
} from "../lib/auth";

type Mode = "sign-in" | "new-password" | "forgot" | "confirm-reset";

export function Login(): ReactElement {
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "sign-in") {
        const result = await signIn(username.trim(), password);
        if (result.type === "new-password-required") {
          setChallenge(result.session);
          setMode("new-password");
          return;
        }
        navigate("/", { replace: true });
      } else if (mode === "new-password") {
        await completeNewPassword(username.trim(), newPassword, challenge);
        navigate("/", { replace: true });
      } else if (mode === "forgot") {
        await requestPasswordReset(username.trim());
        setMode("confirm-reset");
        setNotice(
          "If an account matches, password reset instructions will be sent.",
        );
      } else {
        await confirmPasswordReset(username.trim(), code.trim(), newPassword);
        setPassword("");
        setNewPassword("");
        setMode("sign-in");
        setNotice("Password updated. You can now sign in.");
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Something went wrong. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === "sign-in"
      ? "Sign in"
      : mode === "new-password"
        ? "Set your password"
        : mode === "forgot"
          ? "Reset password"
          : "Enter reset code";

  return (
    <>
      <PageTitle title={`${title} · Sparkle RSS`} />
      <Center mih="100dvh" p="md">
        <Paper w="100%" maw={390} p="xl" radius="md" withBorder>
          <form onSubmit={(event) => void submit(event)}>
            <Stack gap="md">
              <Stack gap={4} mb="xs">
                <Text
                  c="accent"
                  size="xs"
                  ff="monospace"
                  tt="uppercase"
                  fw={700}
                >
                  sparkle rss
                </Text>
                <Title order={2} ff="monospace" size="h3">
                  {title}
                </Title>
                <Text size="sm" c="dimmed">
                  {mode === "sign-in" &&
                    "Sign in with the account created for you."}
                  {mode === "new-password" &&
                    "Your temporary password must be replaced before continuing."}
                  {mode === "forgot" &&
                    "Enter your username or email and we’ll send reset instructions if an account matches."}
                  {mode === "confirm-reset" &&
                    "Enter the code sent to your account and choose a new password."}
                </Text>
              </Stack>
              {error && (
                <Alert color="red" title="Could not continue">
                  {error}
                </Alert>
              )}
              {notice && <Alert color="green">{notice}</Alert>}
              {mode !== "new-password" && (
                <TextInput
                  label="Username or email"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.currentTarget.value)}
                  required
                />
              )}
              {mode === "sign-in" && (
                <PasswordInput
                  label="Password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.currentTarget.value)}
                  required
                />
              )}
              {mode === "confirm-reset" && (
                <TextInput
                  label="Reset code"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.currentTarget.value)}
                  required
                />
              )}
              {(mode === "new-password" || mode === "confirm-reset") && (
                <PasswordInput
                  label="New password"
                  autoComplete="new-password"
                  description="At least 12 characters with upper and lower case, a number, and a symbol."
                  value={newPassword}
                  onChange={(event) =>
                    setNewPassword(event.currentTarget.value)
                  }
                  minLength={12}
                  required
                />
              )}
              <Button type="submit" loading={busy} fullWidth>
                {mode === "sign-in"
                  ? "sign in"
                  : mode === "new-password"
                    ? "set password"
                    : mode === "forgot"
                      ? "send reset code"
                      : "update password"}
              </Button>
              <Text size="sm" ta="center">
                {mode === "sign-in" ? (
                  <Anchor
                    component="button"
                    type="button"
                    onClick={() => {
                      setError(null);
                      setMode("forgot");
                    }}
                  >
                    Forgot your password?
                  </Anchor>
                ) : (
                  <Anchor
                    component="button"
                    type="button"
                    onClick={() => {
                      setError(null);
                      setNotice(null);
                      setMode("sign-in");
                    }}
                  >
                    Back to sign in
                  </Anchor>
                )}
              </Text>
            </Stack>
          </form>
        </Paper>
      </Center>
    </>
  );
}
