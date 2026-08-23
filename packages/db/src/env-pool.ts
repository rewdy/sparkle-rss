import 'dotenv/config';
import type pg from 'pg';
import { createLocalPool, DsqlPoolManager } from './client';

export interface PoolHandle {
  pool: pg.Pool;
  dispose: () => Promise<void>;
}

export async function createPoolFromEnv(): Promise<PoolHandle> {
  const endpoint = process.env.DSQL_ENDPOINT;
  if (endpoint) {
    const manager = new DsqlPoolManager({
      endpoint,
      region: process.env.AWS_REGION ?? 'us-east-1',
    });
    return {
      pool: await manager.getPool(),
      dispose: () => manager[Symbol.asyncDispose](),
    };
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Set DATABASE_URL (local Postgres) or DSQL_ENDPOINT (+ AWS_REGION)');
  }
  const pool = createLocalPool({ connectionString });
  return {
    pool,
    dispose: async () => {
      await pool.end();
    },
  };
}
