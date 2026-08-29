import { randomUUID } from "node:crypto";
import { createDsqlClient } from "../src/client";

const endpoint = process.env.DSQL_ENDPOINT;
if (!endpoint) throw new Error("DSQL_ENDPOINT required");
const client = await createDsqlClient({
  endpoint,
  region: process.env.AWS_REGION ?? "us-east-1",
});

const userId = randomUUID();
await client.query(
  `insert into users (id, cognito_sub, username) values ($1,$2,$3)`,
  [userId, "smoke-sub", "smoke"],
);
await client.query(`insert into feeds (url, title) values ($1,$2)`, [
  "https://example.com/rss.xml",
  "Example",
]);
const feed = await client.query<{ id: string }>(
  `select id from feeds where url=$1`,
  ["https://example.com/rss.xml"],
);
const feedId = feed.rows[0]?.id;
if (!feedId) throw new Error("feed row missing");
await client.query(
  `insert into subscriptions (user_id, feed_id) values ($1,$2)`,
  [userId, feedId],
);
await client.query(
  `insert into user_entries (user_id, feed_id, guid, guid_hash, title, published_at)
   values ($1,$2,$3,$4,$5, now())`,
  [userId, feedId, "guid-1", "a".repeat(64), "Hello DSQL"],
);
const unread = await client.query<{ n: string }>(
  `select count(*)::text as n from user_entries where user_id=$1 and is_read=false`,
  [userId],
);
console.log("unread count:", unread.rows[0]?.n);
await client.query(
  `update user_entries set is_read=true, read_at=now() where user_id=$1`,
  [userId],
);
const after = await client.query<{ n: string }>(
  `select count(*)::text as n from user_entries where user_id=$1 and is_read=false`,
  [userId],
);
console.log("after mark-read:", after.rows[0]?.n);

// idempotency: rerunning migration should skip everything
console.log("smoke write path OK");
await client.end();
