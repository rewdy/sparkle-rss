async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { Accept: 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export interface PingResponse {
  ok: boolean;
  ts: number;
}

export function ping(): Promise<PingResponse> {
  return request<PingResponse>('/api/v1/ping');
}

export interface MeResponse {
  userId: string;
  spike: boolean;
}

export function me(devUser: string): Promise<MeResponse> {
  return request<MeResponse>('/api/v1/me', { headers: { 'X-Dev-User': devUser } });
}
