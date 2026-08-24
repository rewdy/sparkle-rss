import { fetchFeed } from '@sparkle/core';
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { getServices } from '../services';

function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ level: 'info', msg: 'ingest', ...fields }));
}

/**
 * Fetches one feed and fans entries out to every subscriber. Errors are
 * recorded on the feed row (backoff) and reported as batch failures so SQS
 * redrives only genuinely broken messages.
 */
export async function processFeed(feedId: number): Promise<{
  outcome: 'ok' | 'not-modified' | 'error';
  inserted?: number;
}> {
  const services = await getServices();
  const feed = await services.ingest.getFeed(feedId);
  if (!feed) {
    log({ feedId, outcome: 'skipped', reason: 'feed missing' });
    return { outcome: 'error' };
  }

  try {
    const response = await fetchFeed(feed.url, {
      etag: feed.etag,
      lastModified: feed.lastModified,
    });

    if (response.status === 'not-modified') {
      await services.ingest.recordNotModified(feed.id, feed.ttlMinutes);
      log({ feedId, outcome: 'not-modified' });
      return { outcome: 'not-modified' };
    }

    const parsed = await services.ingest.parseXml(response.body ?? '', feed.siteUrl);
    const inserted = await services.ingest.fanoutEntries(feed.id, parsed.entries);
    await services.ingest.recordSuccess(feed.id, {
      etag: response.etag,
      lastModified: response.lastModified,
      ttlMinutes: feed.ttlMinutes,
      parsedTitle: parsed.title || undefined,
      parsedSiteUrl: parsed.siteUrl || undefined,
      permanentRedirectTo: response.permanentRedirectTo,
    });
    log({ feedId, outcome: 'ok', inserted, entries: parsed.entries.length });
    return { outcome: 'ok', inserted };
  } catch (error) {
    const message = (error as Error).message;
    await services.ingest.recordFailure(feed.id, message, {
      ttlMinutes: feed.ttlMinutes,
      errorCount: feed.errorCount,
    });
    console.error(JSON.stringify({ level: 'warn', msg: 'fetch failed', feedId, error: message }));
    return { outcome: 'error' };
  }
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records) {
    try {
      const body = JSON.parse(record.body) as { feedId?: number };
      if (typeof body.feedId !== 'number') throw new Error('message missing feedId');
      await processFeed(body.feedId);
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'worker record failed',
          messageId: record.messageId,
          error: (error as Error).message,
        }),
      );
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
