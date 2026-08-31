import { PutObjectCommand } from "@aws-sdk/client-s3";
import {
  createApiTokensService,
  createEntriesService,
  createFoldersService,
  createIngestService,
  createMediaService,
  createOpmlService,
  createSettingsService,
  createSubscriptionsService,
  createUsersService,
} from "@sparkle/core";
import * as schema from "@sparkle/db";
import { createPoolFromEnv } from "@sparkle/db";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { requestRefreshSafe } from "./refresh";
import { createS3Client } from "./s3";

export interface Services {
  users: ReturnType<typeof createUsersService>;
  folders: ReturnType<typeof createFoldersService>;
  subscriptions: ReturnType<typeof createSubscriptionsService>;
  entries: ReturnType<typeof createEntriesService>;
  settings: ReturnType<typeof createSettingsService>;
  apiTokens: ReturnType<typeof createApiTokensService>;
  opml: ReturnType<typeof createOpmlService>;
  ingest: ReturnType<typeof createIngestService>;
  media: ReturnType<typeof createMediaService>;
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
  const s3 = createS3Client();
  const bucket = process.env.MEDIA_BUCKET;
  const media = createMediaService({
    db,
    store: {
      async put(key, bytes, mimeType) {
        if (!bucket) throw new Error("MEDIA_BUCKET is required");
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: bytes,
            ContentType: mimeType,
            CacheControl: "public,max-age=31536000,immutable",
          }),
        );
      },
    },
  });
  return {
    users: createUsersService(deps),
    folders: createFoldersService(deps),
    subscriptions: createSubscriptionsService(deps, {
      onSubscribed: (feedId) => requestRefreshSafe(feedId),
    }),
    entries: createEntriesService(deps),
    settings: createSettingsService(deps),
    apiTokens: createApiTokensService(deps),
    opml: createOpmlService(deps),
    ingest: createIngestService({ ...deps, media: bucket ? media : undefined }),
    media,
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
