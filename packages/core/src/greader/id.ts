export const LONG_ITEM_ID_PREFIX = "tag:google.com,2005:reader/item/";
const HEX_RE = /^[0-9a-fA-F]{16}$/;
const DECIMAL_RE = /^\d{1,19}$/;

export function toLongItemId(id: bigint): string {
  if (id < 0n) throw new RangeError("item ids are non-negative");
  return `${LONG_ITEM_ID_PREFIX}${id.toString(16).padStart(16, "0")}`;
}

export function toShortItemId(id: bigint): string {
  return id.toString(10);
}

export function isLongItemId(raw: string): boolean {
  if (!raw.startsWith(LONG_ITEM_ID_PREFIX)) return false;
  return HEX_RE.test(raw.slice(LONG_ITEM_ID_PREFIX.length));
}

export function parseItemId(raw: string): bigint | null {
  const value = raw.trim();
  if (value.startsWith(LONG_ITEM_ID_PREFIX)) {
    const hex = value.slice(LONG_ITEM_ID_PREFIX.length);
    if (!HEX_RE.test(hex)) return null;
    return BigInt(`0x${hex}`);
  }
  if (DECIMAL_RE.test(value)) return BigInt(value);
  return null;
}
