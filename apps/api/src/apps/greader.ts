import { createHash, timingSafeEqual } from 'node:crypto';
import { parseGoogleLoginHeader } from '@sparkle/core';
import { Hono, type MiddlewareHandler } from 'hono';
import { env } from '../env';

type Env = { Variables: { greaderUser: string } };

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function deriveSecret(user: string): string | null {
  if (!env.spikeUsername || user !== env.spikeUsername) return null;
  return `${user}/${sha256Hex(`${env.awsRegion}:${user}:${sha256Hex(env.spikeApiToken ?? '')}`)}`;
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function requireGreaderAuth(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const credentials = parseGoogleLoginHeader(c.req.header('Authorization'));
    const expected = credentials ? deriveSecret(credentials.user) : null;
    if (!credentials || !expected || !constantTimeEqual(credentials.secret, expected)) {
      return c.text('', 401);
    }
    c.set('greaderUser', credentials.user);
    await next();
  };
}

export const greaderApp = new Hono<Env>();

greaderApp.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Headers', 'Authorization');
  c.header('Access-Control-Allow-Methods', 'GET, POST');
  c.header('Access-Control-Max-Age', '600');
  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }
  await next();
});

greaderApp.onError((_error, c) => c.text('', 500));

greaderApp.get('/', (c) => c.text('OK'));

greaderApp.get('/check/compatibility', (c) => c.text('OK'));

greaderApp.post('/accounts/ClientLogin', async (c) => {
  const form = await c.req.parseBody();
  const email = typeof form.Email === 'string' ? form.Email : undefined;
  const passwd = typeof form.Passwd === 'string' ? form.Passwd : undefined;

  if (!email) {
    return c.text('', 400);
  }

  const auth = deriveSecret(email);
  if (
    !auth ||
    !passwd ||
    !constantTimeEqual(sha256Hex(passwd), sha256Hex(env.spikeApiToken ?? ''))
  ) {
    return c.text('', 401);
  }

  c.header('Content-Type', 'text/plain; charset=UTF-8');
  return c.text(`SID=${auth}\nLSID=null\nAuth=${auth}\n`);
});

greaderApp.use('/reader/*', requireGreaderAuth());

greaderApp.get('/reader/api/0/token', (c) => {
  const secret = deriveSecret(c.get('greaderUser')) ?? '';
  return c.text(secret.padEnd(57, 'Z').slice(0, 57));
});

greaderApp.get('/reader/api/0/user-info', (c) => {
  const user = c.get('greaderUser');
  return c.json({ userId: user, userName: user, userProfileId: user, userEmail: '' });
});
