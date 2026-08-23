import { DsqlSigner } from '@aws-sdk/dsql-signer';
import pg from 'pg';

export interface LocalPoolOptions {
  connectionString: string;
}

export function createLocalPool(options: LocalPoolOptions): pg.Pool {
  return new pg.Pool({
    connectionString: options.connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
}

export interface DsqlClusterOptions {
  endpoint: string;
  region: string;
  database?: string;
  adminUser?: string;
  maxConnections?: number;
}

/**
 * Single serialized connection for DDL work (migrations). DSQL catalog changes
 * need one-connection serialization; see packages/db/src/dsql-migrator.ts.
 */
export async function createDsqlClient(options: DsqlClusterOptions): Promise<pg.Client> {
  const signer = new DsqlSigner({ hostname: options.endpoint, region: options.region });
  const token = await signer.getDbConnectAdminAuthToken();
  const client = new pg.Client({
    host: options.endpoint,
    user: options.adminUser ?? 'admin',
    database: options.database ?? 'postgres',
    password: token,
    ssl: { rejectUnauthorized: true },
  });
  await client.connect();
  return client;
}

const TOKEN_TTL_MS = 15 * 60 * 1000;

/**
 * DSQL requires a fresh IAM auth token per connection (TTL 15 min). This manager
 * creates pools with tokens generated at pool creation time and transparently
 * swaps to a new pool before tokens can expire, ending the old one gracefully.
 */
export class DsqlPoolManager implements AsyncDisposable {
  private pool: pg.Pool | null = null;
  private createdAt = 0;
  private readonly lifetimeMs = TOKEN_TTL_MS - 3 * 60 * 1000;

  constructor(private readonly options: DsqlClusterOptions) {}

  async getPool(): Promise<pg.Pool> {
    if (this.pool && Date.now() - this.createdAt < this.lifetimeMs) {
      return this.pool;
    }
    const previous = this.pool;
    const signer = new DsqlSigner({ hostname: this.options.endpoint, region: this.options.region });
    const token = await signer.getDbConnectAdminAuthToken();
    this.pool = new pg.Pool({
      host: this.options.endpoint,
      user: this.options.adminUser ?? 'admin',
      database: this.options.database ?? 'postgres',
      password: token,
      ssl: { rejectUnauthorized: true },
      max: this.options.maxConnections ?? 5,
      idleTimeoutMillis: 10_000,
    });
    this.pool.on('error', () => {});
    this.createdAt = Date.now();
    if (previous) {
      void previous.end();
    }
    return this.pool;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}
