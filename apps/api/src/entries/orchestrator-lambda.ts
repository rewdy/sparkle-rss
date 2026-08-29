import {
  SendMessageBatchCommand,
  type SendMessageBatchRequestEntry,
  SQSClient,
} from "@aws-sdk/client-sqs";
import type { EventBridgeEvent } from "aws-lambda";
import { getServices } from "../services";

const MAX_FEEDS_PER_RUN = Number(process.env.MAX_FEEDS_PER_RUN ?? 100);
const CHUNK_SIZE = 10;

function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ level: "info", msg: "orchestrate", ...fields }));
}

/**
 * Dispatches due feeds to the refresh queue. Claims feeds first (bumps
 * next_fetch_after) so overlapping runs never double-dispatch; a failed fetch
 * re-schedules sooner via worker backoff only on error — otherwise the claim
 * IS the next schedule.
 */
export async function handler(
  _event: EventBridgeEvent<"Scheduled Event", unknown>,
): Promise<void> {
  const queueUrl = process.env.QUEUE_URL;
  if (!queueUrl) throw new Error("QUEUE_URL is required");

  const services = await getServices();
  const due = await services.ingest.getDueFeeds(MAX_FEEDS_PER_RUN);
  if (due.length === 0) {
    log({ dispatched: 0 });
    return;
  }

  await services.ingest.claimFeeds(due.map((f) => f.id));

  const client = new SQSClient({});
  let dispatched = 0;
  for (let i = 0; i < due.length; i += CHUNK_SIZE) {
    const chunk = due.slice(i, i + CHUNK_SIZE);
    const entries: SendMessageBatchRequestEntry[] = chunk.map((feed) => ({
      Id: feed.id.toString(),
      MessageBody: JSON.stringify({ feedId: feed.id }),
    }));
    const result = await client.send(
      new SendMessageBatchCommand({ QueueUrl: queueUrl, Entries: entries }),
    );
    dispatched += (result.Successful ?? []).length;
    for (const failed of result.Failed ?? []) {
      console.error(
        JSON.stringify({ level: "error", msg: "enqueue failed", ...failed }),
      );
      // Un-claim failures so the next run picks them up quickly.
      await services.ingest.recordFailure(
        Number(failed.Id),
        `enqueue failed: ${failed.Message ?? "unknown"}`,
        { ttlMinutes: 5, errorCount: 0 },
      );
    }
  }

  log({ dispatched, due: due.length });
}
