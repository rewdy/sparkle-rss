export type CursorDirection = 'asc' | 'desc';

export interface StreamCursor {
  publishedAtMs: number;
  entryId: string;
  direction: CursorDirection;
}

interface CursorPayload {
  p: number;
  i: string;
  d: CursorDirection;
}

function encode(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decode(token: string): CursorPayload | null {
  try {
    const json = Buffer.from(token, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { p, i, d } = parsed as Record<string, unknown>;
    if (typeof p !== 'number' || Number.isNaN(p)) return null;
    if (typeof i !== 'string' || !/^\d{1,19}$/.test(i)) return null;
    if (d !== 'asc' && d !== 'desc') return null;
    return { p, i, d };
  } catch {
    return null;
  }
}

export function encodeCursor(cursor: StreamCursor): string {
  return encode({
    p: cursor.publishedAtMs,
    i: cursor.entryId,
    d: cursor.direction,
  });
}

export function decodeCursor(
  token: string,
  expected?: { direction?: CursorDirection },
): StreamCursor | null {
  const payload = decode(token);
  if (!payload) return null;
  if (expected?.direction && payload.d !== expected.direction) return null;
  return { publishedAtMs: payload.p, entryId: payload.i, direction: payload.d };
}
