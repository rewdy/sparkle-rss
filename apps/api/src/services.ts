import {
  createApiTokensService,
  createEntriesService,
  createFoldersService,
  createIngestService,
  createOpmlService,
  createSettingsService,
  createSubscriptionsService,
  createUsersService,
} from '@sparkle/core';
import * as schema from '@sparkle/db';
import { createPoolFromEnv } from '@sparkle/db';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';

export interface Services {
  users: ReturnType<typeof createUsersService>;
  folders: ReturnType<typeof createFoldersService>;
  subscriptions: ReturnType<typeof createSubscriptionsService>;
  entries: ReturnType<typeof createEntriesService>;
  settings: ReturnType<typeof createSettingsService>;
  apiTokens: ReturnType<typeof createApiTokensService>;
  opml: ReturnType<typeof createOpmlService>;
  ingest: ReturnType<typeof createIngestService>;
}

interface Handle {
  currentPool: unknown;
  db: NodePgDatabase<typeof schema>;
  services: Services;
  refreshIfStale: () => Promise<NodePgDatabase<typeof schema>>;
}

let handle: Handle | null = null;

async function buildHandle(): Promise<Handle> {
  const { pool, dispose, refreshIfStale } = await createPoolFromEnv();
  const state: Handle = {
    currentPool: pool,
    db: drizzle(pool, { schema }),
    services: null as unknown as Services,
    refreshIfStale: async () => {
      const fresh = await refreshIfStale();
      if (fresh !== state.currentPool) {
        state.currentPool = fresh;
        state.db = drizzle(fresh, { schema });
        state.services = createServices(state.db);
      }
      return state.db;
    },
  };
  state.services = createServices(state.db);
  void dispose;
  return state;
}

function createServices(db: NodePgDatabase<typeof schema>): Services {
  const deps = { db };
  return {
    users: createUsersService(deps),
    folders: createFoldersService(deps),
    subscriptions: createSubscriptionsService(deps),
    entries: createEntriesService(deps),
    settings: createSettingsService(deps),
    apiTokens: createApiTokensService(deps),
    opml: createOpmlService(deps),
    ingest: createIngestService(deps),
  };
}

/** Returns services bound to the freshest pool (handles DSQL token rotation). */
export async function getServices(): Promise<Services> {
  if (!handle) {
    handle = await buildHandle();
  }
  await handle.refreshIfStale();
  return handle.services;
}
