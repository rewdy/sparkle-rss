import { AppError } from '@sparkle/core';
import { Hono, type MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { greaderApp } from './apps/greader';
import { createWebApiApp } from './apps/web-api';
import { env } from './env';
import { corsMiddleware } from './middleware/cors';

type Env = { Variables: { cognitoSub: string; username?: string } };

const cognitoAuth: MiddlewareHandler<Env> = async (c, next) => {
  if (env.allowInsecureDevAuth) {
    const devUser = c.req.header('X-Dev-User') ?? 'dev-user';
    c.set('cognitoSub', devUser);
    c.set('username', devUser);
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
    c.set('cognitoSub', String(payload.sub ?? ''));
    c.set('username', typeof payload.username === 'string' ? payload.username : undefined);
  } catch {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
};

export const app = new Hono();

// Middleware must be registered before the routes they guard.
app.use('*', corsMiddleware());
app.use('/api/v1', cognitoAuth);
app.use('/api/v1/*', cognitoAuth);

app.route('/api/v1', createWebApiApp());
app.route('/api/greader.php', greaderApp);
app.route('/greader.php', greaderApp);

app.onError((error, c) => {
  if (error instanceof AppError) {
    return c.json(
      { error: error.code ?? 'bad_request', message: error.message },
      error.status as 400 | 404 | 409 | 422 | 502,
    );
  }
  if (error instanceof Error && error.name === 'ZodError') {
    return c.json(
      { error: 'validation_failed', message: error.message },
      400 as 400 | 404 | 409 | 422 | 502,
    );
  }
  console.error(JSON.stringify({ level: 'error', msg: 'unhandled', err: (error as Error).stack }));
  return c.json({ error: 'internal_error' }, 500 as 400 | 404 | 409 | 422 | 502);
});

app.notFound((c) => c.text('', 404));
