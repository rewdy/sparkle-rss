import { Hono } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { greaderApp } from './apps/greader';
import { env } from './env';

type Env = { Variables: { userId: string } };

export const webApiApp = new Hono<Env>();

webApiApp.get('/ping', (c) => c.json({ ok: true, ts: Date.now() }));

webApiApp.use('/me/*', async (c, next) => {
  if (env.allowInsecureDevAuth) {
    const devUser = c.req.header('X-Dev-User') ?? 'dev-user';
    c.set('userId', devUser);
    await next();
    return;
  }
  const issuer = env.cognitoIssuer;
  const audience = env.cognitoClientId;
  if (!issuer || !audience) {
    return c.json({ error: 'auth_not_configured' }, 501);
  }
  const token = (c.req.header('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  try {
    // Cognito ACCESS tokens have no `aud` claim — the client is identified by
    // `client_id`, which jose does not treat as an audience. Verify signature +
    // issuer here, then assert client_id/token_use manually.
    const { payload } = await jwtVerify(
      token,
      createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)),
      { issuer },
    );
    if (payload.client_id !== audience || payload.token_use !== 'access') {
      return c.json({ error: 'unauthorized' }, 401);
    }
    c.set('userId', String(payload.sub ?? ''));
  } catch {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
});

webApiApp.get('/me', (c) => {
  return c.json({ userId: c.get('userId'), spike: true });
});

export const app = new Hono();

app.route('/api/v1', webApiApp);
app.route('/api/greader.php', greaderApp);
app.route('/greader.php', greaderApp);

app.notFound((c) => c.text('', 404));
