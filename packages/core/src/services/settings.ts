import * as schema from "@sparkle/db";
import { eq } from "drizzle-orm";
import type { ServicesDeps } from "./entries";

export type SettingsData = Record<string, unknown>;

export function createSettingsService({ db }: ServicesDeps) {
  return {
    async get(userId: string): Promise<SettingsData> {
      const rows = await db
        .select()
        .from(schema.userSettings)
        .where(eq(schema.userSettings.userId, userId));
      return (rows[0]?.data as SettingsData | undefined) ?? {};
    },

    async merge(userId: string, patch: SettingsData): Promise<SettingsData> {
      const current = await this.get(userId);
      const merged = { ...current, ...patch };
      await db
        .insert(schema.userSettings)
        .values({ userId, data: merged, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: schema.userSettings.userId,
          set: { data: merged, updatedAt: new Date() },
        });
      return merged;
    },
  };
}
