import type { SQSEvent } from 'aws-lambda';

export async function handler(event: SQSEvent): Promise<void> {
  for (const record of event.Records) {
    console.log(
      JSON.stringify({
        level: 'info',
        msg: 'worker stub: feed refresh lands in Phase 3',
        messageId: record.messageId,
      }),
    );
  }
}
