export const devAuthBypassed = import.meta.env.VITE_AUTH_DISABLED === "true";

let activeAccessToken: string | null = null;
let activeAccessTokenExpiresAt = 0;
let refreshInFlight: Promise<string> | null = null;

export class SessionExpiredError extends Error {
  constructor(cause?: unknown) {
    super("session expired");
    this.name = "SessionExpiredError";
    if (cause !== undefined)
      (this as Error & { cause?: unknown }).cause = cause;
  }
}

type TokenResponse = { accessToken: string };
export type SignInResult =
  | { type: "authenticated" }
  | { type: "new-password-required"; username: string; session: string };

function tokenExpiry(token: string): number {
  try {
    const payload = token.split(".")[1];
    if (!payload) throw new Error("missing token payload");
    const decoded = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    ) as { exp?: number };
    return typeof decoded.exp === "number"
      ? decoded.exp * 1000
      : Date.now() + 5 * 60_000;
  } catch {
    return Date.now() + 5 * 60_000;
  }
}

function storeAccessToken(token: string): string {
  activeAccessToken = token;
  activeAccessTokenExpiresAt = tokenExpiry(token);
  return token;
}

async function authRequest<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(`/api/auth/${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    accessToken?: string;
    challenge?: string;
    session?: string;
  };
  if (!response.ok) {
    const error = new Error(
      payload.message ?? "Authentication failed",
    ) as Error & { status?: number; code?: string };
    error.status = response.status;
    error.code = payload.error;
    throw error;
  }
  return payload as T;
}

export async function signIn(
  username: string,
  password: string,
): Promise<SignInResult> {
  const result = await authRequest<{
    accessToken?: string;
    challenge?: string;
    session?: string;
  }>("sign-in", { username, password });
  if (result.challenge === "new-password-required" && result.session) {
    return { type: "new-password-required", username, session: result.session };
  }
  if (!result.accessToken)
    throw new Error("The authentication service returned no access token.");
  storeAccessToken(result.accessToken);
  return { type: "authenticated" };
}

export async function completeNewPassword(
  username: string,
  newPassword: string,
  session: string,
): Promise<void> {
  const result = await authRequest<TokenResponse>("complete-new-password", {
    username,
    newPassword,
    session,
  });
  storeAccessToken(result.accessToken);
}

export async function requestPasswordReset(username: string): Promise<void> {
  await authRequest("forgot-password", { username });
}

export async function confirmPasswordReset(
  username: string,
  code: string,
  password: string,
): Promise<void> {
  await authRequest("confirm-reset", { username, code, password });
}

export async function logout(): Promise<void> {
  if (devAuthBypassed) {
    activeAccessToken = null;
    activeAccessTokenExpiresAt = 0;
    window.location.assign("/");
    return;
  }
  await fetch("/api/auth/sign-out", {
    method: "POST",
    credentials: "same-origin",
  }).catch(() => {});
  activeAccessToken = null;
  activeAccessTokenExpiresAt = 0;
  window.location.assign("/login");
}

export function redirectToLogin(): void {
  activeAccessToken = null;
  activeAccessTokenExpiresAt = 0;
  window.location.assign("/login");
}

export async function renewToken(): Promise<string> {
  if (devAuthBypassed) return "dev-token";
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = authRequest<TokenResponse>("refresh")
    .then((result) => storeAccessToken(result.accessToken))
    .catch((cause) => {
      if ((cause as { status?: number })?.status === 401) {
        activeAccessToken = null;
        activeAccessTokenExpiresAt = 0;
        throw new SessionExpiredError(cause);
      }
      throw cause;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

export async function accessToken(): Promise<string> {
  if (devAuthBypassed) return "dev-token";
  if (activeAccessToken && activeAccessTokenExpiresAt > Date.now() + 30_000) {
    return activeAccessToken;
  }
  return renewToken();
}
