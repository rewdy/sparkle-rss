export type CursorDirection = 'asc' | 'desc';
export type CursorSortKey = 'published' | 'starred';

export interface StreamCursor {
  sortKey: CursorSortKey;
  direction: CursorDirection;
  primaryAtMs: number;
  entryId: string;
}

interface CursorPayload {
  k: CursorSortKey;
  d: CursorDirection;
  p: number;
  i: string;
}

function encode(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decode(token: string): CursorPayload | null {
  try {
    const json = Buffer.from(token, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const legacy = parsed as Record<string, unknown>;
    // Legacy shape (pre-sortKey): {p,i,d}
    const k =
      typeof legacy.k === 'string' && (legacy.k === 'published' || legacy.k === 'starred')
        ? legacy.k
        : typeof legacy.d === 'string'
          ? 'published'
          : null;
    const d =
      typeof legacy.d === 'string' && (legacy.d === 'asc' || legacy.d === 'desc') ? legacy.d : null;
    if (!k || !d) return null;
    if (typeof legacy.p !== 'number' || Number.isNaN(legacy.p)) return null;
    if (typeof legacy.i !== 'string' || !/^\d{1,19}$/.test(legacy.i)) return null;
    return { k, d, p: legacy.p, i: legacy.i };
  } catch {
    return null;
  }
}

export function encodeCursor(cursor: StreamCursor): string {
  return encode({
    k: cursor.sortKey,
    d: cursor.direction,
    p: cursor.primaryAtMs,
    i: cursor.entryId,
  });
}

export function decodeCursor(
  token: string,
  expected?: { sortKey?: CursorSortKey; direction?: CursorDirection },
): StreamCursor | null {
  const payload = decode(token);
  if (!payload) return null;
  if (expected?.sortKey && payload.k !== expected.sortKey) return null;
  if (expected?.direction && payload.d !== expected.direction) return null;
  return {
    sortKey: payload.k,
    direction: payload.d,
    primaryAtMs: payload.p,
    entryId: payload.i,
  };
}
