import { type User, UserManager, WebStorageStateStore } from "oidc-client-ts";

const ISSUER = import.meta.env.VITE_COGNITO_ISSUER as string | undefined;
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined;

/** Local-development escape hatch: no Cognito, requests use X-Dev-User. */
export const devAuthBypassed = import.meta.env.VITE_AUTH_DISABLED === "true";

export const authConfigured = devAuthBypassed || Boolean(ISSUER && CLIENT_ID);

let userManager: UserManager | null = null;

function um(): UserManager {
  if (!userManager) {
    if (!ISSUER || !CLIENT_ID) throw new Error("auth not configured");
    userManager = new UserManager({
      authority: ISSUER,
      client_id: CLIENT_ID,
      redirect_uri: `${window.location.origin}/auth/callback`,
      post_logout_redirect_uri: `${window.location.origin}/`,
      scope: "openid profile email",
      response_type: "code",
      // Renewal happens on demand (through accessToken / the API client's 401
      // retry) rather than in the background, so a single code path owns token
      // freshness and there is no renewal to race against.
      automaticSilentRenew: false,
      userStore: new WebStorageStateStore({ store: sessionStorage }),
    });
  }
  return userManager;
}

const DEV_USER: User = {
  profile: { sub: "dev-user" },
  access_token: "dev-token",
  expired: false,
} as unknown as User;

export async function login(): Promise<void> {
  if (devAuthBypassed) {
    window.history.replaceState({}, "", "/");
    return;
  }
  await um().signinRedirect();
}

export async function handleCallback(): Promise<User> {
  return um().signinRedirectCallback();
}

export async function logout(): Promise<void> {
  if (devAuthBypassed) {
    window.location.href = "/";
    return;
  }
  await um().signoutRedirect();
}

export async function getUser(): Promise<User | null> {
  if (devAuthBypassed) return DEV_USER;
  return um().getUser();
}

export async function accessToken(): Promise<string> {
  if (devAuthBypassed) return "dev-token";
  const user = await um().getUser();
  if (!user || user.expired) {
    return renewToken();
  }
  return user.access_token;
}

/** The refresh token was rejected by the provider (revoked/expired) — the
 * session is genuinely over and the app must send the user back to /login. */
export class SessionExpiredError extends Error {
  constructor(cause?: unknown) {
    super("session expired");
    this.name = "SessionExpiredError";
    if (cause !== undefined) {
      // Standard Error cause so debugging keeps the original failure around.
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

/** Hard redirect the app to /login (used on confirmed session expiry). */
export function redirectToLogin(): void {
  window.location.assign("/login");
}

/** Force a token renewal. Distinguishes a genuinely dead refresh token (the
 * provider answered with an OAuth error like `invalid_grant`) from a transient
 * network/timeout failure — only the former is allowed to destroy the session.
 * Used by the API client to retry a 401 with fresh credentials. */
export async function renewToken(): Promise<string> {
  if (devAuthBypassed) return "dev-token";
  let renewed: User | null;
  try {
    renewed = await um().signinSilent();
  } catch (cause) {
    // oidc-client-ts surfaces provider rejections as an ErrorResponse carrying
    // an `error` field; network/timeout errors have none. Rejections without
    // that field are transient and must not clear the stored session.
    const providerRejected = Boolean((cause as { error?: unknown })?.error);
    if (!providerRejected) throw cause;
    await um()
      .removeUser()
      .catch(() => {});
    throw new SessionExpiredError(cause);
  }
  if (!renewed?.access_token) {
    await um()
      .removeUser()
      .catch(() => {});
    throw new SessionExpiredError();
  }
  return renewed.access_token;
}
