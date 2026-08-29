import "dotenv/config";
import type pg from "pg";
import { createLocalPool, DsqlPoolManager } from "./client";

export interface PoolHandle {
  pool: pg.Pool;
  dispose: () => Promise<void>;
  /**
   * Returns the current pool, recreating it first when its IAM token is close
   * to expiry (DSQL only). Callers that cache long-lived handles should poll
   * this and rebuild dependent objects when the instance changes.
   */
  refreshIfStale: () => Promise<pg.Pool>;
}

export async function createPoolFromEnv(): Promise<PoolHandle> {
  const endpoint = process.env.DSQL_ENDPOINT;
  if (endpoint) {
    const manager = new DsqlPoolManager({
      endpoint,
      region: process.env.AWS_REGION ?? "us-east-1",
    });
    return {
      pool: await manager.getPool(),
      dispose: () => manager[Symbol.asyncDispose](),
      refreshIfStale: () => manager.getPool(),
    };
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "Set DATABASE_URL (local Postgres) or DSQL_ENDPOINT (+ AWS_REGION)",
    );
  }
  const pool = createLocalPool({ connectionString });
  return {
    pool,
    dispose: async () => {
      await pool.end();
    },
    refreshIfStale: async () => pool,
  };
}
