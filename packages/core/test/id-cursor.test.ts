import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from '../src/greader/cursor';
import { parseItemId, toLongItemId, toShortItemId } from '../src/greader/id';

describe('item id forms', () => {
  it('round-trips the long form with 16-char zero-padded hex', () => {
    expect(toLongItemId(76383n)).toBe('tag:google.com,2005:reader/item/0000000000012a5f');
    const parsed = parseItemId(toLongItemId(76383n));
    expect(parsed).toBe(76383n);
    expect(toShortItemId(76383n)).toBe('76383');
  });

  it('accepts both forms in parseItemId', () => {
    expect(parseItemId('76383')).toBe(76383n);
    expect(parseItemId(' tag:google.com,2005:reader/item/0000000000012A5F ')).toBe(76383n);
  });

  it('rejects malformed ids', () => {
    expect(parseItemId('feed/17')).toBeNull();
    expect(parseItemId('')).toBeNull();
    expect(parseItemId('tag:google.com,2005:reader/item/zz')).toBeNull();
    expect(parseItemId('-12')).toBeNull();
    expect(parseItemId(`${'9'.repeat(20)}`)).toBeNull();
  });
});

describe('stream cursors', () => {
  it('round-trips ascending and descending cursors', () => {
    const token = encodeCursor({
      publishedAtMs: 1690000000123,
      entryId: '76383',
      direction: 'desc',
    });
    expect(decodeCursor(token)).toEqual({
      publishedAtMs: 1690000000123,
      entryId: '76383',
      direction: 'desc',
    });
  });

  it('enforces expected direction when provided', () => {
    const token = encodeCursor({ publishedAtMs: 1, entryId: '2', direction: 'asc' });
    expect(decodeCursor(token, { direction: 'desc' })).toBeNull();
    expect(decodeCursor(token, { direction: 'asc' })).not.toBeNull();
  });

  it('returns null for garbage tokens', () => {
    expect(decodeCursor('not-a-token')).toBeNull();
    expect(decodeCursor('')).toBeNull();
    expect(
      decodeCursor(
        Buffer.from(JSON.stringify({ p: 'x', i: '1', d: 'desc' })).toString('base64url'),
      ),
    ).toBeNull();
  });
});
