import { type User, UserManager, WebStorageStateStore } from 'oidc-client-ts';

const ISSUER = import.meta.env.VITE_COGNITO_ISSUER as string | undefined;
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined;

export const authConfigured = Boolean(ISSUER && CLIENT_ID);

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

export async function login(): Promise<void> {
  await um().signinRedirect();
}

export async function handleCallback(): Promise<User> {
  return um().signinRedirectCallback();
}

export async function logout(): Promise<void> {
  await um().signoutRedirect();
}

export function getUser(): Promise<User | null> {
  return um().getUser();
}

export async function accessToken(): Promise<string> {
  const user = await um().getUser();
  if (!user || user.expired) {
    const renewed = await um()
      .signinSilent()
      .catch(() => null);
    if (!renewed?.access_token) throw new Error('session expired');
    return renewed.access_token;
  }
  return user.access_token;
}
