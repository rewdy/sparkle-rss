import { createHash, randomBytes } from 'node:crypto';
import * as schema from '@sparkle/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { ServicesDeps } from './entries';

export interface UsersService {
  ensureByCognitoSub(
    sub: string,
    username: string,
    email: string,
  ): Promise<{
    id: string;
    username: string;
    email: string;
  }>;
}

export function createUsersService({ db }: ServicesDeps): UsersService {
  return {
    async ensureByCognitoSub(sub, username, email) {
      await db
        .insert(schema.users)
        .values({ id: crypto.randomUUID(), cognitoSub: sub, username, email })
        .onConflictDoNothing();
      const rows = await db.select().from(schema.users).where(eq(schema.users.cognitoSub, sub));
      const row = rows[0];
      if (!row) throw new Error('user missing after upsert');
      return { id: row.id, username: row.username, email: row.email };
    },
  };
}

export interface ApiTokenRecord {
  id: string;
  label: string;
  createdAtMs: number;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createApiTokensService({ db }: ServicesDeps) {
  return {
    async mint(userId: string, label: string): Promise<{ record: ApiTokenRecord; token: string }> {
      const token = `srk_${randomBytes(32).toString('base64url')}`;
      const inserted = await db
        .insert(schema.apiTokens)
        .values({ id: crypto.randomUUID(), userId, label, tokenHash: sha256Hex(token) })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error('token insert failed');
      return {
        record: { id: row.id, label: row.label, createdAtMs: row.createdAt.getTime() },
        token,
      };
    },

    async list(userId: string): Promise<ApiTokenRecord[]> {
      const rows = await db
        .select()
        .from(schema.apiTokens)
        .where(and(eq(schema.apiTokens.userId, userId), isNull(schema.apiTokens.revokedAt)))
        .orderBy(desc(schema.apiTokens.createdAt));
      return rows.map((r) => ({
        id: r.id,
        label: r.label,
        createdAtMs: r.createdAt.getTime(),
      }));
    },

    async revoke(userId: string, tokenId: string): Promise<void> {
      const updated = await db
        .update(schema.apiTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(schema.apiTokens.userId, userId), eq(schema.apiTokens.id, tokenId)))
        .returning({ id: schema.apiTokens.id });
      if (updated.length === 0) throw new Error('token not found');
    },

    /** Used by the greader ClientLogin surface to resolve a bearer API token. */
    async verify(token: string): Promise<string | null> {
      if (!token.startsWith('srk_')) return null;
      const rows = await db
        .select()
        .from(schema.apiTokens)
        .where(
          and(eq(schema.apiTokens.tokenHash, sha256Hex(token)), isNull(schema.apiTokens.revokedAt)),
        );
      const row = rows[0];
      if (!row) return null;
      await db
        .update(schema.apiTokens)
        .set({ lastUsedAt: new Date() })
        .where(eq(schema.apiTokens.id, row.id));
      return row.userId;
    },
  };
}
