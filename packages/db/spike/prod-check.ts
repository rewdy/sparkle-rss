import { createDsqlClient } from '../src/client';

const endpoint = process.env.DSQL_ENDPOINT;
if (!endpoint) throw new Error('DSQL_ENDPOINT required');
const client = await createDsqlClient({ endpoint, region: process.env.AWS_REGION ?? 'us-east-1' });

const feeds = await client.query(
  'select id, url, title, last_fetched_at, error_count, last_error, (etag is not null) as has_etag from feeds',
);
console.log('feeds:', JSON.stringify(feeds.rows, null, 1));
const entries = await client.query(
  'select count(*)::int as n from user_entries where is_read = false',
);
console.log('unread entries:', entries.rows[0]);
await client.end();
