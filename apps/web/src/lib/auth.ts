import { type User, UserManager, WebStorageStateStore } from 'oidc-client-ts';

const ISSUER = import.meta.env.VITE_COGNITO_ISSUER as string | undefined;
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined;

/** Local-development escape hatch: no Cognito, requests use X-Dev-User. */
export const devAuthBypassed = import.meta.env.VITE_AUTH_DISABLED === 'true';

export const authConfigured = devAuthBypassed || Boolean(ISSUER && CLIENT_ID);

let userManager: UserManager | null = null;

function um(): UserManager {
  if (!userManager) {
    if (!ISSUER || !CLIENT_ID) throw new Error('auth not configured');
    userManager = new UserManager({
      authority: ISSUER,
      client_id: CLIENT_ID,
      redirect_uri: `${window.location.origin}/auth/callback`,
      post_logout_redirect_uri: `${window.location.origin}/`,
      scope: 'openid profile email',
      response_type: 'code',
      automaticSilentRenew: true,
      userStore: new WebStorageStateStore({ store: sessionStorage }),
    });
  }
  return userManager;
}

const DEV_USER: User = {
  profile: { sub: 'dev-user' },
  access_token: 'dev-token',
  expired: false,
} as unknown as User;

export async function login(): Promise<void> {
  if (devAuthBypassed) {
    window.history.replaceState({}, '', '/');
    return;
  }
  await um().signinRedirect();
}

export async function handleCallback(): Promise<User> {
  return um().signinRedirectCallback();
}

export async function logout(): Promise<void> {
  if (devAuthBypassed) {
    window.location.href = '/';
    return;
  }
  await um().signoutRedirect();
}

export async function getUser(): Promise<User | null> {
  if (devAuthBypassed) return DEV_USER;
  return um().getUser();
}

export async function accessToken(): Promise<string> {
  if (devAuthBypassed) return 'dev-token';
  const user = await um().getUser();
  if (!user || user.expired) {
    return renewToken();
  }
  return user.access_token;
}

/** Force a silent token renewal. Throws if the refresh throws and fails loudly.
 * Used by the API client to retry a 401 with fresh credentials. */
export async function renewToken(): Promise<string> {
  if (devAuthBypassed) return 'dev-token';
  const renewed = await um()
    .signinSilent()
    .catch((e: unknown) => {
      logout();
      throw new Error('session expired', { cause: e });
    });
  if (!renewed?.access_token) throw new Error('session expired');
  return renewed.access_token;
}
