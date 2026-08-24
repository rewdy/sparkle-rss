import { createHash, createHmac } from 'node:crypto';

/**
 * Google Reader compatible auth derivations. Stateless by design: ClientLogin
 * returns `<userId>/<secret>` where secret = HMAC(serverKey, userId:tokenHash);
 * later requests are validated by recomputing from the stored token hashes.
 */

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function deriveAuthSecret(serverKey: string, userId: string, tokenHash: string): string {
  const digest = createHmac('sha256', serverKey).update(`${userId}:${tokenHash}`).digest();
  return `${userId}/${digest.toString('base64url')}`;
}

export function deriveWriteToken(serverKey: string, userId: string): string {
  // 40-char digest prefix padded to FreshRSS's canonical 57 characters.
  const hex = createHmac('sha256', serverKey).update(`write:${userId}`).digest('hex').slice(0, 40);
  return hex.padEnd(57, 'Z');
}
