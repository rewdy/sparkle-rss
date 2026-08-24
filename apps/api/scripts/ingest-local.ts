import 'dotenv/config';
import { config } from 'dotenv';

config({ path: '../../.env' });

import { processFeed } from '../src/entries/worker-lambda';
import { getServices } from '../src/services';

/**
 * Local replacement for the SQS pipeline: fetches every due feed right now.
 * Usage: pnpm --filter @sparkle/api ingest
 */
const services = await getServices();
const due = await services.ingest.getDueFeeds(100);
console.log(`fetching ${due.length} due feed(s)…`);
let inserted = 0;
for (const feed of due) {
  const result = await processFeed(feed.id);
  inserted += result.inserted ?? 0;
  console.log(`  feed ${feed.id} → ${result.outcome} (+${result.inserted ?? 0})`);
}
console.log(`done: ${inserted} new entries`);
