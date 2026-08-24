import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { processFeed } from './entries/worker-lambda';

/**
 * Enqueues an immediate fetch for a feed (same { feedId } message shape the
 * orchestrator uses). In tests this is a no-op; without a queue (local dev)
 * the feed is fetched in-process.
 */
export async function requestRefresh(feedId: number): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;
  const queueUrl = process.env.QUEUE_URL;
  if (queueUrl) {
    const client = new SQSClient({});
    await client.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({ feedId }),
      }),
    );
    return;
  }
  await processFeed(feedId);
}

/**
 * Fire-and-forget wrapper: a failed enqueue must never break the subscribe
 * response — the 5-minute scheduler picks the feed up anyway.
 */
export function requestRefreshSafe(feedId: number): void {
  void requestRefresh(feedId).catch((error) => {
    console.error(
      JSON.stringify({
        level: 'warn',
        msg: 'immediate refresh failed',
        feedId,
        error: (error as Error).message,
      }),
    );
  });
}
