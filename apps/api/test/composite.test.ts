import { describe, expect, it } from 'vitest';

process.env.ALLOW_INSECURE_DEV_AUTH = 'true';
process.env.SPIKE_USERNAME = 'spike';
process.env.SPIKE_API_TOKEN = 'spike-token-change-me';
process.env.AWS_REGION = 'us-east-1';

const { app } = await import('../src/app');

function authHeader(user: string, secret: string): string {
  return `GoogleLogin auth=${user}/${secret}`;
}

async function clientLogin(email: string, passwd: string): Promise<Response> {
  return app.request('/api/greader.php/accounts/ClientLogin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ Email: email, Passwd: passwd }).toString(),
  });
}

describe('composite api app', () => {
  it('serves /api/v1/ping', async () => {
    const res = await app.request('/api/v1/ping');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('returns OK at the greader root', async () => {
    const res = await app.request('/api/greader.php');
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe('OK');
  });

  it('accepts the alternate /greader.php mount', async () => {
    const res = await app.request('/greader.php');
    expect(await res.text()).toBe('OK');
  });
});

describe('CORS (single middleware authority)', () => {
  it('answers preflights with 204 and CORS headers', async () => {
    const res = await app.request('/api/v1/ping', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  });

  it('echoes allow-listed origins and falls back to * otherwise', async () => {
    const res = await app.request('/api/v1/ping', { headers: { Origin: 'http://localhost:5173' } });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');

    const other = await app.request('/api/greader.php', {
      headers: { Origin: 'https://some-web-reader.example' },
    });
    expect(other.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('keeps greader responses CORS-enabled without duplicate headers', async () => {
    const res = await app.request('/greader.php', {
      headers: { Origin: 'https://some-web-reader.example' },
    });
    const raw = res.headers.get('Access-Control-Allow-Origin');
    expect(raw).toBe('*');
    expect(raw?.includes(',')).toBe(false);
  });
});

describe('greader ClientLogin stub (Spike B)', () => {
  it('issues SID/Auth lines for valid spike credentials', async () => {
    const res = await clientLogin('spike', 'spike-token-change-me');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    const body = await res.text();
    const sid = body
      .split('\n')
      .find((line) => line.startsWith('SID='))
      ?.slice(4);
    const authLine = body
      .split('\n')
      .find((line) => line.startsWith('Auth='))
      ?.slice(5);
    expect(sid).toBeTruthy();
    expect(authLine).toBe(sid);
    expect(body).toContain('LSID=null');
  });

  it('rejects bad credentials with 401', async () => {
    const res = await clientLogin('spike', 'wrong');
    expect(res.status).toBe(401);
  });

  it('rejects unknown users with 401', async () => {
    const res = await clientLogin('mallory', 'spike-token-change-me');
    expect(res.status).toBe(401);
  });

  it('rejects missing fields with 400', async () => {
    const res = await app.request('/api/greader.php/accounts/ClientLogin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: '',
    });
    expect(res.status).toBe(400);
  });

  it('protects reader endpoints and accepts the derived credential', async () => {
    const denied = await app.request('/api/greader.php/reader/api/0/user-info');
    expect(denied.status).toBe(401);

    const login = await clientLogin('spike', 'spike-token-change-me');
    const body = await login.text();
    const auth =
      body
        .split('\n')
        .find((line) => line.startsWith('Auth='))
        ?.slice(5) ?? '';

    const allowed = await app.request('/api/greader.php/reader/api/0/user-info', {
      headers: { Authorization: authHeader('spike', auth) },
    });
    expect(allowed.status).toBe(200);
    const info = (await allowed.json()) as { userId: string };
    expect(info.userId).toBe('spike');

    const tampered = await app.request('/api/greader.php/reader/api/0/user-info', {
      headers: { Authorization: authHeader('spike', `${auth}x`) },
    });
    expect(tampered.status).toBe(401);
  });

  it('issues a 57-char write token for authenticated users', async () => {
    const login = await clientLogin('spike', 'spike-token-change-me');
    const auth =
      (await login.text())
        .split('\n')
        .find((l) => l.startsWith('Auth='))
        ?.slice(5) ?? '';
    const res = await app.request('/api/greader.php/reader/api/0/token', {
      headers: { Authorization: authHeader('spike', auth) },
    });
    expect(res.status).toBe(200);
    expect((await res.text()).length).toBe(57);
  });
});
